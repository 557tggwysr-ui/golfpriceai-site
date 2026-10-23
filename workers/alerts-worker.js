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
 *                   The same namespace also holds the Demand Index's
 *                   anonymous daily counts ("d:..." keys, see signal())
 *                   until the DEMAND database below is added.
 *                   It also holds Par Price scores and leagues (pp_* tables,
 *                   see parPrice()).
 *   DEMAND          D1 database binding (Worker > Settings > Bindings >
 *                   D1 database, named golfpriceai-demand). The Demand
 *                   Index's exact, once-per-visitor daily counts. It sets
 *                   up its own tables.
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
      if (url.pathname === '/signal' && request.method === 'POST') return await signal(request, env, cors);
      if (url.pathname === '/demand-counts' && request.method === 'GET') return await demandCounts(request, url, env);
      if (url.pathname.startsWith('/pp/')) return await parPrice(request, url, env, cors);
      if (url.pathname.startsWith('/draft/')) return await bagDraft(request, url, env, cors);
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
  if (!model && !stock && (body.remind === 'daily' || body.remind === 'weekly')) {
    // Par Price tee-time reminder: one email when the round is ready.
    return await startSubscription({ email, models: [], stock: '', remind: body.remind, name: 'Par Price', request, env, cors });
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
async function startSubscription({ email, models, stock, bought = '', budget = '', remind = '', name, list = '', fb = '', request, env, cors, quiet }) {

  // Already confirmed? Add the model straight away.
  const existing = await brevo(env, 'GET', `/contacts/${encodeURIComponent(email)}`);
  const listId = Number(env.LIST_ID || 3);
  const attrs = (existing.ok && existing.data.attributes) || {};
  if (existing.ok && (existing.data.listIds || []).includes(listId) && !existing.data.emailBlacklisted) {
    await ensureAttributes(env);
    if (remind) {
      await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { PPREMIND: remind } });
      return json({ ok: true, status: 'added-remind' }, 200, cors);
    }
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

  const payload = b64url(JSON.stringify({ e: email, m: models.join(','), k: stock, b: bought, g: budget, r: remind, f: fb, l: list === 'compare' ? 2 : list ? 1 : 0, t: Date.now() }));
  const sig = await sign(env, payload);
  const link = `${new URL(request.url).origin}/confirm?d=${payload}&s=${sig}`;
  const subject = remind ? 'Confirm your Par Price tee-time reminder'
    : budget ? `Confirm your budget alert: ${name}`
    : bought ? `Confirm your price watch for the ${name} you bought`
    : stock ? `Confirm your back-in-stock alert for the ${name}`
    : models.length > 1 ? `Confirm price alerts for the ${models.length} items ${list === 'compare' ? 'you’re comparing' : list ? 'on the shortlist' : 'in your bag'}`
    : models.length ? `Confirm your price alert for the ${name || 'model you picked'}`
    : 'Confirm your GolfPrice AI Friday email';
  const sent = await brevo(env, 'POST', '/smtp/email', {
    sender: { name: 'GolfPrice AI', email: env.SENDER_EMAIL || 'alerts@golfpriceai.com' },
    to: [{ email }],
    subject,
    htmlContent: confirmEmail(link, name, { remind, stock: !!stock, bought: !!bought, budget: !!budget, count: models.length, list, fb: !!fb }),
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
  if (data.r === 'daily' || data.r === 'weekly') attributes.PPREMIND = data.r;
  if (!data.m && !data.k && !data.b && !data.g && !data.r) attributes.DIGEST = 'yes';
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
  if (data.r === 'daily' || data.r === 'weekly') return Response.redirect(`${site}/alerts-confirmed.html?status=remind&r=${data.r}`, 302);
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
  if (model === 'remind') {
    await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { PPREMIND: '' } });
    return Response.redirect(`${site}/alerts-unsubscribed.html?status=remind`, 302);
  }
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
    attributes: { WATCHLIST: '', STOCKWATCH: '', BOUGHTWATCH: '', BUDGETWATCH: '', PPREMIND: '' }, unlinkListIds: [Number(env.LIST_ID || 3)],
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

/* ------------------------------------------------------------------ Demand Index counts
   The UK Golf Demand Index (golfpriceai.com/demand/) adds up anonymous daily
   counts: price-page views, shortlist hearts, site searches and Par Price
   guesses. Each count lives in the FOURBALL KV namespace as
     "d:<day>:<kind>:<model or search words>"  ->  a number (n, plus s for guesses)
   and tidies itself away after 70 days. Nothing about the visitor is kept:
   no IP address, no cookie, no email. The IP is used only for a moment, as a
   one-way hash in the free edge cache, so one visitor counts once per model
   per day and can't stuff the chart. */
const SIGNAL_KINDS = { view: 1, heart: 1, search: 1, pp: 1 };
const DEMAND_TTL = 70 * 86400;
function cleanSearch(q) {
  const t = String(q || '').toLowerCase().replace(/[^a-z0-9 .'&+-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 40 || /\d{5,}/.test(t) || t.split(' ').length > 6) return '';
  return t;
}
async function signal(request, env, cors) {
  const ok = json({ ok: true }, 200, cors);
  const origin = request.headers.get('origin') || '';
  if (!(env.DEMAND || env.FOURBALL) || ![env.SITE || 'https://golfpriceai.com', 'https://www.golfpriceai.com'].includes(origin)) return ok;
  let body = {};
  try { body = JSON.parse((await request.text()).slice(0, 2000)); } catch (e) { return ok; }
  const kind = String(body.k || '');
  if (!SIGNAL_KINDS[kind]) return ok;
  let items = [];
  if (kind === 'pp') {
    // One Par Price round: [[slug, guess / real price], ...], at most 5.
    items = (Array.isArray(body.items) ? body.items : []).slice(0, 5)
      .filter((x) => Array.isArray(x) && SLUG_RX.test(String(x[0])) && Number(x[1]) > 0)
      .map((x) => [String(x[0]), Math.log(Math.min(5, Math.max(0.2, Number(x[1]))))]);
  } else if (kind === 'search') {
    const q = cleanSearch(body.q);
    if (q) items = [[q, 0]];
  } else if (SLUG_RX.test(String(body.m || ''))) {
    items = [[String(body.m), 0]];
  }
  if (!items.length) return ok;
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (env.DEMAND) return await signalD1(env, day, ip, kind, items, ok);
  if (await tooMany('sig:' + (await sha1(ip + day)), 120, 86400)) return ok;
  const cache = caches.default;
  for (const [key, val] of items) {
    const seen = new Request(`https://seen.golfpriceai.invalid/${await sha1([ip, day, kind, key].join('|'))}`);
    if (await cache.match(seen)) continue; // this visitor already counted for this today
    await cache.put(seen, new Response('1', { headers: { 'cache-control': 'max-age=86400' } }));
    // Free KV allows about 1,000 writes a day; leave room for everything else.
    if (await tooMany('kvw:' + day, Number(env.DEMAND_DAILY_WRITES || 700), 86400)) break;
    const k = `d:${day}:${kind}:${key}`;
    try {
      const cur = (await env.FOURBALL.getWithMetadata(k)).metadata || {};
      const meta = { n: (Number(cur.n) || 0) + 1, s: Math.round(((Number(cur.s) || 0) + val) * 10000) / 10000 };
      await env.FOURBALL.put(k, String(meta.n), { expirationTtl: DEMAND_TTL, metadata: meta });
    } catch (e) { console.log('demand count failed', e && e.message); }
  }
  return ok;
}

/* With the DEMAND database (Cloudflare D1, free) bound, counting is exact:
   "seen" holds a one-way daily code per visitor (a salted hash of the IP that
   changes every day and can't be turned back into an address), so each
   visitor counts once per model per day; rows older than yesterday are
   deleted. "counts" holds the daily totals, deleted after 70 days. */
let demandReady = false;
async function demandSetup(env) {
  if (demandReady) return;
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS seen (day TEXT, v TEXT, kind TEXT, key TEXT, PRIMARY KEY (day, v, kind, key)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS counts (day TEXT, kind TEXT, key TEXT, n INTEGER, s REAL, PRIMARY KEY (day, kind, key)) WITHOUT ROWID'),
  ]);
  demandReady = true;
}
async function signalD1(env, day, ip, kind, items, ok) {
  try {
    await demandSetup(env);
    const v = (await sha1([ip, day, env.ALERTS_SECRET || ''].join('|'))).slice(0, 16);
    const used = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM seen WHERE day = ? AND v = ?').bind(day, v).first('c');
    if (used >= 120) return ok; // nobody genuinely browses 120 models a day
    for (const [key, val] of items) {
      const r = await env.DEMAND.prepare('INSERT OR IGNORE INTO seen (day, v, kind, key) VALUES (?, ?, ?, ?)').bind(day, v, kind, key).run();
      if (!r.meta || !r.meta.changes) continue; // already counted today
      await env.DEMAND.prepare('INSERT INTO counts (day, kind, key, n, s) VALUES (?, ?, ?, 1, ?) ' +
        'ON CONFLICT (day, kind, key) DO UPDATE SET n = n + 1, s = s + excluded.s').bind(day, kind, key, val).run();
    }
  } catch (e) { console.log('demand count failed', e && e.message); }
  return ok;
}

// The 6-hourly update reads every count (only with the shared secret, because
// raw search words are kept off the public site).
async function demandCounts(request, url, env) {
  const want = await sign(env, 'demand-counts');
  if ((request.headers.get('x-demand-key') || '') !== want) return json({ ok: false }, 403);
  const rows = [];
  if (env.DEMAND) {
    await demandSetup(env);
    const now = Date.now();
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
    const cutoff = new Date(now - 70 * 86400000).toISOString().slice(0, 10);
    await env.DEMAND.batch([
      env.DEMAND.prepare('DELETE FROM seen WHERE day < ?').bind(yesterday),
      env.DEMAND.prepare('DELETE FROM counts WHERE day < ?').bind(cutoff),
    ]);
    const res = await env.DEMAND.prepare('SELECT day, kind, key, n, s FROM counts').all();
    for (const r of res.results || []) rows.push([r.day, r.kind, r.key, Number(r.n) || 0, Math.round((Number(r.s) || 0) * 10000) / 10000]);
  }
  if (!env.FOURBALL) return json({ ok: true, rows, fourball: 0 }, 200, { 'cache-control': 'no-store' });
  let cursor;
  for (let i = 0; i < 20; i++) {
    const page = await env.FOURBALL.list({ prefix: 'd:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const [, day, kind, ...rest] = k.name.split(':');
      const m = k.metadata || {};
      rows.push([day, kind, rest.join(':'), Number(m.n) || 0, Number(m.s) || 0]);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  let fourball = 0;
  try { fourball = Number(await env.FOURBALL.get('total')) || 0; } catch (e) { /* optional */ }
  return json({ ok: true, rows, fourball }, 200, { 'cache-control': 'no-store' });
}

/* ------------------------------------------------------------------ Par Price: scores and leagues
   Everything lives in the DEMAND database (Cloudflare D1). A player is a
   random id their browser made up (pid): no email, no name, no cookie. A
   league is a name, a short code for the link, and its members' nicknames.
     pp_scores   one row per player per round (the first finished round counts)
     pp_leagues  id, name, created, last active
     pp_members  league, pid, nickname
   Quiet leagues are deleted after 90 days; scores after 120. */
const PP_LAUNCH = Date.UTC(2026, 9, 18); // Par Price #1
const PID_RX = /^[a-z0-9]{12,32}$/;
const LEAGUE_RX = /^[a-hj-km-np-z2-9]{6}$/;
const GRID_RX = /^[EBPOD]{5}$/;
const PP_GRID_PTS = { E: -2, B: -1, P: 0, O: 1, D: 2 };
const MAX_MEMBERS = 40;
const MISSED = 5; // a missed round counts as +5 in the weekly table
const RUDE = ['fuck', 'shit', 'cunt', 'wank', 'twat', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'nigg', 'fag', 'retard', 'slut', 'whore', 'paki', 'spast', 'nazi', 'rape', 'porn', 'sex', 'piss', 'arse', 'bollock', 'tosser', 'prick', 'knob', 'bellend', 'minge', 'coon', 'kike', 'chink', 'tranny', 'dyke'];

function ppToday() { return Math.floor((Date.now() - PP_LAUNCH) / 864e5) + 1; }
function ppDay(n) { return new Date(PP_LAUNCH + (n - 1) * 864e5).toISOString().slice(0, 10); }
function ppMonday(n) { const dow = (new Date(PP_LAUNCH + (n - 1) * 864e5).getUTCDay() + 6) % 7; return n - dow; } // round number of that week's Monday
function cleanName(s, min, max) {
  const t = String(s || '').replace(/[^\p{L}\p{N} '’.&!?-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (t.length < min) return '';
  const flat = t.toLowerCase().replace(/[^a-z]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's');
  return RUDE.some((w) => flat.includes(w)) ? null : t;
}
function leagueCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map((x) => a[x % a.length]).join('');
}
let ppReady = false;
async function ppSetup(env) {
  if (ppReady) return;
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pp_scores (n INTEGER, pid TEXT, total INTEGER, grid TEXT, pin REAL, PRIMARY KEY (n, pid)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pp_leagues (id TEXT PRIMARY KEY, name TEXT, owner TEXT, created TEXT, active TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pp_members (league TEXT, pid TEXT, nick TEXT, joined TEXT, PRIMARY KEY (league, pid)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS pp_members_pid ON pp_members (pid)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pp_moves (code TEXT PRIMARY KEY, pid TEXT, data TEXT, exp INTEGER) WITHOUT ROWID'),
  ]);
  ppReady = true;
}

async function parPrice(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'Leagues are taking a short break. Please try again later.' }, 503, cors);
  await ppSetup(env);
  const path = url.pathname;
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, 4000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (await tooMany('pp-' + ip, 60, 600)) return json({ ok: false, error: 'Easy, tiger. Please try again in a few minutes.' }, 429, cors);
  }
  const pid = PID_RX.test(String(body.pid || url.searchParams.get('pid') || '')) ? String(body.pid || url.searchParams.get('pid')) : '';
  if (path === '/pp/score' && request.method === 'POST') return await ppScore(env, body, pid, cors);
  if (path === '/pp/dist') return await ppDist(env, Number(url.searchParams.get('n')), cors);
  if (path === '/pp/my') return await ppMy(env, pid, cors);
  if (path === '/pp/league/create' && request.method === 'POST') return await ppCreate(env, body, pid, cors);
  if (path === '/pp/league/join' && request.method === 'POST') return await ppJoin(env, body, pid, cors);
  if (path === '/pp/league/leave' && request.method === 'POST') return await ppLeave(env, body, pid, cors);
  if (path === '/pp/league') return await ppLeague(env, String(url.searchParams.get('l') || ''), pid, cors);
  if (path === '/pp/move/create' && request.method === 'POST') return await ppMoveCreate(env, body, pid, cors);
  if (path === '/pp/move/claim' && request.method === 'POST') return await ppMoveClaim(env, body, request.headers.get('cf-connecting-ip') || '', cors);
  return new Response('Not found', { status: 404, headers: cors });
}

/* Play on another device. No logins, so a player is the random id in their
   browser. The device they already use asks for a code (8 characters, 30
   minutes, works once); the new device swaps the code for that id plus the few
   things kept in the browser (nickname, streak, today's card). */
const MOVE_MINS = 30;
async function ppMoveCreate(env, body, pid, cors) {
  if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const now = Date.now();
  await env.DEMAND.prepare('DELETE FROM pp_moves WHERE exp < ? OR pid = ?').bind(now, pid).run();
  const data = JSON.stringify(body.data && typeof body.data === 'object' ? body.data : {});
  if (data.length > 3000) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const code = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => a[x % a.length]).join('');
  await env.DEMAND.prepare('INSERT INTO pp_moves (code, pid, data, exp) VALUES (?, ?, ?, ?)').bind(code, pid, data, now + MOVE_MINS * 60000).run();
  return json({ ok: true, code, mins: MOVE_MINS }, 200, cors);
}
async function ppMoveClaim(env, body, ip, cors) {
  if (await tooMany('ppmove-' + ip, 10, 600)) return json({ ok: false, error: 'Too many tries. Please wait ten minutes and try again.' }, 429, cors);
  const code = String(body.code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/^[a-hj-km-np-z2-9]{8}$/.test(code)) return json({ ok: false, error: 'That code doesn’t look right. It’s 8 letters and numbers, like ABCD-2345.' }, 400, cors);
  const row = await env.DEMAND.prepare('SELECT pid, data FROM pp_moves WHERE code = ? AND exp >= ?').bind(code, Date.now()).first();
  if (!row) return json({ ok: false, error: 'That code has run out or been used. Get a fresh one on your other device.' }, 404, cors);
  await env.DEMAND.prepare('DELETE FROM pp_moves WHERE code = ?').bind(code).run();
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch (e) { /* keep empty */ }
  return json({ ok: true, pid: row.pid, data }, 200, cors);
}

async function ppScore(env, body, pid, cors) {
  const n = Number(body.n), grid = String(body.grid || ''), today = ppToday();
  if (!pid || !Number.isInteger(n) || n < today - 1 || n > today + 1 || !GRID_RX.test(grid)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const total = [...grid].reduce((t, c) => t + PP_GRID_PTS[c], 0); // from the holes, never trusted from the page
  const pin = typeof body.pin === 'number' && body.pin >= 0 && body.pin < 100000 ? Math.round(body.pin * 100) / 100 : null; // null = skipped
  await env.DEMAND.prepare('INSERT OR IGNORE INTO pp_scores (n, pid, total, grid, pin) VALUES (?, ?, ?, ?, ?)').bind(n, pid, total, grid, pin).run();
  if (pin !== null) await env.DEMAND.prepare('UPDATE pp_scores SET pin = ? WHERE n = ? AND pid = ? AND pin IS NULL').bind(pin, n, pid).run();
  await env.DEMAND.prepare('UPDATE pp_leagues SET active = ? WHERE id IN (SELECT league FROM pp_members WHERE pid = ?)').bind(ppDay(today), pid).run();
  return await ppDist(env, n, cors);
}

async function ppDist(env, n, cors) {
  if (!Number.isInteger(n)) return json({ ok: false }, 400, cors);
  const rows = (await env.DEMAND.prepare('SELECT total, COUNT(*) AS c FROM pp_scores WHERE n = ? GROUP BY total').bind(n).all()).results || [];
  const dist = {};
  rows.forEach((r) => { dist[r.total] = r.c; });
  return json({ ok: true, n, dist }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}

async function ppMy(env, pid, cors) {
  if (!pid) return json({ ok: true, leagues: [] }, 200, cors);
  const rows = (await env.DEMAND.prepare('SELECT l.id, l.name, m.nick, (SELECT COUNT(*) FROM pp_members x WHERE x.league = l.id) AS size FROM pp_members m JOIN pp_leagues l ON l.id = m.league WHERE m.pid = ? ORDER BY m.joined').bind(pid).all()).results || [];
  return json({ ok: true, leagues: rows }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}

async function ppCreate(env, body, pid, cors) {
  const name = cleanName(body.name, 3, 30), nick = cleanName(body.nick, 2, 20);
  if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  if (name === null || nick === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Try another name.' }, 400, cors);
  if (!name) return json({ ok: false, error: 'Give your league a name (at least 3 letters).' }, 400, cors);
  if (!nick) return json({ ok: false, error: 'Pick a nickname (at least 2 letters).' }, 400, cors);
  const mine = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM pp_leagues WHERE owner = ?').bind(pid).first('c');
  if (mine >= 10) return json({ ok: false, error: 'Ten leagues is plenty, even for you.' }, 429, cors);
  const day = ppDay(ppToday());
  // Tidy up quiet leagues and old scores while we're here.
  const quiet = ppDay(ppToday() - 90);
  await env.DEMAND.batch([
    env.DEMAND.prepare('DELETE FROM pp_members WHERE league IN (SELECT id FROM pp_leagues WHERE active < ?)').bind(quiet),
    env.DEMAND.prepare('DELETE FROM pp_leagues WHERE active < ?').bind(quiet),
    env.DEMAND.prepare('DELETE FROM pp_scores WHERE n < ?').bind(ppToday() - 120),
  ]);
  for (let i = 0; i < 5; i++) {
    const id = leagueCode();
    const r = await env.DEMAND.prepare('INSERT OR IGNORE INTO pp_leagues (id, name, owner, created, active) VALUES (?, ?, ?, ?, ?)').bind(id, name, pid, day, day).run();
    if (r.meta && r.meta.changes) {
      await env.DEMAND.prepare('INSERT OR REPLACE INTO pp_members (league, pid, nick, joined) VALUES (?, ?, ?, ?)').bind(id, pid, nick, day).run();
      return json({ ok: true, id, name }, 200, cors);
    }
  }
  return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500, cors);
}

async function ppJoin(env, body, pid, cors) {
  const id = String(body.id || ''), nick = cleanName(body.nick, 2, 20);
  if (!pid || !LEAGUE_RX.test(id)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  if (nick === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Try another nickname.' }, 400, cors);
  if (!nick) return json({ ok: false, error: 'Pick a nickname (at least 2 letters).' }, 400, cors);
  const league = await env.DEMAND.prepare('SELECT name FROM pp_leagues WHERE id = ?').bind(id).first();
  if (!league) return json({ ok: false, error: 'That league has packed up its clubs. Ask for a fresh link.' }, 404, cors);
  const size = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM pp_members WHERE league = ? AND pid != ?').bind(id, pid).first('c');
  if (size >= MAX_MEMBERS) return json({ ok: false, error: 'This league is full (40 golfers). Start your own?' }, 400, cors);
  const taken = await env.DEMAND.prepare('SELECT 1 AS x FROM pp_members WHERE league = ? AND pid != ? AND LOWER(nick) = LOWER(?)').bind(id, pid, nick).first();
  if (taken) return json({ ok: false, error: 'Someone in this league already goes by that. Try another nickname.' }, 400, cors);
  await env.DEMAND.prepare('INSERT INTO pp_members (league, pid, nick, joined) VALUES (?, ?, ?, ?) ON CONFLICT (league, pid) DO UPDATE SET nick = excluded.nick')
    .bind(id, pid, nick, ppDay(ppToday())).run();
  await env.DEMAND.prepare('UPDATE pp_leagues SET active = ? WHERE id = ?').bind(ppDay(ppToday()), id).run();
  return json({ ok: true, id, name: league.name }, 200, cors);
}

async function ppLeave(env, body, pid, cors) {
  const id = String(body.id || '');
  if (!pid || !LEAGUE_RX.test(id)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  await env.DEMAND.prepare('DELETE FROM pp_members WHERE league = ? AND pid = ?').bind(id, pid).run();
  return json({ ok: true }, 200, cors);
}

async function ppLeague(env, id, pid, cors) {
  if (!LEAGUE_RX.test(id)) return json({ ok: false, error: 'That doesn’t look like a league link.' }, 400, cors);
  const league = await env.DEMAND.prepare('SELECT id, name, created FROM pp_leagues WHERE id = ?').bind(id).first();
  if (!league) return json({ ok: false, error: 'That league has packed up its clubs. Ask for a fresh link.' }, 404, cors);
  const today = ppToday(), from = Math.max(1, today - 89), monday = ppMonday(today);
  const members = (await env.DEMAND.prepare('SELECT pid, nick, joined FROM pp_members WHERE league = ? ORDER BY joined, nick').bind(id).all()).results || [];
  const scores = (await env.DEMAND.prepare('SELECT s.n, s.pid, s.total, s.grid, s.pin FROM pp_scores s JOIN pp_members m ON m.pid = s.pid AND m.league = ? WHERE s.n >= ?').bind(id, from).all()).results || [];
  const byN = {};
  scores.forEach((r) => { (byN[r.n] = byN[r.n] || {})[r.pid] = r; });
  const people = members.map((m) => {
    const mine = (n) => (byN[n] || {})[m.pid];
    let week = 0, played = 0, eagles = 0;
    for (let n = monday; n <= today; n++) {
      const r = mine(n);
      if (r) { week += r.total; played++; eagles += (r.grid.match(/E/g) || []).length; }
      else if (n < today) week += MISSED; // today isn't over yet
    }
    let streak = 0;
    for (let n = mine(today) ? today : today - 1; n >= from && mine(n); n--) streak++;
    return { pid: m.pid, nick: m.nick, you: m.pid === pid, today: mine(today) ? { total: mine(today).total, grid: mine(today).grid } : null,
      week, played, eagles, streak, wins: 0 };
  });
  // Wins: rounds where you had the best score among members who played (ties share it).
  for (let n = from; n < today; n++) {
    const day = byN[n];
    if (!day || Object.keys(day).length < 2) continue;
    const best = Math.min(...Object.values(day).map((r) => r.total));
    people.forEach((p) => { if (day[p.pid] && day[p.pid].total === best) p.wins++; });
  }
  const pinOf = (n) => {
    const rows = Object.values(byN[n] || {}).filter((r) => r.pin !== null && r.pin !== undefined);
    if (!rows.length) return null;
    rows.sort((a, b) => a.pin - b.pin);
    const who = members.find((m) => m.pid === rows[0].pid);
    return { nick: who ? who.nick : '', off: rows[0].pin };
  };
  const out = people.map(({ pid: p, ...rest }) => rest); // never send other players' ids
  return json({ ok: true, id: league.id, name: league.name, n: today, monday, missed: MISSED, members: out,
    pin: { today: pinOf(today), yesterday: pinOf(today - 1) } }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}

/* ------------------------------------------------------------------ The Bag Draft (monthly fantasy golf kit)
   One row per player per season (a month, "2026-11") in the DEMAND database.
   Picks are priced from the site's own /data/draft/catalogue.json at the
   moment they're drafted, never from the page, so nobody can invent a price.
   Points = £ a pick has fallen since it was drafted (rises cost points),
   +10 while it sits at the lowest price we've tracked; a locked pick keeps
   the points it had when locked; a transferred-out pick's points are banked.
   Bags are sealed (only you see yours) until the 8th. "test" is a practice
   season that's always open, for trying it out before launch. */
const BD_FIRST = '2026-11';
const BD_BUDGET = 1500;
const BD_SLOTS = ['driver', 'irons', 'putter', 'ball', 'tech', 'wild'];
let bdReady = false;
async function bdSetup(env) {
  if (bdReady) return;
  await ppSetup(env);
  await env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS bd_drafts (season TEXT, pid TEXT, nick TEXT, picks TEXT, banked INTEGER, tweek TEXT, locked INTEGER, updated TEXT, PRIMARY KEY (season, pid)) WITHOUT ROWID').run();
  bdReady = true;
}
async function bdCatalogue(env) {
  const site = env.SITE || 'https://golfpriceai.com';
  const r = await fetch(`${site}/data/draft/catalogue.json`, { cf: { cacheTtl: 900, cacheEverything: true } });
  if (!r.ok) throw new Error('catalogue ' + r.status);
  const cat = await r.json();
  const by = {};
  (cat.items || []).forEach((it) => { by[it.slug] = it; });
  return { cat, by };
}
// A finished Major is scored from its final-whistle prices (data/draft/final/<season>.json,
// left by the last price run of that month), so the table stops moving when the Major ends.
async function bdFinal(env, season, by) {
  const site = env.SITE || 'https://golfpriceai.com';
  try {
    const r = await fetch(`${site}/data/draft/final/${season}.json`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!r.ok) return by;
    const f = await r.json(), out = {};
    for (const [slug, v] of Object.entries(f.prices || {})) out[slug] = Object.assign({}, by[slug] || {}, { slug, price: v[0], low: v[1] });
    return out;
  } catch (e) { return by; }
}
function bdPhase(season) {
  const now = new Date(), cur = now.toISOString().slice(0, 7), day = now.getUTCDate();
  if (season === 'test') return { season, open: true, canEdit: true, canJoin: true, revealed: true, canTransfer: true, live: true };
  const live = season === cur && season >= BD_FIRST;
  return { season, live, open: live && day <= 21, canEdit: live && day <= 7, canJoin: live && day <= 21,
    revealed: season < cur || (live && day >= 8), canTransfer: live && day >= 8, over: season < cur };
}
function bdWeek() { const d = new Date(); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
function bdScore(row, by) {
  const picks = JSON.parse(row.picks || '[]').map((p) => {
    const cur = by[p.slug];
    const now = cur ? cur.price : p.price;
    const pts = p.lock !== undefined && p.lock !== null ? p.lock
      : Math.round(p.price - now) + (cur && cur.low && now < p.price ? 10 : 0);
    return Object.assign({}, p, { now, pts, name: cur ? cur.name : p.name, image: cur ? cur.image : p.image, low: cur ? cur.low : 0, note: cur ? cur.note : '' });
  });
  return { picks, total: (row.banked || 0) + picks.reduce((t, p) => t + p.pts, 0) };
}

async function bagDraft(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'The draft room is closed for a moment. Please try again later.' }, 503, cors);
  await bdSetup(env);
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, 4000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    if (await tooMany('bd-' + (request.headers.get('cf-connecting-ip') || ''), 40, 600)) return json({ ok: false, error: 'Easy, tiger. Please try again in a few minutes.' }, 429, cors);
  }
  const q = (k) => String(body[k] !== undefined ? body[k] : url.searchParams.get(k) || '');
  const pid = PID_RX.test(q('pid')) ? q('pid') : '';
  const season = q('season') === 'test' ? 'test' : /^\d{4}-\d{2}$/.test(q('season')) ? q('season') : new Date().toISOString().slice(0, 7);
  const phase = bdPhase(season);
  const path = url.pathname;
  let { by } = await bdCatalogue(env);
  if (phase.over) by = await bdFinal(env, season, by);
  const mine = pid ? await env.DEMAND.prepare('SELECT * FROM bd_drafts WHERE season = ? AND pid = ?').bind(season, pid).first() : null;

  if (path === '/draft/state') {
    const rows = (await env.DEMAND.prepare('SELECT pid, nick, picks, banked FROM bd_drafts WHERE season = ?').bind(season).all()).results || [];
    const ranked = rows.map((r) => ({ pid: r.pid, nick: r.nick, pts: bdScore(r, by).total })).sort((a, b) => b.pts - a.pts);
    const pos = ranked.findIndex((r) => r.pid === pid);
    return json({ ok: true, phase, mine: mine ? Object.assign({ nick: mine.nick, banked: mine.banked || 0, locked: !!mine.locked,
      transferUsed: mine.tweek === bdWeek() }, bdScore(mine, by)) : null,
      national: { count: ranked.length, top: ranked.slice(0, 20).map((r) => ({ nick: r.nick, pts: r.pts, you: r.pid === pid })), rank: pos >= 0 ? pos + 1 : null } },
      200, Object.assign({ 'cache-control': 'no-store' }, cors));
  }
  if (path === '/draft/league') {
    const id = q('l');
    if (!LEAGUE_RX.test(id)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const league = await env.DEMAND.prepare('SELECT name FROM pp_leagues WHERE id = ?').bind(id).first();
    if (!league) return json({ ok: false, error: 'That league has packed up its clubs.' }, 404, cors);
    const rows = (await env.DEMAND.prepare('SELECT m.pid, m.nick AS mnick, d.picks, d.banked FROM pp_members m LEFT JOIN bd_drafts d ON d.pid = m.pid AND d.season = ? WHERE m.league = ?').bind(season, id).all()).results || [];
    const members = rows.map((r) => {
      const you = r.pid === pid, drafted = !!r.picks;
      const s = drafted ? bdScore(r, by) : null;
      return { nick: r.mnick, you, drafted, pts: s ? s.total : null,
        picks: s && (phase.revealed || you) ? s.picks.map((p) => ({ slot: p.slot, name: p.name, image: p.image, price: p.price, now: p.now, pts: p.pts, lock: p.lock })) : null };
    }).sort((a, b) => (b.pts ?? -1e9) - (a.pts ?? -1e9));
    return json({ ok: true, id, name: league.name, phase, members }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  }
  if (request.method !== 'POST' || !pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);

  if (path === '/draft/save') {
    if (!phase.open) return json({ ok: false, error: phase.live ? 'The draft window has closed for this month. Next Major opens on the 1st.' : 'The Black Friday Open opens on 1 November. Not long now.' }, 400, cors);
    if (mine && !phase.canEdit) return json({ ok: false, error: 'Bags are sealed now. Use your weekly transfer to make changes.' }, 400, cors);
    if (!mine && !phase.canJoin) return json({ ok: false, error: 'Entries have closed for this month.' }, 400, cors);
    const nick = cleanName(body.nick, 2, 20);
    if (nick === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Try another nickname.' }, 400, cors);
    if (!nick) return json({ ok: false, error: 'Pick a nickname for the leaderboard (at least 2 letters).' }, 400, cors);
    const want = body.picks || {};
    const picks = [];
    for (const slot of BD_SLOTS) {
      const it = by[String(want[slot] || '')];
      if (!it || it.slot !== slot) return json({ ok: false, error: 'Fill all six slots first.' }, 400, cors);
      picks.push({ slot, slug: it.slug, name: it.name, image: it.image, price: it.price, at: new Date().toISOString().slice(0, 10) });
    }
    const spent = picks.reduce((t, p) => t + p.price, 0);
    if (spent > BD_BUDGET + 0.001) return json({ ok: false, error: `That bag costs £${spent.toFixed(2)}. The budget is £${BD_BUDGET}.` }, 400, cors);
    await env.DEMAND.prepare('INSERT INTO bd_drafts (season, pid, nick, picks, banked, tweek, locked, updated) VALUES (?, ?, ?, ?, 0, \'\', 0, ?) ON CONFLICT (season, pid) DO UPDATE SET nick = excluded.nick, picks = excluded.picks, banked = 0, locked = 0, updated = excluded.updated')
      .bind(season, pid, nick, JSON.stringify(picks), new Date().toISOString()).run();
    return json({ ok: true }, 200, cors);
  }
  if (!mine) return json({ ok: false, error: 'Draft your bag first.' }, 400, cors);
  const picks = JSON.parse(mine.picks);
  const slot = q('slot');
  const i = picks.findIndex((p) => p.slot === slot);
  if (i < 0) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const scored = bdScore(mine, by);
  if (path === '/draft/lock') {
    if (mine.locked) return json({ ok: false, error: 'You’ve already used your lock this Major.' }, 400, cors);
    if (phase.over) return json({ ok: false, error: 'This Major is over.' }, 400, cors);
    picks[i].lock = scored.picks[i].pts;
    await env.DEMAND.prepare('UPDATE bd_drafts SET picks = ?, locked = 1, updated = ? WHERE season = ? AND pid = ?').bind(JSON.stringify(picks), new Date().toISOString(), season, pid).run();
    return json({ ok: true, locked: picks[i].lock }, 200, cors);
  }
  if (path === '/draft/transfer') {
    if (!phase.canTransfer) return json({ ok: false, error: phase.canEdit ? 'Before the 8th you can just redraft your bag.' : 'This Major is over.' }, 400, cors);
    if (mine.tweek === bdWeek()) return json({ ok: false, error: 'One transfer a week. The window reopens on Monday.' }, 400, cors);
    if (picks[i].lock !== undefined && picks[i].lock !== null) return json({ ok: false, error: 'That pick is locked in. It stays put.' }, 400, cors);
    const it = by[q('slug')];
    if (!it || it.slot !== slot) return json({ ok: false, error: 'That product doesn’t fit that slot.' }, 400, cors);
    const spent = picks.reduce((t, p, k) => t + (k === i ? 0 : p.price), 0) + it.price;
    if (spent > BD_BUDGET + 0.001) return json({ ok: false, error: `That would take your bag to £${spent.toFixed(2)}. The budget is £${BD_BUDGET}.` }, 400, cors);
    const banked = (mine.banked || 0) + scored.picks[i].pts;
    picks[i] = { slot, slug: it.slug, name: it.name, image: it.image, price: it.price, at: new Date().toISOString().slice(0, 10) };
    await env.DEMAND.prepare('UPDATE bd_drafts SET picks = ?, banked = ?, tweek = ?, updated = ? WHERE season = ? AND pid = ?')
      .bind(JSON.stringify(picks), banked, bdWeek(), new Date().toISOString(), season, pid).run();
    return json({ ok: true, banked }, 200, cors);
  }
  return new Response('Not found', { status: 404, headers: cors });
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
  for (const name of ['WATCHLIST', 'CONSENT_AT', 'DIGEST', 'STOCKWATCH', 'BOUGHTWATCH', 'BUDGETWATCH', 'PPREMIND']) {
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
  const what = opts.remind
    ? `a Par Price tee-time reminder: one email ${opts.remind === 'weekly' ? 'every Monday morning' : 'each morning'} when the new round is ready`
    : opts.budget
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
  const joke = opts.remind
    ? 'Five prices, one round, no green fees. Big Dave has probably played already.'
    : opts.budget
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
<p style="margin:0 0 22px">${button(link, opts.remind ? 'Yes, remind me' : 'Yes, send me alerts')}</p>
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
