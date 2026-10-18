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
 *                       Brevo list with their watched model(s). A sign-up
 *                       with no model (homepage, search) is for the Friday
 *                       "Genuine Drops" email: DIGEST = yes.
 *   POST /send-list     { email, ids[], watch?, website (honeypot) }
 *                       "Email me this list" on Assemble Your Arsenal. Emails
 *                       the visitor their bag straight away (a one-off email
 *                       they asked for, not a sign-up). Names, prices and
 *                       links come from the site's own data/lookup files,
 *                       never from the page, so the button can't be used to
 *                       send anyone a message of someone else's choosing.
 *                       watch = also set up price alerts for those models
 *                       (that part needs the usual confirmation email).
 *   POST /subscribe     { email, stock, stockName }  Back In Stock Radar's
 *                       "Notify me": one email when that product is back
 *                       (sent by scripts/alerts.py), after confirmation.
 *   POST /subscribe     { email, bought, paid }  "Bought it? We'll keep watching"
 *                       on a price page: after confirmation, one email if
 *                       the lowest UK price falls below what they paid
 *                       within 30 days (sent by scripts/alerts.py). Stored
 *                       as BOUGHTWATCH "slug|paid|date" entries, deleted
 *                       after the email or after 30 days.
 *   POST /subscribe     { email, models: [slug, ...], list: 1, fb? }  "Watch all 3"
 *                       on a four-ball shortlist (/fourball/list/): price
 *                       alerts for several models with one confirmation.
 *   fb (any sign-up)    An 8-character four-ball invite code from a shared
 *                       link. When a new watch is confirmed, the worker adds
 *                       1 to that invite's count in Cloudflare KV. KV holds
 *                       only "invite code -> number" and a running total:
 *                       never an email address or a name.
 *   POST /subscribe     { email, budget: "driver-300" }  Budget alert on a
 *                       /prices/best/ page: after confirmation, one email
 *                       whenever a model of that type drops under that price
 *                       (sent by scripts/alerts.py). Stored in BUDGETWATCH.
 *   POST /subscribe     { email, models: [a, b], list: "compare" }  "Watch both"
 *                       on a /prices/compare/ page.
 *   GET  /fourball      ?c=code  { n, total }: the live "3 golfers watching
 *                       through John's invite" count, and the site-wide total.
 *   GET  /unsubscribe   ?e=email&s=signature[&m=model]  One click: stop
 *                       all alerts, or just one model's (m=friday-email
 *                       stops only the Friday email). POST does the
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
 *   FOURBALL        KV namespace binding (Worker > Settings > Bindings).
 *                   Optional: without it everything works, the counts just
 *                   stay at 0.
 */

const BREVO = 'https://api.brevo.com/v3';
const EMAIL_RX = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const SLUG_RX = /^[a-z0-9-]{3,100}$/;
const ID_RX = /^[a-z0-9-]{3,220}$/;
const MAX_LIST = 25;
const LIST_PER_EMAIL_PER_DAY = 3;
const CONFIRM_DAYS = 7;
const DIGEST_SLUG = 'friday-email';
const FB_RX = /^[a-z0-9]{8}$/;
const MAX_MODELS = 6;
// Budget alerts: "<type>-<pounds>", e.g. "driver-300" or "ball-30" (balls per
// dozen). The type keys match TYPES in scripts/price_pages.py.
const BUDGET_TYPES = { driver: 'driver', wood: 'fairway wood', hybrid: 'hybrid', irons: 'iron set', wedge: 'wedge',
  putter: 'putter', ball: 'dozen golf balls', bag: 'golf bag', rangefinder: 'rangefinder', 'gps-watch': 'GPS watch',
  'electric-trolley': 'electric trolley', 'launch-monitor': 'launch monitor' };
