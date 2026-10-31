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
 *   STATS_KEY       secret  John's own key for the private Clubhouse stats page
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
      if (url.pathname.startsWith('/soc/')) return await society(request, url, env, cors);
      if (url.pathname.startsWith('/ace/')) return await aceRegister(request, url, env, cors);
      if (url.pathname === '/stats' && request.method === 'POST') return await clubStats(request, env, cors);
      if (url.pathname === '/use' && request.method === 'POST') return await useCount(request, env, cors);
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
  await useBump(env, 'alert_signup');
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

/* ------------------------------------------------------------------ usage counts
   Anonymous daily tallies for John's stats page: how many golfers started a
   Par Price round or a Bag Draft, opened My Clubhouse, used a Move code or
   confirmed a price alert. One count per visitor per kind per day (the same
   hashed, daily-forgotten visitor key as the Demand Index); no ids kept. */
const USE_KINDS = { pp_start: 1, bd_start: 1, mc_view: 1, band_0_9: 1, band_10_18: 1, band_19_28: 1, band_28_plus: 1, band_none: 1, hcp_share: 1,
  calc_index: 1, calc_course: 1, calc_playing: 1, calc_shoot: 1, calc_share: 1,
  ms_first_hcp: 1, ms_scratch: 1, ms_bandit: 1, ms_champion: 1, ms_streak: 1, ms_share: 1,
  ace_view: 1, ace_share: 1 };
async function useSetup(env) {
  await env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS use_counts (day TEXT, kind TEXT, n INTEGER, PRIMARY KEY (day, kind)) WITHOUT ROWID').run();
}
async function useBump(env, kind) {
  if (!env.DEMAND) return;
  try {
    await useSetup(env);
    await env.DEMAND.prepare('INSERT INTO use_counts (day, kind, n) VALUES (?, ?, 1) ON CONFLICT (day, kind) DO UPDATE SET n = n + 1')
      .bind(new Date().toISOString().slice(0, 10), kind).run();
  } catch (e) { /* counts are a nice-to-have */ }
}
async function useCount(request, env, cors) {
  const ok = json({ ok: true }, 200, cors);
  const origin = request.headers.get('origin') || '';
  if (!env.DEMAND || ![env.SITE || 'https://golfpriceai.com', 'https://www.golfpriceai.com'].includes(origin)) return ok;
  let body = {};
  try { body = JSON.parse((await request.text()).slice(0, 200)); } catch (e) { return ok; }
  const kind = String(body.k || '');
  if (!USE_KINDS[kind]) return ok;
  try {
    await demandSetup(env);
    const day = new Date().toISOString().slice(0, 10), ip = request.headers.get('cf-connecting-ip') || '';
    const v = (await sha1([ip, day, env.ALERTS_SECRET || ''].join('|'))).slice(0, 16);
    const r = await env.DEMAND.prepare('INSERT OR IGNORE INTO seen (day, v, kind, key) VALUES (?, ?, ?, ?)').bind(day, v, 'use', kind).run();
    if (r.meta && r.meta.changes) await useBump(env, kind);
  } catch (e) { /* fine */ }
  return ok;
}


/* ------------------------------------------------------------------ The Ace Register
   Golfers log a hole-in-one against a course from the UK course list
   (golfpriceai.com/data/courses/uk.json, from OpenStreetMap). Public boards
   show the nickname, course, hole, yards, club and date only. Witnesses and
   the ball stay on the golfer's own certificate and never reach this worker.
   Courses golfers suggest wait for John's approval on the stats page. */
