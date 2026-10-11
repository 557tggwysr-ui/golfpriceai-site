/**
 * GolfPrice AI — deal alerts worker (Cloudflare Workers, free plan).
 *
 * The only part of the site that isn't a static page. It exists so the
 * Brevo API key never appears in public website code.
 *
 *   POST /subscribe     { email, model?, modelName?, website (honeypot) }
 *                       New people get a "please confirm" email (double
 *                       opt-in). Confirmed subscribers adding another model
 *                       are updated straight away.
 *   GET  /confirm       The link in that email. Adds the person to the
 *                       Brevo list with their watched model(s).
 *   GET  /unsubscribe   ?e=email&s=signature[&m=model]  One click: stop
 *                       all alerts, or just one model's. POST does the
 *                       same for email apps' built-in Unsubscribe button.
 *
 * Settings (Cloudflare: Worker > Settings > Variables and Secrets):
 *   BREVO_API_KEY   secret  Brevo > SMTP & API > API keys
 *   ALERTS_SECRET   secret  any long random string; the same one goes in
 *                           GitHub as a secret, so emails sent by the
 *                           6-hourly update can carry working unsubscribe links
 *   LIST_ID         text    3
 *   SITE            text    https://golfpriceai.com
 *   SENDER_EMAIL    text    alerts@golfpriceai.com
 */

const BREVO = 'https://api.brevo.com/v3';
const EMAIL_RX = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const SLUG_RX = /^[a-z0-9-]{3,100}$/;
const CONFIRM_DAYS = 7;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/subscribe' && request.method === 'POST') return await subscribe(request, env, cors);
      if (url.pathname === '/confirm') return await confirm(url, env);
      if (url.pathname === '/unsubscribe') return await unsubscribe(url, env, request.method === 'POST');
      if (url.pathname === '/') return new Response('GolfPrice AI alerts: OK', { headers: { 'content-type': 'text/plain' } });
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.log('error', err && err.stack);
      return json({ ok: false, error: 'Something went wrong. Please try again in a minute.' }, 500, cors);
    }
  },
};

/* ------------------------------------------------------------------ handlers */
async function subscribe(request, env, cors) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (await tooMany(ip)) return json({ ok: false, error: 'Too many sign-ups from here just now. Please try again later.' }, 429, cors);

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
  if (body.website) return json({ ok: true, status: 'check-email' }, 200, cors); // honeypot: pretend all is well
  const email = String(body.email || '').trim().toLowerCase();
  const model = body.model && SLUG_RX.test(body.model) ? body.model : '';
  const modelName = String(body.modelName || '').slice(0, 120);
  if (!EMAIL_RX.test(email)) return json({ ok: false, error: 'That email address doesn’t look right.' }, 400, cors);

  // Already confirmed? Add the model straight away.
  const existing = await brevo(env, 'GET', `/contacts/${encodeURIComponent(email)}`);
  const listId = Number(env.LIST_ID || 3);
  if (existing.ok && (existing.data.listIds || []).includes(listId) && !existing.data.emailBlacklisted) {
    if (model) {
      const watch = mergeWatch(existing.data.attributes && existing.data.attributes.WATCHLIST, model);
      await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { WATCHLIST: watch } });
    }
    return json({ ok: true, status: 'added' }, 200, cors);
  }

  const payload = b64url(JSON.stringify({ e: email, m: model, t: Date.now() }));
  const sig = await sign(env, payload);
  const link = `${new URL(request.url).origin}/confirm?d=${payload}&s=${sig}`;
  const sent = await brevo(env, 'POST', '/smtp/email', {
    sender: { name: 'GolfPrice AI', email: env.SENDER_EMAIL || 'alerts@golfpriceai.com' },
    to: [{ email }],
    subject: model ? `Confirm your price alert for the ${modelName || 'model you picked'}` : 'Confirm your GolfPrice AI deal alerts',
    htmlContent: confirmEmail(link, modelName),
    tags: ['confirm'],
  });
  if (!sent.ok) return json({ ok: false, error: 'We couldn’t send the confirmation email. Please try again shortly.' }, 502, cors);
  return json({ ok: true, status: 'check-email' }, 200, cors);
}

async function confirm(url, env) {
  const site = env.SITE || 'https://golfpriceai.com';
  const d = url.searchParams.get('d') || '', s = url.searchParams.get('s') || '';
  if (!d || !(await verify(env, d, s))) return Response.redirect(`${site}/alerts-confirmed.html?status=invalid`, 302);
  const data = JSON.parse(unb64url(d));
  if (Date.now() - data.t > CONFIRM_DAYS * 864e5) return Response.redirect(`${site}/alerts-confirmed.html?status=expired`, 302);

  await ensureAttributes(env);
  const listId = Number(env.LIST_ID || 3);
  const existing = await brevo(env, 'GET', `/contacts/${encodeURIComponent(data.e)}`);
  const watch = mergeWatch(existing.ok && existing.data.attributes ? existing.data.attributes.WATCHLIST : '', data.m);
  const attributes = { WATCHLIST: watch, CONSENT_AT: new Date().toISOString().slice(0, 19) + 'Z' };
  if (existing.ok) {
    await brevo(env, 'PUT', `/contacts/${encodeURIComponent(data.e)}`, { attributes, listIds: [listId], emailBlacklisted: false });
  } else {
    const made = await brevo(env, 'POST', '/contacts', { email: data.e, attributes, listIds: [listId], updateEnabled: true });
    if (!made.ok) return Response.redirect(`${site}/alerts-confirmed.html?status=error`, 302);
  }
  return Response.redirect(`${site}/alerts-confirmed.html?status=ok${data.m ? '&m=' + data.m : ''}`, 302);
}