const BUDGET_RX = /^([a-z-]{3,30})-(\d{2,5})$/;
function budgetName(key) {
  const m = BUDGET_RX.exec(key || '');
  return m && BUDGET_TYPES[m[1]] ? `a ${BUDGET_TYPES[m[1]]} under £${m[2]}` : '';
}
const BOUGHT_RX = /^[a-z0-9-]{3,100}\|\d{1,5}\.\d{2}\|\d{4}-\d{2}-\d{2}$/; // in unsubscribe links: stop the Friday email only

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/subscribe' && request.method === 'POST') return await subscribe(request, env, cors);
      if (url.pathname === '/send-list' && request.method === 'POST') return await sendList(request, env, cors);
      if (url.pathname === '/fourball' && request.method === 'GET') return await fourballCount(url, env, cors);
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
  const fb = FB_RX.test(String(body.fb || '')) ? String(body.fb) : '';
  const stock = !model && body.stock && ID_RX.test(body.stock) ? body.stock : '';
  let modelName = String(body.modelName || '').slice(0, 120);
  if (!EMAIL_RX.test(email)) return json({ ok: false, error: 'That email address doesn’t look right.' }, 400, cors);
  if (!model && !stock && body.bought) {
    // "Bought it? We'll keep watching": the name comes from our own price page.
    const slug = SLUG_RX.test(String(body.bought)) ? String(body.bought) : '';
    const paid = Math.round(Number(String(body.paid || '').replace(/[£,\s]/g, '')) * 100) / 100;
    if (!slug) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    if (!(paid >= 1 && paid <= 20000)) return json({ ok: false, error: 'Please enter the price you paid, e.g. 299.00' }, 400, cors);
    const site = env.SITE || 'https://golfpriceai.com';
    const page = await fetch(`${site}/prices/${slug}/data.json`, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (!page.ok) return json({ ok: false, error: 'We couldn’t find that product. Please refresh the page and try again.' }, 400, cors);
    const d = await page.json().catch(() => ({}));
    const entry = `${slug}|${paid.toFixed(2)}|${new Date().toISOString().slice(0, 10)}`;
    return await startSubscription({ email, models: [], stock: '', bought: entry, name: String(d.name || modelName).slice(0, 120), request, env, cors });
  }
  if (!model && !stock && body.budget) {
    const key = String(body.budget);
    const what = budgetName(key);
    if (!what) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    return await startSubscription({ email, models: [], stock: '', budget: key, name: what, request, env, cors });
  }
  if (!model && !stock && Array.isArray(body.models) && body.models.length) {
    // "Watch all 3" on a four-ball shortlist. Every model must have a price
    // page of ours; names come from our own data, not the page.
    const slugs = [...new Set(body.models.map(String).filter((x) => SLUG_RX.test(x)))].slice(0, MAX_MODELS);
    const site = env.SITE || 'https://golfpriceai.com';
    const found = await Promise.all(slugs.map(async (slug) => {
      const r = await fetch(`${site}/prices/${slug}/data.json`, { cf: { cacheTtl: 900, cacheEverything: true } }).catch(() => null);
      if (!r || !r.ok) return null;
      const d = await r.json().catch(() => ({}));
      return { slug, name: String(d.name || '').slice(0, 120) };
    }));
    const ok = found.filter(Boolean);
    if (!ok.length) return json({ ok: false, error: 'We couldn’t find those products. Please refresh the page and try again.' }, 400, cors);
    const kind = body.list === 'compare' ? 'compare' : body.list ? 'shortlist' : '';
    return await startSubscription({ email, models: ok.map((x) => x.slug), stock: '', name: ok.length === 1 ? ok[0].name : '', list: kind, fb, request, env, cors });
  }
  if (stock) {
    // The product's name comes from our own data, not the page.
    const found = (await lookup(env, [stock]))[stock];
    if (!found) return json({ ok: false, error: 'We couldn’t find that product. Please refresh the page and try again.' }, 400, cors);
    modelName = String(found[0]).split(' - ')[0].trim();
  }
  return await startSubscription({ email, models: model ? [model] : [], stock, name: modelName, fb: model ? fb : '', request, env, cors });
}