const ACE_COURSE_RX = /^(?:[nwr]\d{1,12}|x\d{1,6})$/;
let aceReady = false;
async function aceSetup(env) {
  if (aceReady) return;
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS ace_aces (id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT, nick TEXT, course TEXT, cname TEXT, ctown TEXT, hole INTEGER, yards INTEGER, par INTEGER, club TEXT, day TEXT, public INTEGER, created TEXT)'),
    env.DEMAND.prepare('CREATE UNIQUE INDEX IF NOT EXISTS ace_once ON ace_aces (pid, course, hole, day)'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS ace_course ON ace_aces (course)'),
    env.DEMAND.prepare("CREATE TABLE IF NOT EXISTS ace_suggest (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, town TEXT, created TEXT, status TEXT DEFAULT 'pending')"),
  ]);
  aceReady = true;
}
let aceCourses = null, aceCoursesAt = 0;
async function aceCourse(env, id) {
  if (id[0] === 'x') {
    const r = await env.DEMAND.prepare("SELECT name, town FROM ace_suggest WHERE id = ? AND status = 'approved'").bind(Number(id.slice(1))).first();
    return r ? { n: r.name, t: r.town || '' } : null;
  }
  if (!aceCourses || Date.now() - aceCoursesAt > 6 * 3600e3) {
    const res = await fetch((env.SITE || 'https://golfpriceai.com') + '/data/courses/uk.json', { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!res.ok) return null;
    const d = await res.json(), m = {};
    (d.courses || []).forEach((c) => { m[c.id] = c; });
    aceCourses = m; aceCoursesAt = Date.now();
  }
  return aceCourses[id] || null;
}
function aceClean(s, max) { return String(s || '').replace(/[^\p{L}\p{N} '’.&()/-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max); }
async function aceRegister(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'The Ace Register is taking a short break. Please try again later.' }, 503, cors);
  await aceSetup(env);
  const path = url.pathname, db = env.DEMAND;
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, 2000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (await tooMany('ace-' + ip, 20, 3600)) return json({ ok: false, error: 'Easy, tiger. Please try again later.' }, 429, cors);
  }
  const year = new Date().toISOString().slice(0, 4);

  if (path === '/ace/log' && request.method === 'POST') {
    const pid = PID_RX.test(String(body.pid || '')) ? String(body.pid) : '';
    const nick = cleanName(body.nick, 2, 20), course = String(body.course || '');
    const hole = Math.round(Number(body.hole)), yards = Math.round(Number(body.yards)), par = Math.round(Number(body.par) || 3);
    const club = aceClean(body.club, 24), day = String(body.day || ''), pub = body.public === false ? 0 : 1;
    if (!pid || !ACE_COURSE_RX.test(course)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    if (nick === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Try another nickname.' }, 400, cors);
    if (!nick) return json({ ok: false, error: 'Pick a nickname (at least 2 letters).' }, 400, cors);
    if (!(hole >= 1 && hole <= 27)) return json({ ok: false, error: 'Which hole? Pick 1 to 27.' }, 400, cors);
    if (!(yards >= 40 && yards <= 650)) return json({ ok: false, error: 'How long was the hole, in yards?' }, 400, cors);
    if (![3, 4, 5].includes(par)) return json({ ok: false, error: 'Par should be 3, 4 or 5.' }, 400, cors);
    if (!club) return json({ ok: false, error: 'Which club did it?' }, 400, cors);
    const today = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today || day < '1950-01-01') return json({ ok: false, error: 'That date doesn’t look right.' }, 400, cors);
    const c = await aceCourse(env, course);
    if (!c) return json({ ok: false, error: 'We couldn’t find that course. Pick it from the list.' }, 400, cors);
    const recent = await db.prepare('SELECT COUNT(*) AS c FROM ace_aces WHERE pid = ? AND created >= ?').bind(pid, new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)).first('c');
    if (recent >= 6) return json({ ok: false, error: 'Six aces in a year? Tour card, surely. Get in touch and we’ll sort it.' }, 429, cors);
    const had = await db.prepare('SELECT id FROM ace_aces WHERE pid = ? AND course = ? AND hole = ? AND day = ?').bind(pid, course, hole, day).first();
    const r = had ? { meta: { changes: 0 } } : await db.prepare('INSERT OR IGNORE INTO ace_aces (pid, nick, course, cname, ctown, hole, yards, par, club, day, public, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(pid, nick, course, aceClean(c.n, 80), aceClean(c.t || '', 40), hole, yards, par, club, day, pub, new Date().toISOString().slice(0, 10)).run();
    const row = await db.prepare('SELECT id FROM ace_aces WHERE pid = ? AND course = ? AND hole = ? AND day = ?').bind(pid, course, hole, day).first();
    if (!row) return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500, cors);
    const onBoard = await db.prepare('SELECT COUNT(*) AS c FROM ace_aces WHERE course = ? AND public = 1 AND id <= ?').bind(course, row.id).first('c');
    const inYear = await db.prepare('SELECT COUNT(*) AS c FROM ace_aces WHERE substr(day, 1, 4) = ? AND id <= ?').bind(day.slice(0, 4), row.id).first('c');
    return json({ ok: true, again: !(r.meta && r.meta.changes), no: row.id, onBoard, inYear, course: { id: course, n: c.n, t: c.t || '' } }, 200, cors);
  }

  if (path === '/ace/board') {
    const course = String(url.searchParams.get('c') || '');
    if (!ACE_COURSE_RX.test(course)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const rows = (await db.prepare('SELECT nick, hole, yards, par, club, day FROM ace_aces WHERE course = ? AND public = 1 ORDER BY day DESC LIMIT 200').bind(course).all()).results || [];
    const c = await aceCourse(env, course);
    return json({ ok: true, course: c ? { id: course, n: c.n, t: c.t || '' } : null, aces: rows }, 200, Object.assign({ 'cache-control': 'public, max-age=120' }, cors));
  }

  if (path === '/ace/latest') {
    const latest = (await db.prepare('SELECT nick, course, cname, ctown, hole, yards, club, day FROM ace_aces WHERE public = 1 ORDER BY id DESC LIMIT 12').all()).results || [];
    const total = await db.prepare('SELECT COUNT(*) AS c FROM ace_aces WHERE substr(day, 1, 4) = ?').bind(year).first('c');
    const courses = await db.prepare('SELECT COUNT(DISTINCT course) AS c FROM ace_aces').first('c');
    const clubs = (await db.prepare('SELECT lower(club) AS club, COUNT(*) AS c FROM ace_aces GROUP BY lower(club) ORDER BY c DESC LIMIT 1').all()).results || [];
    const holes = (await db.prepare('SELECT course, cname, hole, COUNT(*) AS c FROM ace_aces WHERE public = 1 GROUP BY course, hole HAVING c >= 2 ORDER BY c DESC LIMIT 5').all()).results || [];
    return json({ ok: true, year, total, courses, topClub: clubs[0] ? clubs[0].club : null, latest, holes }, 200, Object.assign({ 'cache-control': 'public, max-age=120' }, cors));
  }

  // For the nightly course pages: public ace counts per course, and each
  // course's hungriest hole. No nicknames.
  if (path === '/ace/summary') {
    const rows = (await db.prepare('SELECT course, hole, COUNT(*) AS c FROM ace_aces WHERE public = 1 GROUP BY course, hole').all()).results || [];
    const out = {};
    rows.forEach((r) => {
      const o = out[r.course] || (out[r.course] = { aces: 0, hole: null, top: 0 });
      o.aces += Number(r.c);
      if (Number(r.c) > o.top) { o.top = Number(r.c); o.hole = r.hole; }
    });
    return json({ ok: true, courses: out }, 200, Object.assign({ 'cache-control': 'public, max-age=300' }, cors));
  }

  if (path === '/ace/extra') {
    const rows = (await db.prepare("SELECT id, name, town FROM ace_suggest WHERE status = 'approved'").all()).results || [];
    return json({ ok: true, courses: rows.map((r) => ({ id: 'x' + r.id, n: r.name, t: r.town || '' })) }, 200, Object.assign({ 'cache-control': 'public, max-age=600' }, cors));
  }

  if (path === '/ace/suggest' && request.method === 'POST') {
    const name = cleanName(body.name, 4, 80), town = cleanName(body.town, 2, 40);
    if (name === null || town === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse.' }, 400, cors);
    if (!name || !town) return json({ ok: false, error: 'Give us the course name and the town.' }, 400, cors);
    const waiting = await db.prepare("SELECT COUNT(*) AS c FROM ace_suggest WHERE status = 'pending'").first('c');
    if (waiting >= 200) return json({ ok: false, error: 'We’re catching up on new courses. Please try again in a day or two.' }, 429, cors);
    await db.prepare('INSERT INTO ace_suggest (name, town, created) VALUES (?, ?, ?)').bind(name, town, new Date().toISOString().slice(0, 10)).run();
    return json({ ok: true }, 200, cors);
  }

  // John only: approve or turn down a suggested course, or take an ace off the boards.
  if (path === '/ace/admin' && request.method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (await keyLocked(ip)) return json({ ok: false, error: 'Too many wrong tries. The door opens again in ten minutes.' }, 429, cors);
    if (!keyMatches(env, body.key)) { await tooMany('stats-' + ip, 5, 600); return json({ ok: false, error: 'That key isn’t right.' }, 403, cors); }
    const id = Number(body.id), act = String(body.action || '');
    if (!(id > 0)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    if (act === 'approve' || act === 'reject') await db.prepare('UPDATE ace_suggest SET status = ? WHERE id = ?').bind(act === 'approve' ? 'approved' : 'rejected', id).run();
    else if (act === 'remove') await db.prepare('DELETE FROM ace_aces WHERE id = ?').bind(id).run();
    else return json({ ok: false, error: 'Bad request.' }, 400, cors);
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: false, error: 'Not found.' }, 404, cors);
}
async function keyLocked(ip) {
  const hit = await caches.default.match(new Request(`https://rate.golfpriceai.invalid/${encodeURIComponent('stats-' + ip)}`));
  return !!(hit && Number(await hit.text()) >= 5);
}
function keyMatches(env, key) {
  if (!env.STATS_KEY) return false;
  const given = new TextEncoder().encode(String(key || '')), want = new TextEncoder().encode(String(env.STATS_KEY));
  let same = given.length === want.length;
  for (let i = 0; i < want.length; i++) same = same && given[i] === want[i];
  return same;
}

/* ------------------------------------------------------------------ Clubhouse stats
   John's private usage page (golfpriceai.com/stats/). POST /stats { key }.
   The key is a Cloudflare secret, STATS_KEY, that only John knows; five wrong
   tries in ten minutes locks the door. Counts only: no emails, society or
   league names ever leave this function. The one exception is the Ace
   Register's moderation list (nicknames already public on the ace boards). */
async function clubStats(request, env, cors) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const lockKey = new Request(`https://rate.golfpriceai.invalid/${encodeURIComponent('stats-' + ip)}`);
  const hit = await caches.default.match(lockKey);
  if (hit && Number(await hit.text()) >= 5) return json({ ok: false, error: 'Too many wrong tries. The door opens again in ten minutes.' }, 429, cors);
  if (!env.STATS_KEY) return json({ ok: false, error: 'The stats key isn’t set up in Cloudflare yet (STATS_KEY).' }, 503, cors);
  let body = {};
  try { body = JSON.parse((await request.text()).slice(0, 500)); } catch (e) { /* empty */ }
  const given = new TextEncoder().encode(String(body.key || '')), want = new TextEncoder().encode(String(env.STATS_KEY));
  let same = given.length === want.length;
  for (let i = 0; i < want.length; i++) same = same && given[i] === want[i];
  if (!same) { await tooMany('stats-' + ip, 5, 600); return json({ ok: false, error: 'That key isn’t right.' }, 403, cors); }
  if (!env.DEMAND) return json({ ok: false, error: 'No database attached.' }, 503, cors);

  const db = env.DEMAND, out = { ok: true, at: new Date().toISOString() };
  const one = async (sql, ...args) => { try { return Number(await db.prepare(sql).bind(...args).first('c')) || 0; } catch (e) { return null; } };
  const all = async (sql, ...args) => { try { return (await db.prepare(sql).bind(...args).all()).results || []; } catch (e) { return []; } };
  const today = ppToday(), monday = ppMonday(today), from30 = today - 29;
  const monthStart = ppToday() - (new Date().getUTCDate() - 1);
  const PLAY = 'SELECT n, pid FROM pp_scores UNION SELECT n, pid FROM hl_scores';

  // Players: anyone who finished a Par Price round or a daily Higher or Lower run.
  out.players = {
    today: await one(`SELECT COUNT(DISTINCT pid) AS c FROM (${PLAY}) WHERE n = ?`, today),
    week: await one(`SELECT COUNT(DISTINCT pid) AS c FROM (${PLAY}) WHERE n >= ?`, monday),
    month: await one(`SELECT COUNT(DISTINCT pid) AS c FROM (${PLAY}) WHERE n >= ?`, monthStart),
    ever: await one(`SELECT COUNT(DISTINCT pid) AS c FROM (${PLAY})`),
    newToday: await one(`SELECT COUNT(*) AS c FROM (SELECT pid, MIN(n) AS f FROM (${PLAY}) GROUP BY pid) WHERE f = ?`, today),
    sameDayLastWeek: await one(`SELECT COUNT(DISTINCT pid) AS c FROM (${PLAY}) WHERE n = ?`, today - 7),
  };
  const daily = await all(`SELECT n, COUNT(DISTINCT pid) AS c FROM (${PLAY}) WHERE n >= ? GROUP BY n`, from30);
  const rounds = await all('SELECT n, COUNT(*) AS c FROM pp_scores WHERE n >= ? GROUP BY n', from30);
  const by = (rows) => { const m = {}; rows.forEach((r) => { m[r.n] = Number(r.c) || 0; }); return m; };
  const dp = by(daily), dr = by(rounds);
  out.daily = [];
  for (let n = Math.max(1, from30); n <= today; n++) out.daily.push({ day: ppDay(n), players: dp[n] || 0, rounds: dr[n] || 0 });

  out.games = {
    ppToday: await one('SELECT COUNT(*) AS c FROM pp_scores WHERE n = ?', today),
    pp7: await one('SELECT COUNT(*) AS c FROM pp_scores WHERE n > ?', today - 7),
    hlToday: await one('SELECT COUNT(*) AS c FROM hl_scores WHERE n = ?', today),
    hl7: await one('SELECT COUNT(*) AS c FROM hl_scores WHERE n > ?', today - 7),
    draftMonth: await one('SELECT COUNT(*) AS c FROM bd_drafts WHERE season = ?', new Date().toISOString().slice(0, 7)),
    streak3: await one('SELECT COUNT(*) AS c FROM (SELECT pid FROM pp_scores WHERE n > ? GROUP BY pid HAVING COUNT(*) >= 3 AND MAX(n) >= ?)', today - 3, today - 1),
  };

  const sizes = (await all('SELECT league, COUNT(*) AS c FROM pp_members GROUP BY league')).map((r) => Number(r.c) || 0);
  out.leagues = {
    count: await one('SELECT COUNT(*) AS c FROM pp_leagues'),
    members: await one('SELECT COUNT(*) AS c FROM pp_members'),
    players: await one('SELECT COUNT(DISTINCT pid) AS c FROM pp_members'),
    biggest: sizes.length ? Math.max(...sizes) : 0,
    average: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length * 10) / 10 : 0,
    activeWeek: await one('SELECT COUNT(DISTINCT m.league) AS c FROM pp_members m JOIN pp_scores s ON s.pid = m.pid WHERE s.n >= ?', monday),
    newWeek: await one('SELECT COUNT(*) AS c FROM pp_leagues WHERE created >= ?', ppDay(monday)),
    linked: await one('SELECT COUNT(*) AS c FROM soc_league'),
  };

  const socSizes = (await all('SELECT soc, COUNT(*) AS c FROM soc_members GROUP BY soc')).map((r) => Number(r.c) || 0);
  const day = new Date().toISOString().slice(0, 10), weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  out.societies = {
    count: await one('SELECT COUNT(*) AS c FROM soc_socs'),
    members: await one('SELECT COUNT(*) AS c FROM soc_members'),
    listed: await one('SELECT COUNT(*) AS c FROM soc_socs WHERE open = 1'),
    biggest: socSizes.length ? Math.max(...socSizes) : 0,
    average: socSizes.length ? Math.round(socSizes.reduce((a, b) => a + b, 0) / socSizes.length * 10) / 10 : 0,
    newWeek: await one('SELECT COUNT(*) AS c FROM soc_socs WHERE created >= ?', weekAgo),
    daysAhead: await one('SELECT COUNT(*) AS c FROM soc_events WHERE day >= ?', day),
    insAhead: await one("SELECT COUNT(*) AS c FROM soc_entries e JOIN soc_events v ON v.id = e.event WHERE v.day >= ? AND e.status = 'in'", day),
    founding: await one('SELECT COUNT(*) AS c FROM soc_founding'),
    kits: await one('SELECT COUNT(*) AS c FROM soc_kits'),
    prizes: await one("SELECT COUNT(*) AS c FROM soc_prizes WHERE choice IS NOT NULL AND choice != ''"),
  };

  // Growth: leagues and societies in existence at the end of each of the last 6 weeks.
  const lgDays = (await all('SELECT created FROM pp_leagues')).map((r) => String(r.created || ''));
  const scDays = (await all('SELECT created FROM soc_socs')).map((r) => String(r.created || ''));
  out.growth = [];
  for (let i = 5; i >= 0; i--) {
    const end = ppDay(monday - 7 * i + 6);
    out.growth.push({ week: ppDay(monday - 7 * i), leagues: lgDays.filter((d) => d && d <= end).length, societies: scDays.filter((d) => d && d <= end).length });
  }

  // ---- Do golfers come back? First played 7 to 13 days ago: did they play again within 7 days?
  const cohort = await all(`WITH play AS (${PLAY}), f AS (SELECT pid, MIN(n) AS f FROM play GROUP BY pid)
    SELECT COUNT(*) AS total, SUM(CASE WHEN EXISTS (SELECT 1 FROM play p WHERE p.pid = f.pid AND p.n > f.f AND p.n <= f.f + 7) THEN 1 ELSE 0 END) AS back
    FROM f WHERE f.f BETWEEN ? AND ?`, today - 13, today - 7);
  const ch = cohort[0] || {};
  out.retention = { cohort: Number(ch.total) || 0, back: Number(ch.back) || 0,
    returningToday: Math.max(0, (out.players.today || 0) - (out.players.newToday || 0)) };

  // ---- Started v finished (starts come from the anonymous /use counts)
  let use = [];
  try { await useSetup(env); use = await all('SELECT day, kind, n FROM use_counts WHERE day >= ?', new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10)); } catch (e) { /* none yet */ }
  const sumUse = (kind, since) => use.filter((r) => r.kind === kind && r.day >= since).reduce((s, r) => s + (Number(r.n) || 0), 0);
  const d7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), mon1 = new Date().toISOString().slice(0, 8) + '01';
  out.funnel = {
    ppStartToday: sumUse('pp_start', day), ppStart7: sumUse('pp_start', d7),
    bdStartMonth: sumUse('bd_start', mon1),
  };

  // ---- Price Handicap, golfer bands and the handicap calculators (anonymous counts only)
  const d30 = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  out.handicap = {
    withHcp: await one('SELECT COUNT(*) AS c FROM (SELECT pid FROM pp_scores WHERE n > ? GROUP BY pid HAVING COUNT(*) >= 5)', today - 120),
    shares7: sumUse('hcp_share', d7), shares30: sumUse('hcp_share', d30),
    bands: { b0_9: sumUse('band_0_9', d30), b10_18: sumUse('band_10_18', d30), b19_28: sumUse('band_19_28', d30),
      b28: sumUse('band_28_plus', d30), none: sumUse('band_none', d30) },
    calc: ['calc_index', 'calc_course', 'calc_playing', 'calc_shoot', 'calc_share',
      'ms_first_hcp', 'ms_scratch', 'ms_bandit', 'ms_champion', 'ms_streak', 'ms_share'].reduce((o, k) => {
      o[k] = { today: sumUse(k, day), d7: sumUse(k, d7) }; return o; }, {}),
  };

  // ---- The Ace Register: counts, plus courses to approve and the latest aces to check.
  try {
    await aceSetup(env);
    out.aces = {
      total: await one('SELECT COUNT(*) AS c FROM ace_aces'),
      week: await one('SELECT COUNT(*) AS c FROM ace_aces WHERE created >= ?', weekAgo),
      courses: await one('SELECT COUNT(DISTINCT course) AS c FROM ace_aces'),
      pending: await all("SELECT id, name, town, created FROM ace_suggest WHERE status = 'pending' ORDER BY id LIMIT 50"),
      recent: await all('SELECT id, nick, cname, hole, yards, club, day, public FROM ace_aces ORDER BY id DESC LIMIT 20'),
    };
  } catch (e) { out.aces = null; }

  // ---- League and society health
  out.leagues.twoActive = await one('SELECT COUNT(*) AS c FROM (SELECT m.league FROM pp_members m JOIN (SELECT DISTINCT pid FROM pp_scores WHERE n >= ?) s ON s.pid = m.pid GROUP BY m.league HAVING COUNT(*) >= 2)', monday);
  out.leagues.solo = await one('SELECT COUNT(*) AS c FROM (SELECT league FROM pp_members GROUP BY league HAVING COUNT(*) = 1)');
  out.societies.withDay = await one('SELECT COUNT(DISTINCT soc) AS c FROM soc_events WHERE day >= ?', day);
  const evs = await all(`SELECT v.id, v.cap, (SELECT COUNT(*) FROM soc_members m WHERE m.soc = v.soc) AS members,
    (SELECT COUNT(*) FROM soc_entries e WHERE e.event = v.id) AS replies,
    (SELECT COUNT(*) FROM soc_entries e WHERE e.event = v.id AND e.status = 'in') AS ins,
    (SELECT COUNT(*) FROM soc_entries e WHERE e.event = v.id AND e.status = 'wait') AS waits
    FROM soc_events v WHERE v.day >= ?`, day);
  const rates = evs.filter((e) => Number(e.members) > 0).map((e) => Math.min(1, Number(e.replies) / Number(e.members)));
  out.societies.replyRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 100) : null;
  out.societies.full = evs.filter((e) => Number(e.cap) > 0 && Number(e.ins) >= Number(e.cap)).length;
  out.societies.waitlists = evs.filter((e) => Number(e.waits) > 0).length;

  // ---- The ecosystem link: golfers using two or more parts (games, leagues, societies, Bag Draft)
  const ecoSql = (parts) => `WITH play AS (${PLAY}) SELECT SUM(CASE WHEN c >= 2 THEN 1 ELSE 0 END) AS multi, COUNT(*) AS anyuse FROM (
    SELECT pid, COUNT(DISTINCT src) AS c FROM (${parts.join(' UNION ')}) GROUP BY pid)`;
  const parts = ["SELECT DISTINCT pid, 'g' AS src FROM play", "SELECT DISTINCT pid, 'l' FROM pp_members", "SELECT DISTINCT pid, 's' FROM soc_members", "SELECT DISTINCT pid, 'd' FROM bd_drafts WHERE season != 'test'"];
  let eco = await all(ecoSql(parts));
  if (!eco.length) eco = await all(ecoSql(parts.slice(0, 3))); // no Bag Draft table yet
  const ec = eco[0] || {};
  out.ecosystem = { multi: Number(ec.multi) || 0, any: Number(ec.anyuse) || 0 };

  // ---- From fun to shopping
  const hearts = await all("SELECT day, SUM(n) AS c FROM counts WHERE kind = 'heart' AND day >= ? GROUP BY day", d7);
  out.shopping = {
    savesToday: hearts.filter((r) => r.day === day).reduce((s, r) => s + (Number(r.c) || 0), 0),
    saves7: hearts.reduce((s, r) => s + (Number(r.c) || 0), 0),
    alertsToday: sumUse('alert_signup', day), alerts7: sumUse('alert_signup', d7),
    clubhouseToday: sumUse('mc_view', day), clubhouse7: sumUse('mc_view', d7),
    moves7: sumUse('move_used', d7),
  };

  out.other = { fourball: 0, alerts: null };
  try { if (env.FOURBALL) out.other.fourball = Number(await env.FOURBALL.get('total')) || 0; } catch (e) { /* fine */ }
  try {
    if (env.BREVO_API_KEY) {
      const r = await brevo(env, 'GET', `/contacts/lists/${Number(env.LIST_ID || 3)}`);
      if (r.ok && r.data) out.other.alerts = Number(r.data.uniqueSubscribers || r.data.totalSubscribers) || 0;
    }
  } catch (e) { /* fine */ }
  return json(out, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
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
/* Price Handicap: worked out like a real handicap. Take your last 20 Par Price
   rounds, average the best 8 (with fewer than 20 rounds, the best 40% of them),
   one decimal place. Needs 5 rounds. Lower is better; below 0 is a "plus"
   handicap, shown as +1.2. `upto` lets us ask what it was 30 days ago. */
const HCP_MIN = 5;
function hcpCalc(rows, upto) {
  const r = rows.filter((x) => x.n <= upto).sort((a, b) => b.n - a.n).slice(0, 20);
  if (r.length < HCP_MIN) return null;
  const k = Math.max(1, Math.round(r.length * 0.4));
  const best = r.map((x) => x.total).sort((a, b) => a - b).slice(0, k);
  return Math.round(best.reduce((a, b) => a + b, 0) / k * 10) / 10;
}
function hcpDetail(rows, today) {
  const last = rows.filter((x) => x.n <= today).sort((a, b) => b.n - a.n).slice(0, 20);
  const value = hcpCalc(rows, today), before = hcpCalc(rows, today - 30);
  const k = Math.max(1, Math.round(last.length * 0.4));
  const counted = last.map((x, i) => ({ i, t: x.total })).sort((a, b) => a.t - b.t || a.i - b.i).slice(0, k).map((x) => x.i);
  return { value, rounds: last.length, need: Math.max(0, HCP_MIN - last.length),
    trend: value !== null && before !== null ? Math.round((value - before) * 10) / 10 : null,
    last: last.map((x, i) => ({ n: x.n, t: x.total, c: value !== null && counted.includes(i) })).reverse() };
}
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
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pp_prefs (pid TEXT PRIMARY KEY, hidden INTEGER) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS hl_scores (n INTEGER, pid TEXT, streak INTEGER, PRIMARY KEY (n, pid)) WITHOUT ROWID'),
  ]);
  ppReady = true;
}