// oneClick = the email app's own "Unsubscribe" button (a POST, RFC 8058):
// it wants a plain 200, not a redirect to a web page.
async function unsubscribe(url, env, oneClick) {
  const site = env.SITE || 'https://golfpriceai.com';
  if (oneClick) {
    const r = await unsubscribe(url, env, false);
    const ok = !/status=invalid/.test(r.headers.get('location') || '');
    return new Response(ok ? 'Unsubscribed' : 'Invalid link', { status: ok ? 200 : 400 });
  }
  const email = (url.searchParams.get('e') || '').toLowerCase();
  const s = url.searchParams.get('s') || '';
  const model = url.searchParams.get('m') || '';
  if (!email || !(await verify(env, email, s))) return Response.redirect(`${site}/alerts-unsubscribed.html?status=invalid`, 302);
  const existing = await brevo(env, 'GET', `/contacts/${encodeURIComponent(email)}`);
  if (!existing.ok) return Response.redirect(`${site}/alerts-unsubscribed.html?status=ok`, 302);
  if (model && SLUG_RX.test(model)) {
    const left = String((existing.data.attributes || {}).WATCHLIST || '').split(',').filter((x) => x && x !== model).join(',');
    await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { WATCHLIST: left } });
    return Response.redirect(`${site}/alerts-unsubscribed.html?status=model&m=${model}`, 302);
  }
  await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, {
    attributes: { WATCHLIST: '' }, unlinkListIds: [Number(env.LIST_ID || 3)],
  });
  return Response.redirect(`${site}/alerts-unsubscribed.html?status=ok`, 302);
}

/* ------------------------------------------------------------------ helpers */
function mergeWatch(current, model) {
  const list = String(current || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (model && !list.includes(model)) list.push(model);
  return list.slice(-50).join(',');
}

async function ensureAttributes(env) {
  for (const name of ['WATCHLIST', 'CONSENT_AT']) {
    // Fails harmlessly with 400 when the attribute already exists.
    await brevo(env, 'POST', `/contacts/attributes/normal/${name}`, { type: 'text' });
  }
}

async function brevo(env, method, path, body) {
  const res = await fetch(BREVO + path, {
    method,
    headers: { 'api-key': env.BREVO_API_KEY, accept: 'application/json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.ALERTS_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function sign(env, text) {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(text));
  // Raw bytes to base64url (must match scripts/alerts.py, which signs the
  // unsubscribe links in alert emails with the same secret).
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}
async function verify(env, text, sig) {
  const good = await sign(env, text);
  if (good.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < good.length; i++) diff |= good.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); }

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = [env.SITE || 'https://golfpriceai.com', 'https://www.golfpriceai.com'];
  return {
    'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0],
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers) });
}

// Light per-address limit: 5 sign-ups per 10 minutes, using the free edge cache.
async function tooMany(ip) {
  const cache = caches.default;
  const key = new Request(`https://rate.golfpriceai.invalid/${encodeURIComponent(ip)}`);
  const hit = await cache.match(key);
  const n = hit ? Number(await hit.text()) : 0;
  if (n >= 5) return true;
  await cache.put(key, new Response(String(n + 1), { headers: { 'cache-control': 'max-age=600' } }));
  return false;
}

function confirmEmail(link, modelName) {
  const what = modelName
    ? `a price alert for the <strong>${escapeHtml(modelName)}</strong>. We’ll email you when its UK price genuinely drops`
    : `GolfPrice AI deal alerts: genuine UK golf price drops, checked against our own price history`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f7f8f6;font-family:Arial,Helvetica,sans-serif;color:#16241c">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
<p style="font-size:22px;font-weight:bold;margin:0 0 18px">Golf<span style="color:#3fae29">Price</span> AI</p>
<div style="background:#fff;border:1px solid #e7e9e5;border-radius:14px;padding:24px">
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">Someone (hopefully you) asked for ${what}.</p>
<p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;background:#3fae29;color:#fff;text-decoration:none;font-weight:bold;padding:13px 20px;border-radius:10px">Yes, send me alerts</a></p>
<p style="font-size:13px;line-height:1.5;color:#5b665f;margin:0">No click, no emails: if this wasn’t you, just ignore this message. The link works for 7 days.</p>
</div>
<p style="font-size:12px;color:#5b665f;line-height:1.5;margin:16px 0 0">No countdown timers. No fake discounts. Unsubscribe from any alert in one click.</p>
</div></body></html>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