// Shared by /subscribe and the "also alert me" box on /send-list.
async function startSubscription({ email, models, stock, bought = '', budget = '', name, list = '', fb = '', request, env, cors, quiet }) {

  // Already confirmed? Add the model straight away.
  const existing = await brevo(env, 'GET', `/contacts/${encodeURIComponent(email)}`);
  const listId = Number(env.LIST_ID || 3);
  const attrs = (existing.ok && existing.data.attributes) || {};
  if (existing.ok && (existing.data.listIds || []).includes(listId) && !existing.data.emailBlacklisted) {
    await ensureAttributes(env);
    if (budget) {
      await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { BUDGETWATCH: mergeWatch(attrs.BUDGETWATCH, budget, 10) } });
      return json({ ok: true, status: 'added-budget' }, 200, cors);
    }
    if (bought) {
      await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { BOUGHTWATCH: mergeBought(attrs.BOUGHTWATCH, bought) } });
      return json({ ok: true, status: 'added-bought' }, 200, cors);
    }
    if (stock) {
      await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { STOCKWATCH: mergeWatch(attrs.STOCKWATCH, stock, 15) } });
      return json({ ok: true, status: 'added-stock' }, 200, cors);
    }
    if (models.length) {
      let watch = attrs.WATCHLIST;
      for (const m of models) watch = mergeWatch(watch, m);
      if (fb && watch !== String(attrs.WATCHLIST || '')) await countInvite(env, fb);
      await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { WATCHLIST: watch } });
    } else {
      await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { DIGEST: 'yes' } });
    }
    return json({ ok: true, status: models.length ? 'added' : 'added-digest' }, 200, cors);
  }

  const payload = b64url(JSON.stringify({ e: email, m: models.join(','), k: stock, b: bought, g: budget, f: fb, l: list === 'compare' ? 2 : list ? 1 : 0, t: Date.now() }));
  const sig = await sign(env, payload);
  const link = `${new URL(request.url).origin}/confirm?d=${payload}&s=${sig}`;
  const subject = budget ? `Confirm your budget alert: ${name}`
    : bought ? `Confirm your price watch for the ${name} you bought`
    : stock ? `Confirm your back-in-stock alert for the ${name}`
    : models.length > 1 ? `Confirm price alerts for the ${models.length} items ${list === 'compare' ? 'you’re comparing' : list ? 'on the shortlist' : 'in your bag'}`
    : models.length ? `Confirm your price alert for the ${name || 'model you picked'}`
    : 'Confirm your GolfPrice AI Friday email';
  const sent = await brevo(env, 'POST', '/smtp/email', {
    sender: { name: 'GolfPrice AI', email: env.SENDER_EMAIL || 'alerts@golfpriceai.com' },
    to: [{ email }],
    subject,
    htmlContent: confirmEmail(link, name, { stock: !!stock, bought: !!bought, budget: !!budget, count: models.length, list, fb: !!fb }),
    tags: ['confirm'],
  });
  if (!sent.ok) return json({ ok: false, error: 'We couldn’t send the confirmation email. Please try again shortly.' }, 502, cors);
  return json({ ok: true, status: 'check-email' }, 200, cors);
}