async function parPrice(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'Leagues are taking a short break. Please try again later.' }, 503, cors);
  await ppSetup(env);
  const path = url.pathname;
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, path === '/pp/move/create' ? 9000 : 4000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (await tooMany('pp-' + ip, 60, 600)) return json({ ok: false, error: 'Easy, tiger. Please try again in a few minutes.' }, 429, cors);
  }
  const pid = PID_RX.test(String(body.pid || url.searchParams.get('pid') || '')) ? String(body.pid || url.searchParams.get('pid')) : '';
  if (path === '/pp/score' && request.method === 'POST') return await ppScore(env, body, pid, cors);
  if (path === '/pp/hl' && request.method === 'POST') return await hlScore(env, body, pid, cors);
  if (path === '/pp/dist') return await ppDist(env, Number(url.searchParams.get('n')), cors);
  if (path === '/pp/my') return await ppMy(env, pid, cors);
  if (path === '/pp/league/create' && request.method === 'POST') return await ppCreate(env, body, pid, cors);
  if (path === '/pp/league/join' && request.method === 'POST') return await ppJoin(env, body, pid, cors);
  if (path === '/pp/league/leave' && request.method === 'POST') return await ppLeave(env, body, pid, cors);
  if (path === '/pp/league') return await ppLeague(env, String(url.searchParams.get('l') || ''), pid, cors);
  if (path === '/pp/report') {
    await bdSetup(env);
    return json(await ppReport(env, String(url.searchParams.get('l') || ''), pid, String(url.searchParams.get('w') || '')), 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  }
  if (path === '/pp/prefs' && request.method === 'POST') {
    // "Don't count me": keep this player's nickname off national leaderboards and the
    // Hall of Fame. Their own leagues still see them (that's the point of a league).
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await env.DEMAND.prepare('INSERT INTO pp_prefs (pid, hidden) VALUES (?, ?) ON CONFLICT (pid) DO UPDATE SET hidden = excluded.hidden').bind(pid, body.hidden ? 1 : 0).run();
    return json({ ok: true, hidden: !!body.hidden }, 200, cors);
  }
  if (path === '/pp/move/create' && request.method === 'POST') return await ppMoveCreate(env, body, pid, cors);
  if (path === '/pp/move/claim' && request.method === 'POST') return await ppMoveClaim(env, body, request.headers.get('cf-connecting-ip') || '', cors);
  return new Response('Not found', { status: 404, headers: cors });
}

/* Play on another device. No logins, so a player is the random id in their
   browser. The device they already use asks for a code (8 characters, 30
   minutes, works once); the new device swaps the code for that id plus the few
   things kept in the browser (nickname, streak, today's card, and the My
   Clubhouse lists: societies, shortlist, fit, bag). */