async function sendList(request, env, cors) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (await tooMany('list-' + ip)) return json({ ok: false, error: 'That’s a lot of bags in a short time. Please try again in a few minutes.' }, 429, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
  if (body.website) return json({ ok: true, status: 'sent' }, 200, cors); // honeypot
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RX.test(email)) return json({ ok: false, error: 'That email address doesn’t look right.' }, 400, cors);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => ID_RX.test(x)))].slice(0, MAX_LIST);
  if (!ids.length) return json({ ok: false, error: 'Your bag is empty. Add something first.' }, 400, cors);
  if (await tooMany('list-to-' + (await sha1(email)), LIST_PER_EMAIL_PER_DAY, 86400)) {
    return json({ ok: false, error: 'We’ve already sent a few lists to that address today. Please try again tomorrow.' }, 429, cors);
  }

  const found = await lookup(env, ids);
  const items = ids.filter((id) => found[id]).map((id) => {
    const [name, price, retailer, link, image, slug, inStock] = found[id];
    return { name, price, retailer, link, image, slug, inStock };
  });
  if (!items.length) return json({ ok: false, error: 'Those products have just changed on our side. Please refresh the page and try again.' }, 400, cors);

  const site = env.SITE || 'https://golfpriceai.com';
  const watchModels = body.watch ? [...new Set(items.map((i) => i.slug).filter((x) => x && SLUG_RX.test(x)))] : [];
  const sent = await brevo(env, 'POST', '/smtp/email', {
    sender: { name: 'GolfPrice AI', email: env.SENDER_EMAIL || 'alerts@golfpriceai.com' },
    to: [{ email }],
    subject: `Your GolfPrice AI bag: ${items.length} item${items.length === 1 ? '' : 's'}, ${money(items.reduce((t, i) => t + i.price, 0))}`,
    htmlContent: listEmail(items, site, watchModels.length),
    tags: ['bag-list'],
  });
  if (!sent.ok) return json({ ok: false, error: 'We couldn’t send the email just now. Please try again shortly.' }, 502, cors);

  let watch = 'none';
  if (watchModels.length) {
    const one = watchModels.length === 1 ? String(items.find((i) => i.slug === watchModels[0]).name).split(' - ')[0].trim() : '';
    const r = await startSubscription({ email, models: watchModels, stock: '', name: one, request, env, cors });
    const res = await r.json().catch(() => ({}));
    watch = res.ok ? res.status : 'failed';
  } else if (body.watch) {
    watch = 'no-models';
  }
  return json({ ok: true, status: 'sent', watch, watched: watchModels.length }, 200, cors);
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
  const attrsNow = (existing.ok && existing.data.attributes) || {};
  let watch = attrsNow.WATCHLIST || '';
  for (const m of String(data.m || '').split(',').filter((x) => SLUG_RX.test(x))) watch = mergeWatch(watch, m);
  const isNewWatch = watch !== String(attrsNow.WATCHLIST || '');
  const attributes = { WATCHLIST: watch, CONSENT_AT: new Date().toISOString().slice(0, 19) + 'Z' };
  if (data.k && ID_RX.test(data.k)) attributes.STOCKWATCH = mergeWatch(attrsNow.STOCKWATCH, data.k, 15);
  if (data.b && BOUGHT_RX.test(data.b)) attributes.BOUGHTWATCH = mergeBought(attrsNow.BOUGHTWATCH, data.b);
  if (data.g && budgetName(data.g)) attributes.BUDGETWATCH = mergeWatch(attrsNow.BUDGETWATCH, data.g, 10);
  if (!data.m && !data.k && !data.b && !data.g) attributes.DIGEST = 'yes';
  if (existing.ok) {
    await brevo(env, 'PUT', `/contacts/${encodeURIComponent(data.e)}`, { attributes, listIds: [listId], emailBlacklisted: false });
  } else {
    const made = await brevo(env, 'POST', '/contacts', { email: data.e, attributes, listIds: [listId], updateEnabled: true });
    if (!made.ok) return Response.redirect(`${site}/alerts-confirmed.html?status=error`, 302);
  }
  if (data.f && FB_RX.test(data.f) && isNewWatch) await countInvite(env, data.f);
  const one = data.m && !String(data.m).includes(',') ? '&m=' + data.m : '';
  const multi = String(data.m || '').includes(',') ? (data.l === 2 ? 'compare' : data.l ? 'list' : 'bag') : 'ok';
  const fbq = data.f && FB_RX.test(data.f) ? '&fb=1' : '';
  if (data.g && budgetName(data.g)) return Response.redirect(`${site}/alerts-confirmed.html?status=budget&g=${data.g}`, 302);
  return Response.redirect(`${site}/alerts-confirmed.html?status=${data.b ? 'bought' : data.k ? 'stock' : multi}${one}${fbq}`, 302);
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
  if (model === DIGEST_SLUG) {
    await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { DIGEST: 'no' } });
    return Response.redirect(`${site}/alerts-unsubscribed.html?status=digest`, 302);
  }
  if (model.startsWith('budget-') && budgetName(model.slice(7))) {
    const left = String((existing.data.attributes || {}).BUDGETWATCH || '').split(',').filter((x) => x && x !== model.slice(7)).join(',');
    await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { BUDGETWATCH: left } });
    return Response.redirect(`${site}/alerts-unsubscribed.html?status=budget`, 302);
  }
  if (model && SLUG_RX.test(model)) {
    const left = String((existing.data.attributes || {}).WATCHLIST || '').split(',').filter((x) => x && x !== model).join(',');
    await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { WATCHLIST: left } });
    return Response.redirect(`${site}/alerts-unsubscribed.html?status=model&m=${model}`, 302);
  }
  await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, {
    attributes: { WATCHLIST: '', STOCKWATCH: '', BOUGHTWATCH: '', BUDGETWATCH: '' }, unlinkListIds: [Number(env.LIST_ID || 3)],
  });
  return Response.redirect(`${site}/alerts-unsubscribed.html?status=ok`, 302);
}

/* ------------------------------------------------------------------ four-ball counts
   Cloudflare KV holds "c:<invite code>" -> number of golfers who joined
   through that invite, and "total" -> everyone who joined through any invite.
   Nothing else: no emails, no names. */
async function countInvite(env, code) {
  if (!env.FOURBALL || !FB_RX.test(code)) return;
  try {
    const n = Number(await env.FOURBALL.get('c:' + code)) || 0;
    const total = Number(await env.FOURBALL.get('total')) || 0;
    // Unused invite codes tidy themselves away after a year.
    await env.FOURBALL.put('c:' + code, String(n + 1), { expirationTtl: 365 * 86400 });
    await env.FOURBALL.put('total', String(total + 1));
  } catch (e) { console.log('fourball count failed', e && e.message); }
}

async function fourballCount(url, env, cors) {
  const code = url.searchParams.get('c') || '';
  let n = 0, total = 0;
  if (env.FOURBALL) {
    try {
      if (FB_RX.test(code)) n = Number(await env.FOURBALL.get('c:' + code, { cacheTtl: 60 })) || 0;
      total = Number(await env.FOURBALL.get('total', { cacheTtl: 300 })) || 0;
    } catch (e) { /* counts are a nice-to-have */ }
  }
  return json({ ok: true, n, total }, 200, Object.assign({ 'cache-control': 'public, max-age=60' }, cors));
}

/* ------------------------------------------------------------------ helpers */
// One entry per product ("slug|paid|date"); a new one replaces an older one for the same product.
function mergeBought(current, entry, max = 10) {
  const slug = entry.split('|')[0];
  const list = String(current || '').split(',').map((x) => x.trim()).filter((x) => BOUGHT_RX.test(x) && x.split('|')[0] !== slug);
  list.push(entry);
  return list.slice(-max).join(',');
}