const MOVE_MINS = 30;
async function ppMoveCreate(env, body, pid, cors) {
  if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const now = Date.now();
  await env.DEMAND.prepare('DELETE FROM pp_moves WHERE exp < ? OR pid = ?').bind(now, pid).run();
  const data = JSON.stringify(body.data && typeof body.data === 'object' ? body.data : {});
  if (data.length > 8000) return json({ ok: false, error: 'Bad request.' }, 400, cors);
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
  await useBump(env, 'move_used');
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
  // My Clubhouse: your place in each league's weekly table (same sum as the
  // league page: this week's rounds, a missed past day counts +MISSED; lower is better).
  const today = ppToday(), monday = ppMonday(today);
  for (const r of rows.slice(0, 12)) {
    try {
      const t = (await env.DEMAND.prepare('SELECT m.pid, COALESCE(SUM(s.total), 0) AS tot, SUM(CASE WHEN s.n < ? THEN 1 ELSE 0 END) AS past FROM pp_members m LEFT JOIN pp_scores s ON s.pid = m.pid AND s.n >= ? AND s.n <= ? WHERE m.league = ? GROUP BY m.pid')
        .bind(today, monday, today, r.id).all()).results || [];
      const week = (x) => x.tot + MISSED * ((today - monday) - (x.past || 0));
      const me = t.find((x) => x.pid === pid);
      if (me) { const w = week(me); r.rank = 1 + t.filter((x) => week(x) < w).length; r.tied = t.filter((x) => x.pid !== pid && week(x) === w).length > 0; }
    } catch (e) { /* no rank: the page just shows the size */ }
  }
  let hcp = null;
  try {
    const mine = (await env.DEMAND.prepare('SELECT n, total FROM pp_scores WHERE pid = ? AND n > ? ORDER BY n DESC LIMIT 60').bind(pid, today - 120).all()).results || [];
    hcp = hcpDetail(mine, today);
  } catch (e) { /* no handicap yet: the page just leaves it out */ }
  return json({ ok: true, leagues: rows, hcp }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
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

/* ---- Higher or Lower: one daily run per player (the first finished run of
   the day counts), same pairs for everyone. Only the streak is stored. */
async function hlScore(env, body, pid, cors) {
  const n = Number(body.n), streak = Math.round(Number(body.streak));
  const today = ppToday();
  if (!pid || !(n === today || n === today - 1) || !(streak >= 0 && streak <= 50)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  await env.DEMAND.prepare('INSERT OR IGNORE INTO hl_scores (n, pid, streak) VALUES (?, ?, ?)').bind(n, pid, streak).run();
  const mine = await env.DEMAND.prepare('SELECT streak FROM hl_scores WHERE n = ? AND pid = ?').bind(n, pid).first('streak');
  const runs = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM hl_scores WHERE n = ?').bind(n).first('c');
  const below = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM hl_scores WHERE n = ? AND streak < ?').bind(n, mine).first('c');
  if (Math.random() < 0.02) await env.DEMAND.prepare('DELETE FROM hl_scores WHERE n < ?').bind(today - 120).run();
  return json({ ok: true, streak: mine, runs, beat: runs > 1 ? Math.round(below / (runs - 1) * 100) : null }, 200, cors);
}

async function ppLeague(env, id, pid, cors) {
  if (!LEAGUE_RX.test(id)) return json({ ok: false, error: 'That doesn’t look like a league link.' }, 400, cors);
  const league = await env.DEMAND.prepare('SELECT id, name, created, owner FROM pp_leagues WHERE id = ?').bind(id).first();
  if (!league) return json({ ok: false, error: 'That league has packed up its clubs. Ask for a fresh link.' }, 404, cors);
  const today = ppToday(), from = Math.max(1, today - 89), monday = ppMonday(today);
  const members = (await env.DEMAND.prepare('SELECT pid, nick, joined FROM pp_members WHERE league = ? ORDER BY joined, nick').bind(id).all()).results || [];
  const scores = (await env.DEMAND.prepare('SELECT s.n, s.pid, s.total, s.grid, s.pin FROM pp_scores s JOIN pp_members m ON m.pid = s.pid AND m.league = ? WHERE s.n >= ?').bind(id, from).all()).results || [];
  const byN = {};
  scores.forEach((r) => { (byN[r.n] = byN[r.n] || {})[r.pid] = r; });
  const hl = (await env.DEMAND.prepare('SELECT h.n, h.pid, h.streak FROM hl_scores h JOIN pp_members m ON m.pid = h.pid AND m.league = ? WHERE h.n >= ?').bind(id, monday).all()).results || [];
  const people = members.map((m) => {
    const hlMine = hl.filter((r) => r.pid === m.pid);
    const hlToday = hlMine.find((r) => r.n === today);
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
      week, played, eagles, streak, wins: 0,
      hl: { today: hlToday ? hlToday.streak : null, week: hlMine.length ? Math.max(...hlMine.map((r) => r.streak)) : null } };
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
  people.forEach((p) => {
    const rows = scores.filter((r) => r.pid === p.pid);
    p.hcp = hcpCalc(rows, today);
    const before = hcpCalc(rows, today - 30);
    p.hcpTrend = p.hcp !== null && before !== null ? Math.round((p.hcp - before) * 10) / 10 : null;
    p.scratch = p.hcp !== null && p.hcp <= 0;
  });
  // The Bandit: the biggest handicap cut in the league this month (at least a full shot, no ties).
  const cuts = people.filter((p) => p.hcpTrend !== null && p.hcpTrend <= -1).sort((a, b) => a.hcpTrend - b.hcpTrend);
  if (cuts.length && (cuts.length === 1 || cuts[0].hcpTrend < cuts[1].hcpTrend)) cuts[0].bandit = true;
  const out = people.map(({ pid: p, ...rest }) => Object.assign(rest, { creator: p === league.owner })); // never send other players' ids
  let society = null, requests = [], requested = false;
  try {
    const reqs = (await env.DEMAND.prepare('SELECT pid, nick FROM soc_league_req WHERE league = ? ORDER BY at').bind(id).all()).results || [];
    requests = reqs.map((r) => r.nick); requested = !!pid && reqs.some((r) => r.pid === pid);
    const sid = await env.DEMAND.prepare('SELECT soc FROM soc_league WHERE league = ?').bind(id).first('soc');
    const s = sid ? await env.DEMAND.prepare('SELECT id, name FROM soc_socs WHERE id = ?').bind(sid).first() : null;
    if (s) society = { id: s.id, name: s.name, member: !!(pid && await env.DEMAND.prepare('SELECT 1 AS x FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, pid).first('x')) };
  } catch (e) { /* society tables not created yet */ }
  return json({ ok: true, id: league.id, name: league.name, n: today, monday, missed: MISSED, members: out, owner: !!pid && league.owner === pid, society, requests, requested,
    pin: { today: pinOf(today), yesterday: pinOf(today - 1) } }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}

/* ---- The Clubhouse Report: each league's Monday paper, written from the week
   that just finished (Monday to Sunday): Par Price rounds, Bag Draft weekly
   gains (from the Monday price snapshots), head-to-head results and next
   week's fixtures, and the monthly table. Nicknames only, like everything else. */
const CR_SPOON = ['The committee is concerned.', 'Lessons are available.', 'Thoughts and prayers.', 'First round’s on them, we assume.', 'Character-building stuff.'];
const CR_SHANK = ['Rolled the wrong way, like their putts.', 'Went up faster than their handicap.', 'A shank, in price form.', 'Should have laid up.'];
const CR_PICK = ['Bought low, looking smug.', 'Straight down the middle.', 'A genuine tap-in.', 'Flushed it.'];
function crPick(list, seed) { return list[bdHash(seed) % list.length]; }
async function ppReport(env, id, pid, wParam) {
  if (!LEAGUE_RX.test(id)) return { ok: false, error: 'Bad request.' };
  const league = await env.DEMAND.prepare('SELECT id, name FROM pp_leagues WHERE id = ?').bind(id).first();
  if (!league) return { ok: false, error: 'That league has packed up its clubs.' };
  const now = new Date(), dow = (now.getUTCDay() + 6) % 7;
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow)).toISOString().slice(0, 10);
  let from = /^\d{4}-\d{2}-\d{2}$/.test(wParam) && wParam < thisMonday ? wParam : null;
  if (!from) { const d = new Date(Date.parse(thisMonday + 'T00:00:00Z') - 7 * 864e5); from = d.toISOString().slice(0, 10); }
  if (new Date(from + 'T00:00:00Z').getUTCDay() !== 1) return { ok: false, error: 'Bad request.' };
  const add = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
  const to = add(from, 7), last = add(from, 6);
  const members = (await env.DEMAND.prepare('SELECT pid, nick FROM pp_members WHERE league = ?').bind(id).all()).results || [];
  const nickOf = {}; members.forEach((m) => { nickOf[m.pid] = m.nick; });
  const out = { ok: true, name: league.name, from, last, edition: Math.floor((Date.parse(from) - Date.parse('2026-10-19')) / (7 * 864e5)) + 1,
    prev: add(from, -7) >= '2026-10-19' ? add(from, -7) : null, next: to < thisMonday ? to : null };
  // Par Price: the week's rounds
  const nA = Math.round((Date.parse(from + 'T00:00:00Z') - PP_LAUNCH) / 864e5) + 1, nB = nA + 6;
  let pp = null;
  if (nB >= 1 && members.length) {
    const rows = (await env.DEMAND.prepare('SELECT s.n, s.pid, s.total FROM pp_scores s JOIN pp_members m ON m.pid = s.pid AND m.league = ? WHERE s.n BETWEEN ? AND ?').bind(id, Math.max(1, nA), nB).all()).results || [];
    if (rows.length) {
      const per = {};
      members.forEach((m) => { per[m.pid] = { nick: m.nick, played: 0, week: 0 }; });
      rows.forEach((r) => { if (per[r.pid]) { per[r.pid].played++; per[r.pid].week += r.total; } });
      const days = nB - Math.max(1, nA) + 1;
      const active = Object.values(per).filter((p) => p.played > 0).map((p) => Object.assign(p, { week: p.week + (days - p.played) * MISSED }));
      active.sort((a, b) => a.week - b.week);
      const best = rows.slice().sort((a, b) => a.total - b.total || a.n - b.n)[0];
      pp = { rounds: rows.length, winner: { nick: active[0].nick, week: active[0].week },
        round: { nick: nickOf[best.pid], total: best.total, day: ppDay(best.n) },
        ever: active.filter((p) => p.played === days).map((p) => p.nick),
        spoon: active.length > 1 ? { nick: active[active.length - 1].nick, week: active[active.length - 1].week, quip: crPick(CR_SPOON, id + from + 'pp') } : null };
    }
  }
  // The Bag Draft: weekly gains and the picks that moved most
  const season = from.slice(0, 7);
  let bag = null;
  const site = env.SITE || 'https://golfpriceai.com';
  let snaps = {};
  try { const r = await fetch(`${site}/data/draft/weeks/${season}.json`, { cf: { cacheTtl: 900, cacheEverything: true } }); if (r.ok) snaps = (await r.json()).weeks || {}; } catch (e) { /* none */ }
  const liveBy = (await bdCatalogue(env)).by;
  const drafts = (await env.DEMAND.prepare('SELECT m.pid, m.nick AS mnick, d.picks, d.banked FROM pp_members m JOIN bd_drafts d ON d.pid = m.pid AND d.season = ? WHERE m.league = ?').bind(season, id).all()).results || [];
  if (drafts.length && snaps[from]) {
    const latest = {}; for (const [k, v] of Object.entries(liveBy)) latest[k] = v.price;
    const end = snaps[to] || latest, start = snaps[from];
    const bf = bdBlackFridayWeek(season), dbl = !!(bf && bf.from === from);
    const w = { from, to };
    const gains = drafts.map((r) => ({ nick: r.mnick, score: bdWeekScore(r, w, start, end, dbl) })).sort((a, b) => b.score - a.score);
    const moves = [];
    drafts.forEach((r) => JSON.parse(r.picks || '[]').forEach((p) => {
      if ((p.lock !== undefined && p.lock !== null) || String(p.at || '') >= to) return;
      const ref = String(p.at || '') > from ? p.price : (start[p.slug] ?? p.price);
      const d = Math.round(ref - (end[p.slug] ?? ref));
      moves.push({ nick: r.mnick, name: (liveBy[p.slug] || p).name || p.name, d });
    }));
    moves.sort((a, b) => b.d - a.d);
    const pick = moves[0] && moves[0].d > 0 ? Object.assign({}, moves[0], { quip: crPick(CR_PICK, id + from + 'pick') }) : null;
    const shank = moves.length && moves[moves.length - 1].d < 0 ? Object.assign({}, moves[moves.length - 1], { quip: crPick(CR_SHANK, id + from + 'shank') }) : null;
    bag = { double: dbl, gains, pick, shank };
  }
  // Head-to-heads, and the monthly table
  let results = null, fixtures = null, table = null;
  if (drafts.length) {
    const h = await bdH2H(env, liveBy, season, id, pid);
    const done = (h.weeks || []).find((x) => x.from === from && x.scored);
    if (done) results = done.fixtures;
    const nxt = (h.weeks || []).find((x) => x.from === to);
    if (nxt) fixtures = nxt.fixtures.map((f) => ({ a: f.a.nick, b: f.b.nick }));
    const by = bdPhase(season).over ? await bdFinal(env, season, liveBy) : liveBy;
    const bfx = await bdDouble(env, season);
    table = drafts.map((r) => ({ nick: r.mnick, pts: bdScore(r, by, bfx).total })).sort((a, b) => b.pts - a.pts);
  }
  // Higher or Lower: the best daily-run streak in the league that week.
  let hl = null;
  if (nB >= 1 && members.length) {
    const best = await env.DEMAND.prepare('SELECT h.pid, h.streak FROM hl_scores h JOIN pp_members m ON m.pid = h.pid AND m.league = ? WHERE h.n BETWEEN ? AND ? ORDER BY h.streak DESC, h.n ASC LIMIT 1').bind(id, Math.max(1, nA), nB).first();
    if (best && best.streak > 0) hl = { nick: nickOf[best.pid], streak: best.streak };
  }
  out.hl = hl;
  if (!pp && !bag) return Object.assign(out, { empty: true });
  // The front page
  let golfer;
  if (bag && bag.gains.length && bag.gains[0].score > 0) {
    const g = bag.gains[0];
    golfer = { nick: g.nick, headline: crPick([`${g.nick} has the week of their life`, `${g.nick} storms clear with +${g.score}`, `Nobody can stop ${g.nick}`, `${g.nick}’s bag is on fire`], id + from + 'h'),
      line: `+${g.score} points from the bag this week` + (pp && pp.winner.nick === g.nick ? ', and the Par Price week too. Insufferable, frankly.' : '.') };
  } else if (pp) {
    golfer = { nick: pp.winner.nick, headline: crPick([`${pp.winner.nick} wins the week`, `${pp.winner.nick} rules the clubhouse`, `All hail ${pp.winner.nick}`], id + from + 'h'),
      line: `Best Par Price week in the league at ${pp.winner.week > 0 ? '+' + pp.winner.week : pp.winner.week === 0 ? 'level' : '−' + Math.abs(pp.winner.week)}.` };
  }
  return Object.assign(out, { golfer, pp, bag, results, fixtures, table });
}

/* ------------------------------------------------------------------ Society HQ: Awards Night Kit + Prize Picker
   An organiser types their society's awards (title, winner, an optional line,
   an optional prize budget). Anyone with the kit's link can see the cards and
   the slideshow; only the organiser's browser (its player id) can edit it or
   see the prize links. Each award with a budget gets a private Prize Picker
   link: the winner picks something within budget from our real prices, and the
   organiser gets one shopping list. No money is ever taken or held here.
     soc_kits    id, pid (organiser), name, season, awards (JSON), created, updated
     soc_prizes  token, kit, idx (award number), budget, choice (JSON), chosen
   Kits nobody has touched for 400 days are tidied away. */
const KIT_RX = /^[a-hj-km-np-z2-9]{8}$/;
const PRIZE_RX = /^[a-hj-km-np-z2-9]{12}$/;
const MAX_AWARDS = 12;
let socReady = false;
async function socSetup(env) {
  if (socReady) return;
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_kits (id TEXT PRIMARY KEY, pid TEXT, name TEXT, season TEXT, awards TEXT, created TEXT, updated TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS soc_kits_pid ON soc_kits (pid)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_prizes (token TEXT PRIMARY KEY, kit TEXT, idx INTEGER, budget REAL, choice TEXT, chosen TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS soc_prizes_kit ON soc_prizes (kit)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_socs (id TEXT PRIMARY KEY, pid TEXT, name TEXT, area TEXT, about TEXT, pay TEXT, open INTEGER, created TEXT, updated TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_members (soc TEXT, pid TEXT, mkey TEXT, nick TEXT, joined TEXT, PRIMARY KEY (soc, pid)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS soc_members_pid ON soc_members (pid)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_events (id TEXT PRIMARY KEY, soc TEXT, title TEXT, venue TEXT, day TEXT, tee TEXT, entry REAL, cap INTEGER, deadline TEXT, notes TEXT, created TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS soc_events_soc ON soc_events (soc)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_entries (event TEXT, mkey TEXT, status TEXT, paid INTEGER, at TEXT, PRIMARY KEY (event, mkey)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_founding (soc TEXT PRIMARY KEY, n INTEGER, at TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_league (league TEXT PRIMARY KEY, soc TEXT, at TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_league_req (league TEXT, pid TEXT, nick TEXT, at TEXT, PRIMARY KEY (league, pid)) WITHOUT ROWID'),
  ]);
  // County for Find a Society (added Oct 2026): add the column once; it already exists after that.
  try { await env.DEMAND.prepare('ALTER TABLE soc_socs ADD COLUMN county TEXT').run(); } catch (e) { /* already there */ }
  socReady = true;
}
function socCode(n) {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => a[x % a.length]).join('');
}
function socText(s, max) {
  const t = String(s || '').replace(/[^\p{L}\p{N} '’.,&!?()£%:+/-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const flat = t.toLowerCase().replace(/[^a-z]/g, '');
  return RUDE.some((w) => flat.includes(w)) ? null : t;
}
async function society(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'Society HQ is taking a short break. Please try again later.' }, 503, cors);
  await socSetup(env);
  const path = url.pathname;
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, 8000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (await tooMany('soc-' + ip, 60, 600)) return json({ ok: false, error: 'Easy, tiger. Please try again in a few minutes.' }, 429, cors);
  }
  const pidIn = String(body.pid || url.searchParams.get('pid') || '');
  const pid = PID_RX.test(pidIn) ? pidIn : '';
  if (path === '/soc/kit' && request.method === 'POST') return await socSave(env, body, pid, cors);
  if (path === '/soc/kit') return await socKit(env, String(url.searchParams.get('k') || ''), pid, cors);
  if (path === '/soc/prize' && request.method === 'POST') return await socPick(env, body, cors);
  if (path === '/soc/prize') return await socPrize(env, String(url.searchParams.get('t') || ''), cors);
  if (path === '/soc/find') return await hqFind(env, cors);
  if (request.method === 'POST' && path === '/soc/fromleague') return await hqFromLeague(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/leaguereq') return await hqLeagueReq(env, body, pid, cors);
  if (path === '/soc/s') return await hqGet(env, String(url.searchParams.get('s') || ''), pid, cors);
  if (request.method === 'POST' && path === '/soc/new') return await hqNew(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/edit') return await hqEdit(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/join') return await hqJoin(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/leave') return await hqLeave(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/event') return await hqEvent(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/rsvp') return await hqRsvp(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/paid') return await hqPaid(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/remove') return await hqRemove(env, body, pid, cors);
  return json({ ok: false, error: 'Not found.' }, 404, cors);
}
async function socSave(env, body, pid, cors) {
  if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const name = socText(body.name, 40), season = socText(body.season, 20);
  if (name === null || season === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Try another name.' }, 400, cors);
  if (!name || name.length < 3) return json({ ok: false, error: 'Give your society a name (at least 3 letters).' }, 400, cors);
  const list = Array.isArray(body.awards) ? body.awards.slice(0, MAX_AWARDS) : [];
  const awards = [];
  for (const a of list) {
    const t = socText(a && a.t, 40), w = socText(a && a.w, 30), d = socText(a && a.d, 80);
    if (t === null || w === null || d === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Please check the awards.' }, 400, cors);
    if (!t || !w) continue;
    const b = Math.round(Math.min(250, Math.max(0, Number(a.b) || 0)));
    awards.push({ t, w, d, b });
  }
  if (!awards.length) return json({ ok: false, error: 'Add at least one award with a winner.' }, 400, cors);
  const now = new Date().toISOString().slice(0, 10);
  let id = String(body.id || '');
  let old = null;
  if (id) {
    if (!KIT_RX.test(id)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    old = await env.DEMAND.prepare('SELECT pid, awards FROM soc_kits WHERE id = ?').bind(id).first();
    if (!old || old.pid !== pid) return json({ ok: false, error: 'Only the organiser who made these awards can change them.' }, 403, cors);
    await env.DEMAND.prepare('UPDATE soc_kits SET name = ?, season = ?, awards = ?, updated = ? WHERE id = ?').bind(name, season || '', JSON.stringify(awards), now, id).run();
  } else {
    const mine = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM soc_kits WHERE pid = ?').bind(pid).first('c');
    if (mine >= 20) return json({ ok: false, error: 'Twenty award nights is plenty, even for a busy organiser.' }, 429, cors);
    const stale = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    await env.DEMAND.batch([
      env.DEMAND.prepare('DELETE FROM soc_prizes WHERE kit IN (SELECT id FROM soc_kits WHERE updated < ?)').bind(stale),
      env.DEMAND.prepare('DELETE FROM soc_kits WHERE updated < ?').bind(stale),
    ]);
    for (let i = 0; i < 5 && !id; i++) {
      const c = socCode(8);
      const r = await env.DEMAND.prepare('INSERT OR IGNORE INTO soc_kits (id, pid, name, season, awards, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(c, pid, name, season || '', JSON.stringify(awards), now, now).run();
      if (r.meta && r.meta.changes) id = c;
    }
    if (!id) return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500, cors);
  }
  // Prize links: one per award with a budget. A changed winner starts their pick afresh.
  const before = old ? JSON.parse(old.awards || '[]') : [];
  const rows = (await env.DEMAND.prepare('SELECT token, idx FROM soc_prizes WHERE kit = ?').bind(id).all()).results || [];
  const byIdx = {}; rows.forEach((r) => { byIdx[r.idx] = r.token; });
  const ops = [];
  awards.forEach((a, i) => {
    const tok = byIdx[i];
    if (a.b > 0 && !tok) ops.push(env.DEMAND.prepare('INSERT INTO soc_prizes (token, kit, idx, budget, choice, chosen) VALUES (?, ?, ?, ?, NULL, NULL)').bind(socCode(12), id, i, a.b));
    else if (a.b > 0 && tok) {
      const was = before[i] || {};
      if (was.w !== a.w) ops.push(env.DEMAND.prepare('UPDATE soc_prizes SET budget = ?, choice = NULL, chosen = NULL WHERE token = ?').bind(a.b, tok));
      else ops.push(env.DEMAND.prepare('UPDATE soc_prizes SET budget = ? WHERE token = ?').bind(a.b, tok));
    } else if (!(a.b > 0) && tok) ops.push(env.DEMAND.prepare('DELETE FROM soc_prizes WHERE token = ?').bind(tok));
  });
  Object.keys(byIdx).forEach((k) => { if (Number(k) >= awards.length) ops.push(env.DEMAND.prepare('DELETE FROM soc_prizes WHERE token = ?').bind(byIdx[k])); });
  if (ops.length) await env.DEMAND.batch(ops);
  return json({ ok: true, id }, 200, cors);
}
async function socKit(env, id, pid, cors) {
  if (!KIT_RX.test(id)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const k = await env.DEMAND.prepare('SELECT * FROM soc_kits WHERE id = ?').bind(id).first();
  if (!k) return json({ ok: false, error: 'We couldn’t find those awards. They may have been tidied away.' }, 404, cors);
  const owner = !!pid && pid === k.pid;
  const prizes = (await env.DEMAND.prepare('SELECT token, idx, budget, choice, chosen FROM soc_prizes WHERE kit = ?').bind(id).all()).results || [];
  const byIdx = {}; prizes.forEach((p) => { byIdx[p.idx] = p; });
  const awards = JSON.parse(k.awards || '[]').map((a, i) => {
    const out = { t: a.t, w: a.w, d: a.d };
    const p = byIdx[i];
    if (owner) {
      out.b = a.b;
      if (p) out.prize = { token: p.token, choice: p.choice ? JSON.parse(p.choice) : null, chosen: p.chosen };
    }
    return out;
  });
  return json({ ok: true, id, name: k.name, season: k.season, owner, awards }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}
async function socPrize(env, token, cors) {
  if (!PRIZE_RX.test(token)) return json({ ok: false, error: 'That prize link doesn’t look right.' }, 400, cors);
  const p = await env.DEMAND.prepare('SELECT * FROM soc_prizes WHERE token = ?').bind(token).first();
  if (!p) return json({ ok: false, error: 'We couldn’t find that prize. The organiser may have changed the awards.' }, 404, cors);
  const k = await env.DEMAND.prepare('SELECT name, season, awards FROM soc_kits WHERE id = ?').bind(p.kit).first();
  const a = k ? JSON.parse(k.awards || '[]')[p.idx] : null;
  if (!a) return json({ ok: false, error: 'We couldn’t find that prize. The organiser may have changed the awards.' }, 404, cors);
  return json({ ok: true, society: k.name, season: k.season, title: a.t, winner: a.w, budget: p.budget, choice: p.choice ? JSON.parse(p.choice) : null }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}
async function socPick(env, body, cors) {
  const token = String(body.t || '');
  if (!PRIZE_RX.test(token)) return json({ ok: false, error: 'That prize link doesn’t look right.' }, 400, cors);
  const p = await env.DEMAND.prepare('SELECT token, budget FROM soc_prizes WHERE token = ?').bind(token).first();
  if (!p) return json({ ok: false, error: 'We couldn’t find that prize. The organiser may have changed the awards.' }, 404, cors);
  let choice;
  if (body.surprise) choice = { surprise: true };
  else {
    // A product row from the site's own search data: its id and category let the
    // organiser's list find today's price and link again later.
    const c = body.choice || {};
    const id = /^[a-z0-9-]{3,200}$/.test(String(c.id || '')) ? String(c.id) : '';
    const cat = ['ball', 'accessories', 'apparel'].includes(String(c.cat)) ? String(c.cat) : '';
    const name = socText(c.name, 140);
    const price = Math.round(Number(c.price) * 100) / 100;
    if (!id || !cat || !name || !(price > 0 && price <= 2000)) return json({ ok: false, error: 'Please pick a prize from the list.' }, 400, cors);
    choice = { id, cat, name, price };
  }
  const now = new Date().toISOString().slice(0, 10);
  await env.DEMAND.prepare('UPDATE soc_prizes SET choice = ?, chosen = ? WHERE token = ?').bind(JSON.stringify(choice), now, token).run();
  return json({ ok: true, choice }, 200, cors);
}

/* ---- Society HQ: the society itself (phase 1a: plan the season).
     soc_socs     id, pid (organiser), name, area, about, pay (organiser's own
                  PayPal/Monzo/Revolut link), open (listed in Find a Society)
     soc_members  soc, pid, mkey (a random key the organiser uses for ticks;
                  player ids are never sent to other people), nick, joined
     soc_events   id, soc, title, venue, day, tee, entry (society fee £), cap,
                  deadline (final numbers date), notes
     soc_entries  event, mkey, status (in / maybe / out / wait), paid, at
   No money is taken or held: "paid" is the organiser's own tick. Societies
   nobody has touched for 400 days are tidied away. */
const SOC_RX = /^[a-hj-km-np-z2-9]{8}$/;
const PAY_RX = /^https:\/\/(www\.)?(paypal\.me|monzo\.me|revolut\.me|paypal\.com\/paypalme)\/[A-Za-z0-9_.\-\/]{1,60}$/;
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
function hqDay() { return new Date().toISOString().slice(0, 10); }
async function hqSoc(env, id) { return SOC_RX.test(id) ? await env.DEMAND.prepare('SELECT * FROM soc_socs WHERE id = ?').bind(id).first() : null; }
async function hqTouch(env, id) { await env.DEMAND.prepare('UPDATE soc_socs SET updated = ? WHERE id = ?').bind(hqDay(), id).run(); }
function hqFields(body) {
  const name = socText(body.name, 40), area = socText(body.area, 40), about = socText(body.about, 240);
  if (name === null || area === null || about === null) return { error: 'Let’s keep it clean for the clubhouse. Please check the wording.' };
  if (!name || name.length < 3) return { error: 'Give your society a name (at least 3 letters).' };
  const pay = String(body.pay || '').trim();
  if (pay && !PAY_RX.test(pay)) return { error: 'The payment link must be your own PayPal.me, Monzo.me or Revolut.me link.' };
  const county = socText(body.county, 40);
  return { name, area: area || '', about: about || '', pay, open: body.open ? 1 : 0, county: county || '' };
}
async function hqNew(env, body, pid, cors) {
  if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const f = hqFields(body);
  if (f.error) return json({ ok: false, error: f.error }, 400, cors);
  const nick = cleanName(body.nick, 2, 20);
  if (nick === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Try another nickname.' }, 400, cors);
  if (!nick) return json({ ok: false, error: 'Pick a nickname for yourself (at least 2 letters).' }, 400, cors);
  const mine = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM soc_socs WHERE pid = ?').bind(pid).first('c');
  if (mine >= 10) return json({ ok: false, error: 'Ten societies is plenty, even for you.' }, 429, cors);
  const stale = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  await env.DEMAND.batch([
    env.DEMAND.prepare('DELETE FROM soc_entries WHERE event IN (SELECT e.id FROM soc_events e JOIN soc_socs s ON s.id = e.soc WHERE s.updated < ?)').bind(stale),
    env.DEMAND.prepare('DELETE FROM soc_events WHERE soc IN (SELECT id FROM soc_socs WHERE updated < ?)').bind(stale),
    env.DEMAND.prepare('DELETE FROM soc_members WHERE soc IN (SELECT id FROM soc_socs WHERE updated < ?)').bind(stale),
    env.DEMAND.prepare('DELETE FROM soc_socs WHERE updated < ?').bind(stale),
  ]);
  const day = hqDay();
  for (let i = 0; i < 5; i++) {
    const id = socCode(8);
    const r = await env.DEMAND.prepare('INSERT OR IGNORE INTO soc_socs (id, pid, name, area, about, pay, open, created, updated, county) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, pid, f.name, f.area, f.about, f.pay, f.open, day, day, f.county).run();
    if (r.meta && r.meta.changes) {
      await env.DEMAND.prepare('INSERT INTO soc_members (soc, pid, mkey, nick, joined) VALUES (?, ?, ?, ?, ?)').bind(id, pid, socCode(8), nick, day).run();
      return json({ ok: true, id }, 200, cors);
    }
  }
  return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500, cors);
}
/* Turn a Par Price league into a golf society. Only the league's owner can;
   the society takes the league's name and the owner's league nickname, and
   nobody else is added: members see a one-tap "Join" on the league page. */
async function hqFromLeague(env, body, pid, cors) {
  const lid = String(body.l || '');
  if (!pid || !LEAGUE_RX.test(lid)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const league = await env.DEMAND.prepare('SELECT id, name, owner FROM pp_leagues WHERE id = ?').bind(lid).first();
  if (!league) return json({ ok: false, error: 'We couldn’t find that league.' }, 404, cors);
  if (league.owner !== pid) return json({ ok: false, error: 'Only the person who started the league can turn it into a society.' }, 403, cors);
  const linked = await env.DEMAND.prepare('SELECT soc FROM soc_league WHERE league = ?').bind(lid).first('soc');
  if (linked && await hqSoc(env, linked)) return json({ ok: true, id: linked, existing: true }, 200, cors);
  const nick = await env.DEMAND.prepare('SELECT nick FROM pp_members WHERE league = ? AND pid = ?').bind(lid, pid).first('nick');
  const res = await hqNew(env, { name: league.name, area: body.area, county: body.county, about: '', pay: '', open: false, nick: nick || 'Organiser' }, pid, cors);
  const out = await res.clone().json();
  if (out.ok) await env.DEMAND.batch([
    env.DEMAND.prepare('INSERT OR REPLACE INTO soc_league (league, soc, at) VALUES (?, ?, ?)').bind(lid, out.id, hqDay()),
    env.DEMAND.prepare('DELETE FROM soc_league_req WHERE league = ?').bind(lid),
  ]);
  return res;
}
/* A league member suggests turning the league into a golf society; the
   league's creator sees who asked and approves with one tap (hqFromLeague) or
   says "Not now" (clears the suggestions). */
async function hqLeagueReq(env, body, pid, cors) {
  const lid = String(body.l || '');
  if (!pid || !LEAGUE_RX.test(lid)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const league = await env.DEMAND.prepare('SELECT id, owner FROM pp_leagues WHERE id = ?').bind(lid).first();
  if (!league) return json({ ok: false, error: 'We couldn’t find that league.' }, 404, cors);
  if (body.dismiss) {
    if (league.owner !== pid) return json({ ok: false, error: 'Only the league’s creator can do that.' }, 403, cors);
    await env.DEMAND.prepare('DELETE FROM soc_league_req WHERE league = ?').bind(lid).run();
    return json({ ok: true }, 200, cors);
  }
  const nick = await env.DEMAND.prepare('SELECT nick FROM pp_members WHERE league = ? AND pid = ?').bind(lid, pid).first('nick');
  if (!nick) return json({ ok: false, error: 'Join the league first.' }, 403, cors);
  if (await env.DEMAND.prepare('SELECT soc FROM soc_league WHERE league = ?').bind(lid).first('soc')) return json({ ok: false, error: 'This league already has a golf society.' }, 400, cors);
  await env.DEMAND.prepare('INSERT OR REPLACE INTO soc_league_req (league, pid, nick, at) VALUES (?, ?, ?, ?)').bind(lid, pid, nick, hqDay()).run();
  return json({ ok: true }, 200, cors);
}
async function hqEdit(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !pid || s.pid !== pid) return json({ ok: false, error: 'Only the organiser can change the society.' }, 403, cors);
  const f = hqFields(body);
  if (f.error) return json({ ok: false, error: f.error }, 400, cors);
  await env.DEMAND.prepare('UPDATE soc_socs SET name = ?, area = ?, about = ?, pay = ?, open = ?, county = ?, updated = ? WHERE id = ?').bind(f.name, f.area, f.about, f.pay, f.open, f.county, hqDay(), s.id).run();
  return json({ ok: true }, 200, cors);
}
async function hqGet(env, id, pid, cors) {
  const s = await hqSoc(env, id);
  if (!s) return json({ ok: false, error: 'We couldn’t find that society. Ask the organiser for a fresh link.' }, 404, cors);
  const members = (await env.DEMAND.prepare('SELECT pid, mkey, nick, joined FROM soc_members WHERE soc = ? ORDER BY joined, nick').bind(s.id).all()).results || [];
  const me = members.find((m) => pid && m.pid === pid);
  const organiser = !!pid && pid === s.pid;
  const founding = (await env.DEMAND.prepare('SELECT n FROM soc_founding WHERE soc = ?').bind(s.id).first('n')) || 0;
  const base = { ok: true, id: s.id, name: s.name, area: s.area, county: s.county || '', about: s.about, open: !!s.open, count: members.length, founding, organiser, member: !!me };
  if (!me) return json(base, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const events = (await env.DEMAND.prepare('SELECT * FROM soc_events WHERE soc = ? AND day >= ? ORDER BY day').bind(s.id, since).all()).results || [];
  const ids = events.map((e) => e.id);
  let entries = [];
  if (ids.length) entries = (await env.DEMAND.prepare(`SELECT * FROM soc_entries WHERE event IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results || [];
  const nickOf = {}; members.forEach((m) => { nickOf[m.mkey] = m.nick; });
  const out = Object.assign(base, {
    you: me.mkey, pay: s.pay,
    members: members.map((m) => ({ m: m.mkey, nick: m.nick, organiser: m.pid === s.pid })),
    events: events.map((e) => ({ id: e.id, title: e.title, venue: e.venue, day: e.day, tee: e.tee, entry: e.entry, cap: e.cap, deadline: e.deadline, notes: e.notes,
      entries: entries.filter((x) => x.event === e.id && nickOf[x.mkey]).map((x) => ({ m: x.mkey, nick: nickOf[x.mkey], status: x.status, paid: !!x.paid, at: x.at })) })),
  });
  return json(out, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}
/* Founding Societies: the first 50 golf societies to reach four members get a
   permanent, numbered Founding Society badge (four members, so test societies
   and one-person sign-ups don't use up the places). Numbers never change. */
const FOUND_MIN = 4, FOUND_MAX = 50;
async function hqFounding(env, socId) {
  if (await env.DEMAND.prepare('SELECT n FROM soc_founding WHERE soc = ?').bind(socId).first('n')) return;
  const members = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM soc_members WHERE soc = ?').bind(socId).first('c');
  if (members < FOUND_MIN) return;
  const taken = await env.DEMAND.prepare('SELECT COUNT(*) AS c, MAX(n) AS m FROM soc_founding').first();
  if ((taken.c || 0) >= FOUND_MAX) return;
  await env.DEMAND.prepare('INSERT OR IGNORE INTO soc_founding (soc, n, at) VALUES (?, ?, ?)').bind(socId, (taken.m || 0) + 1, hqDay()).run();
}
async function hqJoin(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !pid) return json({ ok: false, error: 'We couldn’t find that society.' }, 404, cors);
  const nick = cleanName(body.nick, 2, 20);
  if (nick === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Try another nickname.' }, 400, cors);
  if (!nick) return json({ ok: false, error: 'Pick a nickname (at least 2 letters).' }, 400, cors);
  const n = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM soc_members WHERE soc = ?').bind(s.id).first('c');
  if (n >= 200) return json({ ok: false, error: 'This society is full (200 members).' }, 400, cors);
  const taken = await env.DEMAND.prepare('SELECT pid FROM soc_members WHERE soc = ? AND lower(nick) = lower(?)').bind(s.id, nick).first('pid');
  if (taken && taken !== pid) return json({ ok: false, error: 'Someone in this society already uses that nickname. Try another.' }, 400, cors);
  const had = await env.DEMAND.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, pid).first('mkey');
  if (had) await env.DEMAND.prepare('UPDATE soc_members SET nick = ? WHERE soc = ? AND pid = ?').bind(nick, s.id, pid).run();
  else await env.DEMAND.prepare('INSERT INTO soc_members (soc, pid, mkey, nick, joined) VALUES (?, ?, ?, ?, ?)').bind(s.id, pid, socCode(8), nick, hqDay()).run();
  await hqTouch(env, s.id);
  if (!had) await hqFounding(env, s.id);
  return json({ ok: true }, 200, cors);
}
async function hqLeave(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  if (s.pid === pid) return json({ ok: false, error: 'The organiser can’t leave their own society.' }, 400, cors);
  const mk = await env.DEMAND.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, pid).first('mkey');
  if (mk) await env.DEMAND.batch([
    env.DEMAND.prepare('DELETE FROM soc_entries WHERE mkey = ?').bind(mk),
    env.DEMAND.prepare('DELETE FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, pid),
  ]);
  return json({ ok: true }, 200, cors);
}
async function hqRemove(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !pid || s.pid !== pid) return json({ ok: false, error: 'Only the organiser can remove members.' }, 403, cors);
  const mk = String(body.m || '');
  const m = await env.DEMAND.prepare('SELECT pid FROM soc_members WHERE soc = ? AND mkey = ?').bind(s.id, mk).first('pid');
  if (!m || m === s.pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  await env.DEMAND.batch([
    env.DEMAND.prepare('DELETE FROM soc_entries WHERE mkey = ?').bind(mk),
    env.DEMAND.prepare('DELETE FROM soc_members WHERE soc = ? AND mkey = ?').bind(s.id, mk),
  ]);
  return json({ ok: true }, 200, cors);
}
async function hqEvent(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !pid || s.pid !== pid) return json({ ok: false, error: 'Only the organiser can change the fixtures.' }, 403, cors);
  const eid = String(body.e || '');
  if (body.del) {
    if (!SOC_RX.test(eid)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await env.DEMAND.batch([
      env.DEMAND.prepare('DELETE FROM soc_entries WHERE event = ?').bind(eid),
      env.DEMAND.prepare('DELETE FROM soc_events WHERE id = ? AND soc = ?').bind(eid, s.id),
    ]);
    return json({ ok: true }, 200, cors);
  }
  const title = socText(body.title, 50), venue = socText(body.venue, 60), notes = socText(body.notes, 300), tee = String(body.tee || '').slice(0, 5);
  if (title === null || venue === null || notes === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Please check the wording.' }, 400, cors);
  if (!title) return json({ ok: false, error: 'Give the day a name, e.g. Spring Stableford.' }, 400, cors);
  const day = String(body.day || ''), deadline = String(body.deadline || '');
  if (!DAY_RX.test(day)) return json({ ok: false, error: 'Pick a date for the day.' }, 400, cors);
  if (deadline && !DAY_RX.test(deadline)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  if (tee && !/^\d{2}:\d{2}$/.test(tee)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const entry = Math.round(Math.min(500, Math.max(0, Number(body.entry) || 0)) * 100) / 100;
  const cap = Math.round(Math.min(200, Math.max(0, Number(body.cap) || 0)));
  if (eid) {
    if (!SOC_RX.test(eid)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await env.DEMAND.prepare('UPDATE soc_events SET title = ?, venue = ?, day = ?, tee = ?, entry = ?, cap = ?, deadline = ?, notes = ? WHERE id = ? AND soc = ?').bind(title, venue || '', day, tee, entry, cap, deadline, notes || '', eid, s.id).run();
    await hqTouch(env, s.id);
    return json({ ok: true, id: eid }, 200, cors);
  }
  const n = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM soc_events WHERE soc = ? AND day >= ?').bind(s.id, hqDay()).first('c');
  if (n >= 30) return json({ ok: false, error: 'Thirty fixtures ahead is plenty.' }, 400, cors);
  const id = socCode(8);
  await env.DEMAND.prepare('INSERT INTO soc_events (id, soc, title, venue, day, tee, entry, cap, deadline, notes, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, s.id, title, venue || '', day, tee, entry, cap, deadline, notes || '', hqDay()).run();
  await hqTouch(env, s.id);
  return json({ ok: true, id }, 200, cors);
}
async function hqEventFor(env, eid, pid) {
  if (!SOC_RX.test(eid) || !pid) return null;
  const e = await env.DEMAND.prepare('SELECT e.*, s.pid AS org FROM soc_events e JOIN soc_socs s ON s.id = e.soc WHERE e.id = ?').bind(eid).first();
  if (!e) return null;
  const me = await env.DEMAND.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND pid = ?').bind(e.soc, pid).first('mkey');
  return me ? Object.assign(e, { me }) : null;
}
async function hqRsvp(env, body, pid, cors) {
  const e = await hqEventFor(env, String(body.e || ''), pid);
  if (!e) return json({ ok: false, error: 'Join the society first.' }, 403, cors);
  const status = ['in', 'maybe', 'out'].includes(body.status) ? body.status : '';
  if (!status) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  // The organiser can put someone down (e.g. after a phone call); everyone else only themselves.
  let who = e.me;
  if (body.m && body.m !== e.me) {
    if (e.org !== pid) return json({ ok: false, error: 'Only the organiser can change someone else.' }, 403, cors);
    const ok = await env.DEMAND.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND mkey = ?').bind(e.soc, String(body.m)).first('mkey');
    if (!ok) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    who = ok;
  }
  let final = status;
  if (status === 'in' && e.cap > 0) {
    const ins = await env.DEMAND.prepare("SELECT COUNT(*) AS c FROM soc_entries WHERE event = ? AND status = 'in' AND mkey != ?").bind(e.id, who).first('c');
    if (ins >= e.cap) final = 'wait';
  }
  const now = new Date().toISOString();
  await env.DEMAND.prepare('INSERT INTO soc_entries (event, mkey, status, paid, at) VALUES (?, ?, ?, 0, ?) ON CONFLICT (event, mkey) DO UPDATE SET status = excluded.status, at = excluded.at').bind(e.id, who, final, now).run();
  // Someone dropped out: the first on the waiting list moves up.
  if (status !== 'in' && e.cap > 0) {
    const ins = await env.DEMAND.prepare("SELECT COUNT(*) AS c FROM soc_entries WHERE event = ? AND status = 'in'").bind(e.id).first('c');
    if (ins < e.cap) {
      const next = await env.DEMAND.prepare("SELECT mkey FROM soc_entries WHERE event = ? AND status = 'wait' ORDER BY at LIMIT 1").bind(e.id).first('mkey');
      if (next) await env.DEMAND.prepare("UPDATE soc_entries SET status = 'in' WHERE event = ? AND mkey = ?").bind(e.id, next).run();
    }
  }
  await hqTouch(env, e.soc);
  return json({ ok: true, status: final }, 200, cors);
}
async function hqPaid(env, body, pid, cors) {
  const e = await hqEventFor(env, String(body.e || ''), pid);
  if (!e || e.org !== pid) return json({ ok: false, error: 'Only the organiser can tick who’s paid.' }, 403, cors);
  const mk = String(body.m || '');
  const r = await env.DEMAND.prepare('UPDATE soc_entries SET paid = ? WHERE event = ? AND mkey = ?').bind(body.paid ? 1 : 0, e.id, mk).run();
  if (!(r.meta && r.meta.changes)) {
    const ok = await env.DEMAND.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND mkey = ?').bind(e.soc, mk).first('mkey');
    if (!ok) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await env.DEMAND.prepare("INSERT INTO soc_entries (event, mkey, status, paid, at) VALUES (?, ?, 'in', ?, ?)").bind(e.id, mk, body.paid ? 1 : 0, new Date().toISOString()).run();
  }
  return json({ ok: true }, 200, cors);
}
async function hqFind(env, cors) {
  const rows = (await env.DEMAND.prepare('SELECT s.id, s.name, s.area, s.county, s.about, s.updated, (SELECT COUNT(*) FROM soc_members m WHERE m.soc = s.id) AS members, (SELECT n FROM soc_founding f WHERE f.soc = s.id) AS founding FROM soc_socs s WHERE s.open = 1 ORDER BY s.updated DESC LIMIT 300').all()).results || [];
  return json({ ok: true, societies: rows.map((r) => ({ id: r.id, name: r.name, area: r.area, county: r.county || '', about: r.about, members: r.members, founding: r.founding || 0 })) }, 200, Object.assign({ 'cache-control': 'public, max-age=300' }, cors));
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
// Double points in Black Friday week (Monday to Sunday around the last Friday
// of November): every £1 a pick drops during that week scores twice. Rises
// still cost the usual 1. Needs the Monday prices the site records each week
// (data/draft/weeks/<season>.json); without them there's simply no bonus.
function bdBlackFridayWeek(season) {
  if (!/^\d{4}-11$/.test(season)) return null;
  const d = new Date(Date.UTC(+season.slice(0, 4), 10, 30));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  const from = new Date(d); from.setUTCDate(d.getUTCDate() - 4);
  const to = new Date(from); to.setUTCDate(from.getUTCDate() + 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
async function bdDouble(env, season) {
  const w = bdBlackFridayWeek(season);
  if (!w) return null;
  const today = new Date().toISOString().slice(0, 10);
  const out = Object.assign({}, w, { live: today >= w.from && today < w.to, started: today >= w.from, start: null, end: null });
  if (!out.started) return out;
  const site = env.SITE || 'https://golfpriceai.com';
  try {
    const r = await fetch(`${site}/data/draft/weeks/${season}.json`, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (r.ok) { const f = await r.json(); out.start = (f.weeks || {})[w.from] || null; out.end = today >= w.to ? (f.weeks || {})[w.to] || null : null; }
  } catch (e) { /* no snapshot, no bonus */ }
  return out;
}
function bdBonus(p, now, bf) {
  if (!bf || !bf.start) return 0;
  const at = String(p.at || '');
  if (at >= bf.to) return 0;                                   // signed after the week
  const ref = at > bf.from ? p.price : (bf.start[p.slug] ?? p.price);
  const end = bf.end ? (bf.end[p.slug] ?? now) : now;
  return Math.max(0, Math.round(ref - end));
}
function bdScore(row, by, bf) {
  const picks = JSON.parse(row.picks || '[]').map((p) => {
    const cur = by[p.slug];
    const now = cur ? cur.price : p.price;
    const locked = p.lock !== undefined && p.lock !== null;
    const bonus = locked ? 0 : bdBonus(p, now, bf);
    const pts = locked ? p.lock
      : Math.round(p.price - now) + (cur && cur.low && now < p.price ? 10 : 0) + bonus;
    return Object.assign({}, p, { now, pts, bonus, name: cur ? cur.name : p.name, image: cur ? cur.image : p.image, low: cur ? cur.low : 0, note: cur ? cur.note : '' });
  });
  return { picks, total: (row.banked || 0) + picks.reduce((t, p) => t + p.pts, 0), dbl: picks.reduce((t, p) => t + (p.bonus || 0), 0) };
}

/* ---- Head-to-heads: a weekly fixture inside each league.
   Fixture weeks are the full Monday-to-Sunday weeks after bags are revealed on
   the 8th. Your weekly score is how much your current bag moved that week, from
   the Monday prices the site records (data/draft/weeks/<season>.json): drops
   score, rises cost, and drops count double in Black Friday week. Odd numbers?
   Someone plays the Ghost, who always scores the league's average. 3 points for
   a win, 1 for a draw. A side table for fun: the monthly table decides the Major. */
function bdIsoDay(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10); }
function bdFixtureWeeks(season) {
  if (!/^\d{4}-\d{2}$/.test(season)) return [];
  const [y, m] = season.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
  for (let d = 8; d + 6 <= last; d++) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1) out.push({ from: bdIsoDay(y, m, d), to: bdIsoDay(y, m, d + 7) });
  }
  return out;
}
function bdHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function bdPairs(ids, r) {
  const a = ids.slice();
  if (a.length % 2) a.push(null);                       // null = the Ghost
  const n = a.length;
  if (n < 2) return [];
  const rest = a.slice(1), k = r % (n - 1), arr = [a[0]].concat(rest.slice(k), rest.slice(0, k)), out = [];
  for (let i = 0; i < n / 2; i++) out.push([arr[i], arr[n - 1 - i]]);
  return out;
}
function bdWeekScore(row, w, start, end, dbl) {
  let tot = 0;
  for (const p of JSON.parse(row.picks || '[]')) {
    if (p.lock !== undefined && p.lock !== null) continue;  // banked: it doesn't move any more
    const at = String(p.at || '');
    if (at >= w.to) continue;
    const ref = at > w.from ? p.price : (start[p.slug] ?? p.price);
    const fin = end[p.slug] ?? ref;
    let d = Math.round(ref - fin);
    if (dbl && d > 0) d *= 2;
    tot += d;
  }
  return tot;
}
async function bdH2H(env, liveBy, season, leagueId, pid) {
  const league = await env.DEMAND.prepare('SELECT name FROM pp_leagues WHERE id = ?').bind(leagueId).first();
  if (!league) return { ok: false, error: 'That league has packed up its clubs.' };
  const weeks = bdFixtureWeeks(season);
  if (!weeks.length) return { ok: true, weeks: [], table: [] };
  const site = env.SITE || 'https://golfpriceai.com';
  let snaps = {};
  try { const r = await fetch(`${site}/data/draft/weeks/${season}.json`, { cf: { cacheTtl: 900, cacheEverything: true } }); if (r.ok) snaps = (await r.json()).weeks || {}; } catch (e) { /* none yet */ }
  const phase = bdPhase(season);
  const latest = {};
  for (const [k, v] of Object.entries(phase.over ? await bdFinal(env, season, liveBy) : liveBy)) latest[k] = v.price;
  const bf = bdBlackFridayWeek(season);
  const rows = (await env.DEMAND.prepare('SELECT m.pid, m.nick AS mnick, d.picks FROM pp_members m JOIN bd_drafts d ON d.pid = m.pid AND d.season = ? WHERE m.league = ?').bind(season, leagueId).all()).results || [];
  const byPid = {};
  rows.forEach((r) => { byPid[r.pid] = r; });
  const firstAt = (r) => JSON.parse(r.picks || '[]').reduce((t, p) => (String(p.at || '9') < t ? String(p.at) : t), '9');
  const today = new Date().toISOString().slice(0, 10);
  const table = {};
  const row = (id) => (table[id] = table[id] || { nick: byPid[id].mnick, you: id === pid, p: 0, w: 0, d: 0, l: 0, pts: 0 });
  const out = [];
  let shownNext = false;
  weeks.forEach((w, k) => {
    const state = today >= w.to ? 'done' : today >= w.from ? 'live' : 'next';
    if (state === 'next' && shownNext) return;
    const ids = rows.filter((r) => firstAt(r) <= (state === 'next' ? today : w.from)).map((r) => r.pid)
      .sort((a, b) => bdHash(leagueId + a) - bdHash(leagueId + b));
    const pairs = bdPairs(ids, k);
    if (!pairs.length) return;
    const start = snaps[w.from];
    const scored = state !== 'next' && start;
    const end = snaps[w.to] || latest;
    const dbl = !!(bf && bf.from === w.from);
    const sc = {};
    if (scored) ids.forEach((id) => { sc[id] = bdWeekScore(byPid[id], w, start, end, dbl); });
    const ghost = scored && ids.length ? Math.round(ids.reduce((t, id) => t + sc[id], 0) / ids.length) : null;
    const side = (id) => id === null ? { nick: 'The Ghost', ghost: true, score: ghost } : { nick: byPid[id].mnick, you: id === pid, score: scored ? sc[id] : null };
    const fixtures = pairs.map(([a, b]) => ({ a: side(a), b: side(b) }));
    if (state === 'done' && scored) {
      pairs.forEach(([a, b]) => {
        const sa = a === null ? ghost : sc[a], sb = b === null ? ghost : sc[b];
        [[a, sa, sb], [b, sb, sa]].forEach(([id, mine, theirs]) => {
          if (id === null) return;
          const t = row(id); t.p += 1;
          if (mine > theirs) { t.w += 1; t.pts += 3; } else if (mine === theirs) { t.d += 1; t.pts += 1; } else t.l += 1;
        });
      });
    }
    if (state === 'next') shownNext = true;
    out.push({ from: w.from, to: w.to, state, double: dbl, scored: !!scored, fixtures });
  });
  const tbl = Object.values(table).sort((a, b) => b.pts - a.pts || b.w - a.w || a.nick.localeCompare(b.nick));
  return { ok: true, name: league.name, weeks: out, table: tbl };
}

/* ---- Hall of Fame and Locker Room: built from each finished Major's frozen scores */
function bdSeasonsTo(last) {
  const out = [];
  let [y, m] = BD_FIRST.split('-').map(Number);
  for (let k = 0; k < 120; k++) {
    const s = y + '-' + String(m).padStart(2, '0');
    if (s > last) break;
    out.push(s);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
function bdLastMonth() { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); }
async function bdScores(env, season, liveBy) {
  const by = bdPhase(season).over ? await bdFinal(env, season, liveBy) : liveBy;
  const bf = await bdDouble(env, season);
  const rows = (await env.DEMAND.prepare('SELECT pid, nick, picks, banked FROM bd_drafts WHERE season = ?').bind(season).all()).results || [];
  return rows.map((r) => ({ pid: r.pid, nick: r.nick, pts: bdScore(r, by, bf).total })).sort((a, b) => b.pts - a.pts);
}
// Places with ties: everyone on the same points shares the place.
function bdPlaces(list, n) {
  const out = [];
  for (const r of list) {
    if (out.length && out[out.length - 1].pts === r.pts) out[out.length - 1].nicks.push(r.nick);
    else { if (out.length === n) break; out.push({ pts: r.pts, nicks: [r.nick] }); }
  }
  return out;
}
function bdRank(list, pts) { return 1 + list.filter((x) => x.pts > pts).length; }
async function bdFame(env, liveBy, hidden, pid) {
  const majors = [];
  const seasons = bdSeasonsTo(bdLastMonth()).reverse().slice(0, 12);
  for (const s of seasons) {
    const all = await bdScores(env, s, liveBy);
    const places = bdPlaces(all.filter((r) => !hidden.has(r.pid)), 3);
    if (!places.length) continue;
    const crowned = ((await env.DEMAND.prepare('SELECT m.league, COUNT(*) AS c FROM pp_members m JOIN bd_drafts d ON d.pid = m.pid AND d.season = ? GROUP BY m.league HAVING c >= 2').bind(s).all()).results || []).length;
    majors.push({ season: s, count: all.length, crowned, places });
  }
  const leagues = [];
  if (pid && majors.length) {
    const mine = (await env.DEMAND.prepare('SELECT l.id, l.name FROM pp_members m JOIN pp_leagues l ON l.id = m.league WHERE m.pid = ?').bind(pid).all()).results || [];
    for (const s of seasons.slice(0, 3)) {
      for (const l of mine) {
        const rows = (await env.DEMAND.prepare('SELECT m.pid FROM pp_members m JOIN bd_drafts d ON d.pid = m.pid AND d.season = ? WHERE m.league = ?').bind(s, l.id).all()).results || [];
        if (rows.length < 2) continue;
        const ids = new Set(rows.map((r) => r.pid));
        const all = await bdScores(env, s, liveBy);
        const top = bdPlaces(all.filter((r) => ids.has(r.pid)), 1)[0];
        if (top) leagues.push({ season: s, league: l.name, id: l.id, champs: top.nicks, pts: top.pts });
      }
    }
  }
  return { ok: true, majors, leagues };
}
async function bdLocker(env, liveBy, hidden, pid) {
  const cur = new Date().toISOString().slice(0, 7);
  const mine = (await env.DEMAND.prepare('SELECT l.id, l.name FROM pp_members m JOIN pp_leagues l ON l.id = m.league WHERE m.pid = ?').bind(pid).all()).results || [];
  const months = [];
  for (const s of bdSeasonsTo(cur)) {
    const me = await env.DEMAND.prepare('SELECT nick FROM bd_drafts WHERE season = ? AND pid = ?').bind(s, pid).first();
    if (!me) continue;
    const phase = bdPhase(s), all = await bdScores(env, s, liveBy);
    const my = all.find((r) => r.pid === pid);
    let best = null;
    for (const l of mine) {
      const rows = (await env.DEMAND.prepare('SELECT m.pid FROM pp_members m JOIN bd_drafts d ON d.pid = m.pid AND d.season = ? WHERE m.league = ?').bind(s, l.id).all()).results || [];
      const ids = new Set(rows.map((r) => r.pid));
      const inL = all.filter((r) => ids.has(r.pid));
      const rank = bdRank(inL, my.pts);
      if (!best || rank < best.rank || (rank === best.rank && inL.length > best.of)) best = { league: l.name, id: l.id, rank, of: inL.length };
    }
    const award = !phase.over ? 'live' : best && best.rank === 1 && best.of >= 2 ? 'champion' : best && best.rank <= 3 && best.of >= 4 ? 'tag' : 'played';
    months.push({ season: s, nick: me.nick, pts: my.pts, award, nat: { rank: bdRank(all, my.pts), of: all.length }, best });
  }
  return { ok: true, hidden: hidden.has(pid), months };
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
  const liveBy = (await bdCatalogue(env)).by;
  let by = liveBy;
  if (phase.over) by = await bdFinal(env, season, by);
  const bf = await bdDouble(env, season);
  if (bf) phase.dbl = { from: bf.from, to: bf.to, live: bf.live };
  const hidden = new Set(((await env.DEMAND.prepare('SELECT pid FROM pp_prefs WHERE hidden = 1').all()).results || []).map((r) => r.pid));
  const mine = pid ? await env.DEMAND.prepare('SELECT * FROM bd_drafts WHERE season = ? AND pid = ?').bind(season, pid).first() : null;

  if (path === '/draft/state') {
    const rows = (await env.DEMAND.prepare('SELECT pid, nick, picks, banked FROM bd_drafts WHERE season = ?').bind(season).all()).results || [];
    const ranked = rows.map((r) => ({ pid: r.pid, nick: r.nick, pts: bdScore(r, by, bf).total })).sort((a, b) => b.pts - a.pts);
    const pos = ranked.findIndex((r) => r.pid === pid);
    const shown = ranked.filter((r) => !hidden.has(r.pid) || r.pid === pid);
    return json({ ok: true, phase, hidden: hidden.has(pid), mine: mine ? Object.assign({ nick: mine.nick, banked: mine.banked || 0, locked: !!mine.locked,
      transferUsed: mine.tweek === bdWeek() }, bdScore(mine, by, bf)) : null,
      national: { count: ranked.length, top: shown.slice(0, 20).map((r) => ({ nick: r.nick, pts: r.pts, you: r.pid === pid })), rank: pos >= 0 ? pos + 1 : null } },
      200, Object.assign({ 'cache-control': 'no-store' }, cors));
  }
  if (path === '/draft/h2h') {
    const lid = q('l');
    if (!LEAGUE_RX.test(lid)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    return json(await bdH2H(env, liveBy, season, lid, pid), 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  }
  if (path === '/draft/fame') return json(await bdFame(env, liveBy, hidden, pid), 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  if (path === '/draft/locker') {
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    return json(await bdLocker(env, liveBy, hidden, pid), 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  }
  if (path === '/draft/league') {
    const id = q('l');
    if (!LEAGUE_RX.test(id)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const league = await env.DEMAND.prepare('SELECT name FROM pp_leagues WHERE id = ?').bind(id).first();
    if (!league) return json({ ok: false, error: 'That league has packed up its clubs.' }, 404, cors);
    const rows = (await env.DEMAND.prepare('SELECT m.pid, m.nick AS mnick, d.picks, d.banked FROM pp_members m LEFT JOIN bd_drafts d ON d.pid = m.pid AND d.season = ? WHERE m.league = ?').bind(season, id).all()).results || [];
    const members = rows.map((r) => {
      const you = r.pid === pid, drafted = !!r.picks;
      const s = drafted ? bdScore(r, by, bf) : null;
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
  const scored = bdScore(mine, by, bf);
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