function mergeWatch(current, model, max = 50) {
  const list = String(current || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (model && !list.includes(model)) list.push(model);
  return list.slice(-max).join(',');
}

async function sha1(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Product facts from the site's data/lookup/<xx>.json files (built every 6
// hours by scripts/email_lookup.py). Each id lives in the file named after the
// first two characters of its SHA-1.
async function lookup(env, ids) {
  const site = env.SITE || 'https://golfpriceai.com';
  const byShard = {};
  for (const id of ids) (byShard[(await sha1(id)).slice(0, 2)] ||= []).push(id);
  const out = {};
  await Promise.all(Object.entries(byShard).map(async ([key, list]) => {
    try {
      const r = await fetch(`${site}/data/lookup/${key}.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (!r.ok) return;
      const data = await r.json();
      for (const id of list) if (data[id]) out[id] = data[id];
    } catch (e) { /* missing file: those ids are just skipped */ }
  }));
  return out;
}

function money(n) {
  return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function ensureAttributes(env) {
  for (const name of ['WATCHLIST', 'CONSENT_AT', 'DIGEST', 'STOCKWATCH', 'BOUGHTWATCH', 'BUDGETWATCH']) {
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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers) });
}

// Light limits using the free edge cache: by default 5 per 10 minutes.
async function tooMany(id, max = 5, seconds = 600) {
  const cache = caches.default;
  const key = new Request(`https://rate.golfpriceai.invalid/${encodeURIComponent(id)}`);
  const hit = await cache.match(key);
  const n = hit ? Number(await hit.text()) : 0;
  if (n >= max) return true;
  await cache.put(key, new Response(String(n + 1), { headers: { 'cache-control': `max-age=${seconds}` } }));
  return false;
}

/* ------------------------------------------------------------------ emails
   One look for every GolfPrice AI email: the logo line, a white card, a green
   button and the same honest small print. Light on jokes, heavy on prices. */
function shell(inner, foot) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f7f8f6;font-family:Arial,Helvetica,sans-serif;color:#16241c">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<p style="font-size:22px;font-weight:bold;margin:0 0 4px">Golf<span style="color:#3fae29">Price</span> AI</p>
<p style="font-size:12px;color:#5b665f;margin:0 0 18px">Full Swing. Not full price.</p>
${inner}
<p style="font-size:12px;color:#5b665f;line-height:1.55;margin:20px 0 0">${foot}<br>No countdown timers. No fake discounts.</p>
</div></body></html>`;
}

function button(href, text) {
  return `<a href="${href}" style="display:inline-block;background:#3fae29;color:#fff;text-decoration:none;font-weight:bold;padding:13px 20px;border-radius:10px">${text}</a>`;
}

function confirmEmail(link, name, opts = {}) {
  const what = opts.budget
    ? `a budget alert for <strong>${escapeHtml(name)}</strong>. When a model we track drops under that price, we’ll email you about it`
    : opts.bought
    ? `a 30-day price watch on the <strong>${escapeHtml(name)}</strong> you bought. If its UK price drops below what you paid, we’ll email you once so you can ask the retailer to match it. Then we forget it`
    : opts.stock
    ? `a back-in-stock alert for the <strong>${escapeHtml(name)}</strong>. We’ll email you once, when it’s back on the shelf`
    : opts.count > 1
    ? `price alerts for the <strong>${opts.count} items ${opts.list === 'compare' ? 'you’re comparing' : opts.list ? 'on the four-ball shortlist' : 'in your bag'}</strong>. We’ll email you when any of them genuinely drops in price`
    : name
    ? `a price alert for the <strong>${escapeHtml(name)}</strong>. We’ll email you when its UK price genuinely drops`
    : `the GolfPrice AI Friday email: the week’s genuine UK golf price drops, checked against our own price history`;
  const joke = opts.budget
    ? 'Set a budget. Stick to it. We’ll help with the first part.'
    : opts.list === 'compare'
    ? 'Can’t choose? Let the prices decide. They usually do.'
    : opts.bought
    ? 'You’ve done the buying. We’ll do the worrying.'
    : opts.stock
    ? 'We’ll keep an eye on the shelves. You keep an eye on your tempo.'
    : opts.fb || opts.list
    ? 'Now the whole four-ball’s watching. Someone still has to get the first round in.'
    : 'We watch the prices every 6 hours, so you can watch the ball instead.';
  return shell(`<div style="background:#fff;border:1px solid #e7e9e5;border-radius:14px;padding:24px">
<p style="font-size:16px;line-height:1.5;margin:0 0 10px">Someone (hopefully you) asked for ${what}.</p>
<p style="font-size:14px;line-height:1.5;color:#4a554e;margin:0 0 20px">${joke}</p>
<p style="margin:0 0 22px">${button(link, 'Yes, send me alerts')}</p>
<p style="font-size:13px;line-height:1.5;color:#5b665f;margin:0">No click, no emails: if this wasn’t you, just ignore this message. The link works for 7 days.</p>
</div>`, 'Unsubscribe from any alert in one click.');
}

function listEmail(items, site, watching) {
  const total = items.reduce((t, i) => t + i.price, 0);
  const rows = items.map((i) => {
    const img = i.image
      ? `<img src="${escapeHtml(i.image)}" alt="" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:contain;border-radius:8px;background:#fff;border:1px solid #e7e9e5">`
      : `<div style="width:56px;height:56px;border-radius:8px;background:#f2f7ef"></div>`;
    const compare = i.slug
      ? ` · <a href="${site}/prices/${i.slug}/?utm_source=bag-list&amp;utm_medium=email" style="color:#2f8a1f">compare prices</a>` : '';
    const stock = i.inStock ? '' : ' · <span style="color:#b42318">sold out right now</span>';
    return `<tr>
<td style="padding:12px 12px 12px 0;border-top:1px solid #e7e9e5;vertical-align:top;width:56px">${img}</td>
<td style="padding:12px 8px 12px 0;border-top:1px solid #e7e9e5;vertical-align:top">
<a href="${escapeHtml(i.link)}" style="color:#16241c;font-weight:bold;font-size:14px;text-decoration:none">${escapeHtml(i.name)}</a>
<div style="font-size:12px;color:#5b665f;margin-top:3px">at ${escapeHtml(i.retailer)}${stock}${compare}</div></td>
<td style="padding:12px 0;border-top:1px solid #e7e9e5;vertical-align:top;text-align:right;white-space:nowrap;font-weight:bold;font-size:15px">${money(i.price)}</td>
</tr>`;
  }).join('');
  const watchNote = watching
    ? `<p style="font-size:14px;line-height:1.5;margin:16px 0 0;background:#f2f7ef;border-radius:10px;padding:12px 14px">You also asked for price alerts on ${watching === 1 ? 'one of these' : `${watching} of these`}. Check your inbox for a separate confirmation email: one click and we’ll tell you when ${watching === 1 ? 'it drops' : 'any of them drop'}.</p>`
    : '';
  const when = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  return shell(`<div style="background:#fff;border:1px solid #e7e9e5;border-radius:14px;padding:22px">
<p style="font-size:19px;font-weight:bold;margin:0 0 6px">Here’s the bag you built</p>
<p style="font-size:14px;line-height:1.5;color:#4a554e;margin:0 0 14px">Every item, with today’s price and a link to buy it. Now the only thing standing between you and a lower score is… well, you. Sorry.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}
<tr><td></td><td style="padding:14px 8px 0 0;border-top:2px solid #16241c;font-weight:bold;font-size:15px">Total</td>
<td style="padding:14px 0 0;border-top:2px solid #16241c;text-align:right;font-weight:bold;font-size:18px;white-space:nowrap">${money(total)}</td></tr></table>
${watchNote}
<p style="margin:20px 0 0">${button(`${site}/build-your-bag.html?utm_source=bag-list&amp;utm_medium=email`, 'Tweak your bag')}</p>
</div>`, `Prices checked at ${escapeHtml(when)} and can change on the retailer’s site, so check before you buy. We may earn a commission if you buy through our links; it never changes the price.<br>
You (or someone using your email address) asked us to send this list from golfpriceai.com. It’s a one-off: we haven’t added you to any mailing list.`);
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
