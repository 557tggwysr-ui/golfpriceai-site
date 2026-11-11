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
  async fetch(request, env, ctx) {
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
      if (url.pathname.startsWith('/cc/')) return await crowdCaddie(request, url, env, cors);
      if (url.pathname.startsWith('/pb/')) return await peoplesBag(request, url, env, cors);
      if (url.pathname.startsWith('/lg/')) return await nationalLeague(request, url, env, cors);
      if (url.pathname.startsWith('/ck/')) return await clubhouseKey(request, url, env, cors);
      if (url.pathname.startsWith('/lv/')) return await liveScoring(request, url, env, cors, ctx);
      if (url.pathname.startsWith('/pl/')) return await polls(request, url, env, cors);
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
  request.gpFrom = alertFrom(request, body);
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
  if (!model && !stock && body.press) {
    // The UK Golf Price Report: one email a month when a new edition is out
    // (for journalists and anyone who wants the numbers). Sent by scripts/press_email.py.
    return await startSubscription({ email, models: [], stock: '', press: true, name: 'The UK Golf Price Report', request, env, cors });
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
async function startSubscription({ email, models, stock, bought = '', budget = '', remind = '', press = false, name, list = '', fb = '', request, env, cors, quiet }) {
  if (!press && request.gpFrom) await useBump(env, 'al_' + request.gpFrom);

  // Already confirmed? Add the model straight away.
  const existing = await brevo(env, 'GET', `/contacts/${encodeURIComponent(email)}`);
  const listId = Number(env.LIST_ID || 3);
  const attrs = (existing.ok && existing.data.attributes) || {};
  if (existing.ok && (existing.data.listIds || []).includes(listId) && !existing.data.emailBlacklisted) {
    await ensureAttributes(env);
    if (press) {
      await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { PRESS: 'yes' } });
      return json({ ok: true, status: 'added-press' }, 200, cors);
    }
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

  const payload = b64url(JSON.stringify({ e: email, m: models.join(','), k: stock, b: bought, g: budget, r: remind, p: press ? 1 : 0, f: fb, l: list === 'compare' ? 2 : list ? 1 : 0, t: Date.now() }));
  const sig = await sign(env, payload);
  const link = `${new URL(request.url).origin}/confirm?d=${payload}&s=${sig}`;
  const subject = press ? 'Confirm your monthly UK Golf Price Report email'
    : remind ? 'Confirm your Par Price tee-time reminder'
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
    htmlContent: confirmEmail(link, name, { press, remind, stock: !!stock, bought: !!bought, budget: !!budget, count: models.length, list, fb: !!fb }),
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
  if (data.p) attributes.PRESS = 'yes';
  if (!data.m && !data.k && !data.b && !data.g && !data.r && !data.p) attributes.DIGEST = 'yes';
  // A report-only sign-up doesn't opt into the Friday email.
  if (data.p && !existing.ok) attributes.DIGEST = 'no';
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
  if (data.p) return Response.redirect(`${site}/alerts-confirmed.html?status=press`, 302);
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
  await useBump(env, 'unsub');
  const existing = await brevo(env, 'GET', `/contacts/${encodeURIComponent(email)}`);
  if (!existing.ok) return Response.redirect(`${site}/alerts-unsubscribed.html?status=ok`, 302);
  if (model === 'press-report') {
    await brevo(env, 'PUT', `/contacts/${encodeURIComponent(email)}`, { attributes: { PRESS: '' } });
    return Response.redirect(`${site}/alerts-unsubscribed.html?status=press`, 302);
  }
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
  ace_view: 1, ace_share: 1, cc_view: 1, cc_share: 1, oracle_view: 1, ms_called: 1, pb_view: 1, pb_share: 1, fg_view: 1, fg_share: 1, ms_socwin: 1,
  ss_view: 1, ss_round: 1, ss_share: 1, ms_saved: 1, ask_group: 1, pc_link: 1,
  ck_saved: 1, ck_card: 1, co_set: 1, mny_ipaid: 1, mny_confirm: 1, mny_chase: 1, mny_kitty: 1, mny_drop: 1, mny_ref: 1, cs_make: 1, cs_view: 1, cs_click: 1, mb_view: 1, mb_signup: 1, fd_near: 1, soc_ask: 1, lv_view: 1, lv_share: 1, lv_card: 1, lv_claim: 1, mg_view: 1, pl_share: 1, pl_view: 1 };
// Money stats (Nov 2026): shoppers clicking through to a shop, by the kind of
// page they clicked on and by where they first arrived from; arrivals by
// source; alert sign-ups by page. Anonymous daily counts only.
const MONEY_PAGES = ['guide', 'shop', 'home', 'deals', 'tools', 'play', 'societies', 'other'];
const MONEY_FROM = ['email_alert', 'email_friday', 'email_other', 'social', 'whatsapp', 'extension', 'embed', 'search', 'ai', 'site', 'direct'];
MONEY_PAGES.concat(['any']).forEach((k) => { USE_KINDS['out_' + k] = 1; });
MONEY_FROM.forEach((k) => { USE_KINDS['arr_' + k] = 1; USE_KINDS['outf_' + k] = 1; });
const ALERT_FROM = MONEY_PAGES.concat(['fourball', 'extension', 'myball']);
function alertFrom(request, body) {
  const o = request.headers.get('origin') || '';
  if (/^(chrome-extension|extension|moz-extension):\/\//.test(o)) return 'extension';
  const f = String((body && body.from) || '');
  return ALERT_FROM.includes(f) ? f : 'other';
}
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
/* ------------------------------------------------------------------ Clubhouse key
   There are no accounts: each browser has a random player id (gpPid). A
   Clubhouse key is a 12-character code that brings that id back on any phone,
   after cleared cookies or a new phone. Only a peppered SHA-256 of the key is
   stored, so the database alone can't reveal anyone's key. With a key, the
   browser also keeps a small backup here (ck_vault: nickname, saved kit,
   Shot Saver rounds and the like, the same bundle Move my Clubhouse carries).
   No email, no name. Restores are rate-limited per IP.
     ck_keys   h (hash of the key), pid, created
     ck_vault  pid, data (JSON, up to 8,000 characters), at */
const CK_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 letters: no O/0 or I/1 mix-ups
let ckReady = false;
async function ckSetup(env) {
  if (ckReady) return;
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS ck_keys (h TEXT PRIMARY KEY, pid TEXT, created TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS ck_keys_pid ON ck_keys (pid)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS ck_vault (pid TEXT PRIMARY KEY, data TEXT, at TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pk_creds (id TEXT PRIMARY KEY, pid TEXT, pk TEXT, alg INTEGER, created TEXT, used TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS pk_creds_pid ON pk_creds (pid)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pk_chal (c TEXT PRIMARY KEY, pid TEXT, exp INTEGER) WITHOUT ROWID'),
  ]);
  ckReady = true;
}
function ckClean(k) { return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
async function ckHash(env, k) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ck|' + k + '|' + (env.ALERTS_SECRET || '')));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function clubhouseKey(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'Please try again in a minute.' }, 503, cors);
  if (request.method !== 'POST') return json({ ok: false, error: 'Bad request.' }, 400, cors);
  await ckSetup(env);
  let body = {};
  try { body = JSON.parse((await request.text()).slice(0, 9000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
  const ip = request.headers.get('cf-connecting-ip') || '', path = url.pathname, db = env.DEMAND;
  const pid = PID_RX.test(String(body.pid || '')) ? String(body.pid) : '';
  if (path === '/ck/make') {
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    if (await tooMany('ckmake-' + ip, 12, 3600)) return json({ ok: false, error: 'Easy, tiger. Please try again in an hour.' }, 429, cors);
    const raw = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => CK_ABC[x % 32]).join('');
    await db.batch([
      db.prepare('DELETE FROM ck_keys WHERE pid = ?').bind(pid),   // a new key replaces the old one
      db.prepare('INSERT INTO ck_keys (h, pid, created) VALUES (?, ?, ?)').bind(await ckHash(env, raw), pid, hqDay()),
    ]);
    await useBump(env, 'ck_made');
    return json({ ok: true, key: raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8) }, 200, cors);
  }
  if (path === '/ck/restore') {
    if (await tooMany('ckrestore-' + ip, 10, 600)) return json({ ok: false, error: 'Too many tries. Please wait ten minutes and try again.' }, 429, cors);
    const k = ckClean(body.key);
    if (k.length !== 12) return json({ ok: false, error: 'A Clubhouse key is 12 letters and numbers, like 7KQ2-M9XR-4HTD.' }, 400, cors);
    const who = await db.prepare('SELECT pid FROM ck_keys WHERE h = ?').bind(await ckHash(env, k)).first('pid');
    if (!who) return json({ ok: false, error: 'That key doesn’t match a Clubhouse. Check it and try again.' }, 404, cors);
    await useBump(env, 'ck_restored');
    return json(await ckPayload(env, who), 200, cors);
  }
  if (path.startsWith('/ck/pk/')) return await ckPasskey(env, path, body, pid, ip, cors);
  if (path === '/ck/sync') {
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    if (await tooMany('cksync-' + ip, 30, 3600)) return json({ ok: false }, 429, cors);
    if (!(await db.prepare('SELECT h FROM ck_keys WHERE pid = ? UNION SELECT id FROM pk_creds WHERE pid = ?').bind(pid, pid).first())) return json({ ok: false, error: 'No key yet.' }, 403, cors);
    const data = JSON.stringify(body.data && typeof body.data === 'object' ? body.data : {});
    if (data.length > 8000) return json({ ok: false, error: 'Too big.' }, 400, cors);
    await db.prepare('INSERT INTO ck_vault (pid, data, at) VALUES (?, ?, ?) ON CONFLICT (pid) DO UPDATE SET data = excluded.data, at = excluded.at').bind(pid, data, hqDay()).run();
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: false, error: 'Not found.' }, 404, cors);
}
// Everything a restored Clubhouse needs: the player id, its societies, a nickname and the backup.
async function ckPayload(env, who) {
  const db = env.DEMAND;
  let socs = [], nick = '', data = null;
  {
    try {
      await socSetup(env);
      socs = ((await db.prepare('SELECT id, name FROM soc_socs WHERE pid = ? OR co = ? UNION SELECT s.id, s.name FROM soc_members m JOIN soc_socs s ON s.id = m.soc WHERE m.pid = ?').bind(who, who, who).all()).results || []).slice(0, 10);
      nick = (await db.prepare('SELECT nick FROM soc_members WHERE pid = ? ORDER BY joined DESC LIMIT 1').bind(who).first('nick')) || '';
    } catch (e) { /* no societies yet */ }
    if (!nick) try { nick = (await db.prepare('SELECT nick FROM pp_members WHERE pid = ? ORDER BY joined DESC LIMIT 1').bind(who).first('nick')) || ''; } catch (e) { /* no leagues */ }
    try { const v = await db.prepare('SELECT data FROM ck_vault WHERE pid = ?').bind(who).first('data'); data = v ? JSON.parse(v) : null; } catch (e) { /* none */ }
  }
  return { ok: true, pid: who, socs, nick, data };
}

/* Passkeys: Face ID, fingerprint or the phone's PIN unlock the Clubhouse.
   Standard WebAuthn with discoverable credentials ("passkeys"), synced by
   Apple or Google to the golfer's other devices. We keep the credential id,
   its public key and the player id. Nothing biometric ever leaves the phone.
     pk_creds  id (credential id, base64url), pid, pk (SPKI, base64url), alg, created, used
     pk_chal   c (one-time challenge), pid ('' for sign-in), exp */
const PK_ORIGINS = { 'https://golfpriceai.com': 'golfpriceai.com', 'https://www.golfpriceai.com': 'golfpriceai.com' };
function b64u(buf) { let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(str) { const t = String(str || '').replace(/-/g, '+').replace(/_/g, '/'); const b = atob(t + '==='.slice((t.length + 3) % 4)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
// WebAuthn's ES256 signatures are DER; WebCrypto wants the raw 64-byte r||s.
function derToRaw(der) {
  let i = 2; if (der[1] & 0x80) i += der[1] & 0x7f;
  const part = () => { i++; const len = der[i++]; let v = der.slice(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = part(), s2 = part(), out = new Uint8Array(64); out.set(r, 0); out.set(s2, 32); return out;
}
async function ckPasskey(env, path, body, pid, ip, cors) {
  const db = env.DEMAND;
  const origins = Object.assign({}, PK_ORIGINS, env.PK_DEV_ORIGIN ? { [env.PK_DEV_ORIGIN]: new URL(env.PK_DEV_ORIGIN).hostname } : {});
  const now = Date.now();
  if (await tooMany('pk-' + ip, 30, 600)) return json({ ok: false, error: 'Too many tries. Please wait ten minutes and try again.' }, 429, cors);
  if (path === '/ck/pk/begin') {   // a challenge: for adding a passkey (with pid) or signing in (without)
    const c = b64u(crypto.getRandomValues(new Uint8Array(32)));
    await db.prepare('DELETE FROM pk_chal WHERE exp < ?').bind(now).run();
    await db.prepare('INSERT INTO pk_chal (c, pid, exp) VALUES (?, ?, ?)').bind(c, pid || '', now + 5 * 60000).run();
    const ids = pid ? ((await db.prepare('SELECT id FROM pk_creds WHERE pid = ?').bind(pid).all()).results || []).map((r) => r.id) : [];
    return json({ ok: true, challenge: c, have: ids }, 200, cors);
  }
  // Both finishing steps check the browser's signed-off "client data".
  let cd;
  try { cd = JSON.parse(new TextDecoder().decode(unb64u(body.clientDataJSON))); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
  const rp = origins[cd.origin];
  if (!rp) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const ch = await db.prepare('SELECT pid FROM pk_chal WHERE c = ? AND exp >= ?').bind(String(cd.challenge || ''), now).first();
  if (!ch) return json({ ok: false, error: 'That took a little too long. Please try again.' }, 400, cors);
  await db.prepare('DELETE FROM pk_chal WHERE c = ?').bind(String(cd.challenge)).run();
  if (path === '/ck/pk/add') {
    if (cd.type !== 'webauthn.create' || !pid || ch.pid !== pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const id = String(body.id || ''), pk = String(body.publicKey || ''), alg = Number(body.alg);
    if (!/^[A-Za-z0-9_-]{16,400}$/.test(id) || !/^[A-Za-z0-9_-]{40,1200}$/.test(pk) || (alg !== -7 && alg !== -257)) return json({ ok: false, error: 'This phone’s passkey isn’t one we can use. Your Clubhouse key still works.' }, 400, cors);
    const n = await db.prepare('SELECT COUNT(*) AS c FROM pk_creds WHERE pid = ?').bind(pid).first('c');
    if (n >= 10) return json({ ok: false, error: 'Ten passkeys is plenty. Remove one first.' }, 400, cors);
    await db.prepare('INSERT OR REPLACE INTO pk_creds (id, pid, pk, alg, created, used) VALUES (?, ?, ?, ?, ?, ?)').bind(id, pid, pk, alg, hqDay(), hqDay()).run();
    await useBump(env, 'pk_added');
    return json({ ok: true }, 200, cors);
  }
  if (path === '/ck/pk/unlock') {
    if (cd.type !== 'webauthn.get') return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const cred = await db.prepare('SELECT * FROM pk_creds WHERE id = ?').bind(String(body.id || '')).first();
    if (!cred) return json({ ok: false, error: 'That passkey isn’t linked to a Clubhouse any more. Use your Clubhouse key instead.' }, 404, cors);
    const auth = unb64u(body.authenticatorData), sig = unb64u(body.signature);
    const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rp)));
    if (auth.length < 37 || rpHash.some((b, i) => auth[i] !== b)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    if (!(auth[32] & 0x01) || !(auth[32] & 0x04)) return json({ ok: false, error: 'Your phone needs to check it’s you (Face ID, fingerprint or PIN).' }, 400, cors);
    const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64u(body.clientDataJSON)));
    const signed = new Uint8Array(auth.length + 32); signed.set(auth, 0); signed.set(cdHash, auth.length);
    let ok = false;
    try {
      if (cred.alg === -7) {
        const key = await crypto.subtle.importKey('spki', unb64u(cred.pk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), signed);
      } else {
        const key = await crypto.subtle.importKey('spki', unb64u(cred.pk), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
      }
    } catch (e) { ok = false; }
    if (!ok) return json({ ok: false, error: 'That didn’t check out. Please try again, or use your Clubhouse key.' }, 403, cors);
    await db.prepare('UPDATE pk_creds SET used = ? WHERE id = ?').bind(hqDay(), cred.id).run();
    await useBump(env, 'pk_unlocked');
    return json(await ckPayload(env, cred.pid), 200, cors);
  }
  return json({ ok: false, error: 'Not found.' }, 404, cors);
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


/* ------------------------------------------------------------------ Live scoring
   A society day scored live: one phone per group enters gross scores hole by
   hole; stableford points come from each golfer's playing handicap and the
   hole's stroke index. Anyone with the leaderboard link follows it live. When
   the organiser publishes, the scores go into the Form Guide (soc_results) and
   from there the Order of Merit and the National Society League.
     sc_courses  course (UK course id), name, pars, si (JSON, 18 each), updated
     sc_rounds   event, soc, code (leaderboard link), course, cname, pars, si, allowance, status, lastpos, created, updated
     sc_players  event, mkey, nick, ch (course handicap), ph (playing handicap), grp
     sc_groups   event, grp, tee, marker (mkey), token (the group's scorecard link)
     sc_scores   event, mkey, hole, strokes (0 = picked up), at
     sc_feed     event, at, txt
     sc_extras   event, kind (ntp | ld), mkey, txt
     sc_hcp      soc, mkey, ch, updated  (last course handicap, to fill in next time)
   Quick rounds (friends, no society): sc_rounds.kind = 'quick', with owner (the
   pid who started it), title, day and fmt (stb | bb better-ball pairs | skins);
   players get keys p1, p2… and a team for better-ball. A golfer can claim their
   own line (sc_players.pid) so the round counts in their My Game stats; society
   golfers are matched through soc_members. sc_scores.fw / pt hold the optional
   fairway (1/0) and putts a golfer adds on their own phone.
   Nicknames and points only; nothing about anyone else is kept. */
const LV_CODE = /^[a-hj-km-np-z2-9]{8}$/, LV_TOKEN = /^[a-hj-km-np-z2-9]{12}$/;
let lvReady = false;
async function lvSetup(env) {
  if (lvReady) return;
  await socSetup(env);
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_courses (course TEXT PRIMARY KEY, name TEXT, pars TEXT, si TEXT, updated TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_rounds (event TEXT PRIMARY KEY, soc TEXT, code TEXT, course TEXT, cname TEXT, pars TEXT, si TEXT, allowance INTEGER, status TEXT, lastpos TEXT, created TEXT, updated TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE UNIQUE INDEX IF NOT EXISTS sc_rounds_code ON sc_rounds (code)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_players (event TEXT, mkey TEXT, nick TEXT, ch INTEGER, ph INTEGER, grp INTEGER, PRIMARY KEY (event, mkey)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_groups (event TEXT, grp INTEGER, tee TEXT, marker TEXT, token TEXT, PRIMARY KEY (event, grp)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE UNIQUE INDEX IF NOT EXISTS sc_groups_token ON sc_groups (token)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_scores (event TEXT, mkey TEXT, hole INTEGER, strokes INTEGER, at TEXT, PRIMARY KEY (event, mkey, hole)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_feed (event TEXT, at TEXT, txt TEXT)'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS sc_feed_event ON sc_feed (event, at)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_extras (event TEXT, kind TEXT, mkey TEXT, txt TEXT, PRIMARY KEY (event, kind)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_hcp (soc TEXT, mkey TEXT, ch INTEGER, updated TEXT, PRIMARY KEY (soc, mkey)) WITHOUT ROWID'),
  ]);
  for (const sql of ['ALTER TABLE sc_rounds ADD COLUMN kind TEXT', 'ALTER TABLE sc_rounds ADD COLUMN fmt TEXT', 'ALTER TABLE sc_rounds ADD COLUMN owner TEXT',
    'ALTER TABLE sc_rounds ADD COLUMN title TEXT', 'ALTER TABLE sc_rounds ADD COLUMN day TEXT', 'ALTER TABLE sc_players ADD COLUMN team INTEGER',
    'ALTER TABLE sc_players ADD COLUMN pid TEXT', 'ALTER TABLE sc_scores ADD COLUMN fw INTEGER', 'ALTER TABLE sc_scores ADD COLUMN pt INTEGER']) {
    try { await env.DEMAND.prepare(sql).run(); } catch (e) { /* already there */ }
  }
  try { await env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS sc_players_pid ON sc_players (pid)').run(); } catch (e) { /* fine */ }
  lvReady = true;
}
const LV_FMT = { stb: 'Stableford', bb: 'Better-ball pairs', skins: 'Skins' };
// The final-result alert: the winner's line, plus who came second.
function lvFinalLine(r, table, line) {
  const two = table[1] && table[1].thru && r.fmt !== 'bb' && r.fmt !== 'skins' ? ` ${table[1].nick} ${table[1].pos === table[0].pos ? 'level' : 'second'} on ${table[1].pts}.` : '';
  return line + two;
}
// The title, course and day of a round: a society day, or a quick round.
async function lvInfo(env, r) {
  if (r.kind === 'quick') return { title: r.title || 'Quick round', venue: r.cname || '', day: r.day || String(r.created || '').slice(0, 10), society: '', tee: '', org: r.owner, co: null };
  const ev = await env.DEMAND.prepare('SELECT e.title, e.venue, e.day, e.tee, s.name, s.pid, s.co FROM soc_events e JOIN soc_socs s ON s.id = e.soc WHERE e.id = ?').bind(r.event).first();
  return ev ? { title: ev.title, venue: r.cname || ev.venue, day: ev.day, society: ev.name, tee: ev.tee, org: ev.pid, co: ev.co } : { title: 'Society day', venue: r.cname || '', day: '', society: '', tee: '', org: null, co: null };
}
// Better-ball pairs (best stableford score on each hole counts) and skins
// (lowest net score on a hole wins it outright; a tie carries the skin on).
function lvGames(r, table) {
  const pars = lvCard(r.pars), si = lvCard(r.si), out = {};
  if (r.fmt === 'bb') {
    const teams = {};
    table.forEach((p) => { if (p.team) (teams[p.team] = teams[p.team] || []).push(p); });
    out.teams = Object.keys(teams).map((t) => {
      const ps = teams[t]; let pts = 0, thru = 0, back = 0;
      for (let h = 1; h <= 18; h++) {
        const got = ps.filter((p) => p.holes[h] !== undefined).map((p) => lvPoints(p.holes[h], pars[h - 1], p.ph, si[h - 1]));
        if (!got.length) continue;
        thru++; pts += Math.max(...got); if (h > 9) back += Math.max(...got);
      }
      return { team: Number(t), names: ps.map((p) => p.nick), pts, back, thru };
    }).sort((a, b) => b.pts - a.pts || b.back - a.back);
  }
  if (r.fmt === 'skins') {
    const won = {}; let carry = 0, played = 0; const holes = [];
    for (let h = 1; h <= 18; h++) {
      if (!table.length || table.some((p) => p.holes[h] === undefined)) continue;
      played++;
      const net = table.map((p) => ({ m: p.m, nick: p.nick, n: p.holes[h] > 0 ? p.holes[h] - lvShots(p.ph, si[h - 1]) : 99 }));
      const low = Math.min(...net.map((x) => x.n)), best = net.filter((x) => x.n === low);
      if (best.length === 1 && low < 99) { won[best[0].m] = (won[best[0].m] || 0) + 1 + carry; holes.push({ h, nick: best[0].nick, n: 1 + carry }); carry = 0; } else carry++;
    }
    out.skins = table.map((p) => ({ nick: p.nick, n: won[p.m] || 0 })).sort((a, b) => b.n - a.n || a.nick.localeCompare(b.nick));
    out.carry = carry; out.skinHoles = holes.slice(-6); out.skinPlayed = played;
  }
  return out;
}
// Shots a golfer gets on a hole: playing handicap spread by stroke index
// (plus handicaps give shots back on the easiest holes).
function lvShots(ph, si) {
  if (ph >= 0) return Math.floor(ph / 18) + ((ph % 18) >= si ? 1 : 0);
  const back = -ph;
  return -(Math.floor(back / 18) + ((back % 18) > (18 - si) ? 1 : 0));
}
function lvPoints(strokes, par, ph, si) { return strokes > 0 ? Math.max(0, par + lvShots(ph, si) - strokes + 2) : 0; }
function lvCard(v) { try { const a = JSON.parse(v); return Array.isArray(a) && a.length === 18 && a.every((n) => Number.isInteger(n)) ? a : null; } catch (e) { return null; } }
function lvValid(pars, si) {
  return Array.isArray(pars) && pars.length === 18 && pars.every((p) => [3, 4, 5, 6].includes(p)) &&
    Array.isArray(si) && si.length === 18 && si.every((n) => Number.isInteger(n) && n >= 1 && n <= 18) && new Set(si).size === 18;
}
// The leaderboard, worked out from every score so far.
async function lvTable(env, r) {
  const db = env.DEMAND, pars = lvCard(r.pars), si = lvCard(r.si);
  const players = (await db.prepare('SELECT mkey, nick, ph, grp, team, pid FROM sc_players WHERE event = ?').bind(r.event).all()).results || [];
  const scores = (await db.prepare('SELECT mkey, hole, strokes FROM sc_scores WHERE event = ?').bind(r.event).all()).results || [];
  const by = {}; scores.forEach((s) => { (by[s.mkey] = by[s.mkey] || {})[s.hole] = s.strokes; });
  const rows = players.map((p) => {
    const mine = by[p.mkey] || {};
    let pts = 0, back = 0, thru = 0, gross = 0, blobs = 0;
    for (let h = 1; h <= 18; h++) {
      if (mine[h] === undefined) continue;
      const pt = lvPoints(mine[h], pars[h - 1], p.ph, si[h - 1]);
      pts += pt; if (h > 9) back += pt; thru++; gross += mine[h] || 0; if (!pt) blobs++;
    }
    return { m: p.mkey, nick: p.nick, ph: p.ph, grp: p.grp, team: p.team || 0, pid: p.pid || '', pts, back, thru, holes: mine };
  }).sort((a, b) => b.pts - a.pts || b.back - a.back || a.nick.localeCompare(b.nick));
  rows.forEach((x, i) => { const prev = rows[i - 1]; x.pos = prev && prev.pts === x.pts ? prev.pos : i + 1; });
  rows.forEach((x) => { x.tie = rows.filter((y) => y.pos === x.pos).length > 1; });
  return rows;
}
async function lvRound(env, by, val) {
  return await env.DEMAND.prepare(`SELECT * FROM sc_rounds WHERE ${by} = ?`).bind(val).first();
}
/* ------------------------------------------------------------------ live alerts (web push)
   "Alert me" on a live leaderboard: a phone's browser hands over a push
   address, and the worker buzzes it for a new leader, birdies (everyone's, or
   just the golfers picked) and the final result. Standard Web Push (VAPID,
   RFC 8291 encryption) with the browser's own push service: no app, no email.
   The worker makes its own VAPID key pair the first time and keeps it in D1,
   so there is no secret to add. Stored per alert: the round, the push address
   and its two keys, the alert kinds and the nicknames picked. All of it is
   deleted when the result is in, or after 3 days. The free plan allows 50
   outside requests per request, hence the cap of PUSH_MAX phones per round. */
const PUSH_MAX = 40;
const PUSH_KINDS = ['lead', 'birdie', 'final'];
const PUSH_HOST = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
let pushReady = false, pushVapid = null;
const pushTe = new TextEncoder();
function pushB64(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pushUnb64(s) {
  try {
    const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '==='.slice((t.length + 3) % 4));
    const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) { return null; }
}
function pushCat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
}
async function pushHmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function pushSetup(env) {
  if (pushReady) return;
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_push (event TEXT, ep TEXT, p256dh TEXT, auth TEXT, kinds TEXT, who TEXT, created TEXT, PRIMARY KEY (event, ep)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_vapid (id INTEGER PRIMARY KEY, pub TEXT, priv TEXT)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_hand (code TEXT PRIMARY KEY, pid TEXT, crews TEXT, created TEXT) WITHOUT ROWID'),
  ]);
  pushReady = true;
}
// The VAPID key pair: made once, then kept.
async function pushKeys(env) {
  if (pushVapid) return pushVapid;
  await pushSetup(env);
  let row = await env.DEMAND.prepare('SELECT pub, priv FROM sc_vapid WHERE id = 1').first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = pushB64(await crypto.subtle.exportKey('raw', kp.publicKey));
    const priv = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
    await env.DEMAND.prepare('INSERT OR IGNORE INTO sc_vapid (id, pub, priv) VALUES (1, ?, ?)').bind(pub, priv).run();
    row = await env.DEMAND.prepare('SELECT pub, priv FROM sc_vapid WHERE id = 1').first();
  }
  const key = await crypto.subtle.importKey('jwk', JSON.parse(row.priv), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  pushVapid = { pub: row.pub, key, jwt: {} };
  return pushVapid;
}
async function pushJwt(v, aud, site) {
  const now = Math.floor(Date.now() / 1000), hit = v.jwt[aud];
  if (hit && hit.exp - now > 3600) return hit.t;
  const exp = now + 12 * 3600;
  const head = pushB64(pushTe.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = pushB64(pushTe.encode(JSON.stringify({ aud, exp, sub: site || 'https://golfpriceai.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, pushTe.encode(head + '.' + body));
  const t = head + '.' + body + '.' + pushB64(sig);
  v.jwt[aud] = { t, exp };
  return t;
}
// RFC 8291 (aes128gcm): the message, readable only by that one browser.
async function pushEncrypt(sub, text) {
  const ua = pushUnb64(sub.p256dh), secret = pushUnb64(sub.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await pushHmac(await pushHmac(secret, shared), pushCat(pushTe.encode('WebPush: info\0'), ua, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await pushHmac(salt, ikm);
  const cek = (await pushHmac(prk, pushCat(pushTe.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await pushHmac(prk, pushCat(pushTe.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const k = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, pushCat(pushTe.encode(text), new Uint8Array([2]))));
  return pushCat(salt, new Uint8Array([0, 0, 16, 0, 65]), asPub, ct);
}
async function pushOne(env, v, sub, msg) {
  const u = new URL(sub.ep);
  const jwt = await pushJwt(v, u.origin, env.SITE);
  const res = await fetch(sub.ep, { method: 'POST', body: await pushEncrypt(sub, JSON.stringify(msg)), headers: {
    authorization: `vapid t=${jwt}, k=${v.pub}`, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '3600', urgency: 'high' } });
  return res.status;
}
// What one phone hears about a batch of news: birdies rolled into one line.
function pushText(sub, alerts) {
  const kinds = String(sub.kinds || '').split(','), who = sub.who ? JSON.parse(sub.who) : [];
  const fin = alerts.find((a) => a.kind === 'final');
  if (fin) return kinds.includes('final') ? { final: true, b: fin.txt } : null;
  const parts = [];
  if (kinds.includes('birdie')) {
    const b = alerts.filter((a) => a.kind === 'birdie' && (!who.length || who.includes(a.nick)));
    if (b.length === 1) parts.push(b[0].txt);
    else if (b.length > 1) parts.push(`${b.length} birdies or better: ${b.map((a) => a.short).join(', ')}.`);
  }
  const lead = alerts.find((a) => a.kind === 'lead');
  if (lead && kinds.includes('lead')) parts.push(lead.txt);
  return parts.length ? { final: false, b: parts.join(' ') } : null;
}
async function pushRound(env, r, alerts) {
  try {
    if (!alerts.length) return;
    await pushSetup(env);
    const subs = (await env.DEMAND.prepare('SELECT * FROM sc_push WHERE event = ? LIMIT ?').bind(r.event, PUSH_MAX).all()).results || [];
    if (!subs.length) return;
    const v = await pushKeys(env), ev = await lvInfo(env, r);
    const site = env.SITE || 'https://golfpriceai.com';
    const url = site + (r.kind === 'quick' ? '/play/scorecard/live/?c=' : '/societies/live/?c=') + r.code;
    const gone = [];
    await Promise.all(subs.map(async (s) => {
      const m = pushText(s, alerts);
      if (!m) return;
      try {
        const st = await pushOne(env, v, s, { t: (ev.title || 'Live leaderboard') + (m.final ? ' · Final' : ''), b: m.b, u: url });
        if (st === 404 || st === 410 || st === 403) gone.push(s.ep);
      } catch (e) { /* the next one */ }
    }));
    const fin = alerts.some((a) => a.kind === 'final');
    if (fin) await env.DEMAND.prepare('DELETE FROM sc_push WHERE event = ?').bind(r.event).run();
    else if (gone.length) await env.DEMAND.batch(gone.map((ep) => env.DEMAND.prepare('DELETE FROM sc_push WHERE event = ? AND ep = ?').bind(r.event, ep)));
    await useBump(env, 'lv_push_sent');
  } catch (e) { console.log('push', e && e.stack); }
}
function later(ctx, p) { if (ctx && ctx.waitUntil) ctx.waitUntil(p); else return p; }
/* ------------------------------------------------------------------ shared course cards
   One card per course (and per tee: "<id>-red" for red tees) in sc_courses,
   with "checks": how many rounds confirmed it ("Looks right"). A round that
   changes the card votes for its version in sc_card_votes; a version that two
   or more rounds agree on, and more than have confirmed the current card,
   becomes the card everyone gets. So one typo can't spoil a card. The round
   itself always uses what its own golfers entered. */
let cardReady = false;
async function cardSetup(env) {
  if (cardReady) return;
  try { await env.DEMAND.prepare('ALTER TABLE sc_courses ADD COLUMN checks INTEGER DEFAULT 0').run(); } catch (e) { /* already there */ }
  await env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS sc_card_votes (course TEXT, sig TEXT, voter TEXT, pars TEXT, si TEXT, last TEXT, PRIMARY KEY (course, sig, voter)) WITHOUT ROWID').run();
  cardReady = true;
}
const CARD_KEY_RX = /^(?:[nwr]\d{1,12}|x\d{1,6})(?:-red)?$/;
async function cardVote(env, key, cname, pars, si, ok, voter) {
  try {
    if (!CARD_KEY_RX.test(key)) return;
    await cardSetup(env);
    const db = env.DEMAND, P = JSON.stringify(pars), S = JSON.stringify(si), sig = P + '|' + S, day = hqDay();
    const cur = await db.prepare('SELECT pars, si, checks FROM sc_courses WHERE course = ?').bind(key).first();
    if (!cur) {
      await db.prepare('INSERT INTO sc_courses (course, name, pars, si, updated, checks) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (course) DO NOTHING')
        .bind(key, cname || '', P, S, day, ok ? 1 : 0).run();
      return;
    }
    if (cur.pars + '|' + cur.si === sig) {
      if (ok) await db.prepare('UPDATE sc_courses SET checks = COALESCE(checks, 0) + 1, updated = ? WHERE course = ?').bind(day, key).run();
      return;
    }
    // One vote per golfer (their device's player id), however often they save.
    await db.prepare('INSERT INTO sc_card_votes (course, sig, voter, pars, si, last) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (course, sig, voter) DO UPDATE SET last = excluded.last')
      .bind(key, sig, String(voter || 'anon').slice(0, 40), P, S, day).run();
    const v = await db.prepare('SELECT COUNT(*) AS n FROM sc_card_votes WHERE course = ? AND sig = ?').bind(key, sig).first('n');
    if (v >= 2 && v > (cur.checks || 0)) {
      await db.batch([
        db.prepare('UPDATE sc_courses SET pars = ?, si = ?, checks = ?, updated = ? WHERE course = ?').bind(P, S, v, day, key),
        db.prepare('DELETE FROM sc_card_votes WHERE course = ?').bind(key),
      ]);
    }
  } catch (e) { console.log('card', e && e.message); }
}

async function liveScoring(request, url, env, cors, ctx) {
  if (!env.DEMAND) return json({ ok: false, error: 'Live scoring is taking a short break. Please try again in a minute.' }, 503, cors);
  await lvSetup(env);
  const db = env.DEMAND, path = url.pathname, ip = request.headers.get('cf-connecting-ip') || '';
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, 12000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    if (await tooMany('lv-' + ip, 240, 600)) return json({ ok: false, error: 'Easy, tiger. Please try again in a few minutes.' }, 429, cors);
  }
  const q = (k) => String(body[k] !== undefined ? body[k] : url.searchParams.get(k) || '');
  const pid = PID_RX.test(q('pid')) ? q('pid') : '';
  const noStore = Object.assign({ 'cache-control': 'no-store' }, cors);

  // A course card someone has already typed in.
  if (path === '/lv/course') {
    const c = q('c'), key = c + (q('t') === 'red' ? '-red' : '');
    if (!ACE_COURSE_RX.test(c)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await cardSetup(env);
    const row = await db.prepare('SELECT name, pars, si, checks FROM sc_courses WHERE course = ?').bind(key).first();
    return json({ ok: true, card: row ? { name: row.name, pars: lvCard(row.pars), si: lvCard(row.si), checks: row.checks || 0 } : null }, 200, noStore);
  }
  // The organiser's set-up: what's there already, and last time's handicaps.
  if (path === '/lv/setup' && request.method === 'GET') {
    const e = await hqEventFor(env, q('e'), pid);
    if (!e || !evOrg(e, pid)) return json({ ok: false, error: 'Only the organiser can set up live scoring.' }, 403, noStore);
    const r = await lvRound(env, 'event', e.id);
    const members = (await db.prepare('SELECT m.mkey, m.nick, h.ch FROM soc_members m LEFT JOIN sc_hcp h ON h.soc = m.soc AND h.mkey = m.mkey WHERE m.soc = ? ORDER BY m.nick').bind(e.soc).all()).results || [];
    const ins = (((await db.prepare("SELECT mkey FROM soc_entries WHERE event = ? AND status = 'in'").bind(e.id).all()).results) || []).map((x) => x.mkey);
    const out = { ok: true, event: { id: e.id, title: e.title, venue: e.venue, day: e.day, tee: e.tee }, members, ins, round: null };
    if (r) {
      out.round = { code: r.code, course: r.course, cname: r.cname, pars: lvCard(r.pars), si: lvCard(r.si), allowance: r.allowance, status: r.status,
        players: (await db.prepare('SELECT mkey, nick, ch, ph, grp FROM sc_players WHERE event = ?').bind(e.id).all()).results || [],
        groups: (await db.prepare('SELECT grp, tee, marker, token FROM sc_groups WHERE event = ? ORDER BY grp').bind(e.id).all()).results || [] };
    }
    return json(out, 200, noStore);
  }
  if (path === '/lv/setup' && request.method === 'POST') {
    const e = await hqEventFor(env, q('e'), pid);
    if (!e || !evOrg(e, pid)) return json({ ok: false, error: 'Only the organiser can set up live scoring.' }, 403, cors);
    const pars = body.pars, si = body.si;
    if (!lvValid(pars, si)) return json({ ok: false, error: 'The course card needs a par (3 to 6) and a different stroke index (1 to 18) for all 18 holes.' }, 400, cors);
    const course = ACE_COURSE_RX.test(String(body.course || '')) ? String(body.course) : '';
    const cname = socText(body.cname, 60) || e.venue || '';
    const allowance = [85, 90, 95, 100].includes(Number(body.allowance)) ? Number(body.allowance) : 95;
    const mem = {}; (((await db.prepare('SELECT mkey, nick FROM soc_members WHERE soc = ?').bind(e.soc).all()).results) || []).forEach((m) => { mem[m.mkey] = m.nick; });
    const players = [];
    for (const p of (Array.isArray(body.players) ? body.players : []).slice(0, 120)) {
      const m = String(p && p.m || ''), ch = Math.round(Number(p.ch)), grp = Math.round(Number(p.grp));
      if (!mem[m] || players.some((x) => x.m === m) || !(ch >= -10 && ch <= 54) || !(grp >= 1 && grp <= 40)) continue;
      players.push({ m, ch, ph: Math.round(ch * allowance / 100), grp });
    }
    if (players.length < 2) return json({ ok: false, error: 'Add at least two golfers, each with a handicap and a group.' }, 400, cors);
    const groups = [...new Set(players.map((p) => p.grp))].sort((a, b) => a - b);
    const old = await lvRound(env, 'event', e.id);
    if (old && old.status === 'final') return json({ ok: false, error: 'This round is finished and published.' }, 400, cors);
    const code = old ? old.code : socCode(8), now = new Date().toISOString();
    const oldTokens = {}; if (old) (((await db.prepare('SELECT grp, token FROM sc_groups WHERE event = ?').bind(e.id).all()).results) || []).forEach((g) => { oldTokens[g.grp] = g.token; });
    const tee = {}, marker = {}; (Array.isArray(body.groups) ? body.groups : []).forEach((g) => { const n = Math.round(Number(g && g.grp)); tee[n] = /^\d{2}:\d{2}$/.test(String(g.tee || '')) ? g.tee : ''; marker[n] = String(g.marker || ''); });
    const steps = [
      db.prepare('INSERT INTO sc_rounds (event, soc, code, course, cname, pars, si, allowance, status, lastpos, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event) DO UPDATE SET course = excluded.course, cname = excluded.cname, pars = excluded.pars, si = excluded.si, allowance = excluded.allowance, updated = excluded.updated')
        .bind(e.id, e.soc, code, course, cname, JSON.stringify(pars), JSON.stringify(si), allowance, 'live', '{}', now, now),
      db.prepare('DELETE FROM sc_players WHERE event = ?').bind(e.id),
      db.prepare('DELETE FROM sc_groups WHERE event = ?').bind(e.id),
    ];
    players.forEach((p) => {
      steps.push(db.prepare('INSERT INTO sc_players (event, mkey, nick, ch, ph, grp) VALUES (?, ?, ?, ?, ?, ?)').bind(e.id, p.m, mem[p.m], p.ch, p.ph, p.grp));
      steps.push(db.prepare('INSERT INTO sc_hcp (soc, mkey, ch, updated) VALUES (?, ?, ?, ?) ON CONFLICT (soc, mkey) DO UPDATE SET ch = excluded.ch, updated = excluded.updated').bind(e.soc, p.m, p.ch, hqDay()));
    });
    groups.forEach((g) => {
      const inG = players.filter((p) => p.grp === g).map((p) => p.m);
      steps.push(db.prepare('INSERT INTO sc_groups (event, grp, tee, marker, token) VALUES (?, ?, ?, ?, ?)').bind(e.id, g, tee[g] || '', inG.includes(marker[g]) ? marker[g] : inG[0], oldTokens[g] || socCode(12)));
    });
    // Scores for anyone taken out of the round go with them.
    steps.push(db.prepare(`DELETE FROM sc_scores WHERE event = ? AND mkey NOT IN (${players.map(() => '?').join(',')})`).bind(e.id, ...players.map((p) => p.m)));
    await db.batch(steps);
    if (course && !body.gross) await cardVote(env, course + (body.tee === 'red' ? '-red' : ''), cname, pars, si, !!body.cardok, pid);
    await useBump(env, 'lv_setup');
    const gl = (await db.prepare('SELECT grp, tee, marker, token FROM sc_groups WHERE event = ? ORDER BY grp').bind(e.id).all()).results || [];
    return json({ ok: true, code, groups: gl }, 200, cors);
  }
  // A group's scorecard (the marker's link).
  if (path === '/lv/card') {
    const t = q('t');
    if (!LV_TOKEN.test(t)) return json({ ok: false, error: 'That scorecard link doesn’t look right. Ask for it again.' }, 400, noStore);
    const g = await db.prepare('SELECT * FROM sc_groups WHERE token = ?').bind(t).first();
    if (!g) return json({ ok: false, error: 'That scorecard has packed up its clubs. Ask for a fresh link.' }, 404, noStore);
    const r = await lvRound(env, 'event', g.event);
    const ev = await lvInfo(env, r);
    const table = await lvTable(env, r);
    const extras = {}; (((await db.prepare('SELECT kind, mkey, txt FROM sc_extras WHERE event = ?').bind(g.event).all()).results) || []).forEach((x) => { extras[x.kind] = x; });
    const mineRow = pid ? await db.prepare('SELECT s.mkey FROM sc_players s LEFT JOIN soc_members m ON m.soc = ? AND m.mkey = s.mkey WHERE s.event = ? AND (s.pid = ? OR m.pid = ?)').bind(r.soc || '', g.event, pid, pid).first('mkey') : null;
    const detail = {};
    if (mineRow) (((await db.prepare('SELECT hole, fw, pt FROM sc_scores WHERE event = ? AND mkey = ?').bind(g.event, mineRow).all()).results) || []).forEach((x) => { detail[x.hole] = { fw: x.fw, pt: x.pt }; });
    return json({ ok: true, code: r.code, status: r.status, kind: r.kind || 'soc', fmt: r.fmt || 'stb', title: ev.title, venue: ev.venue, day: ev.day, society: ev.society, grp: g.grp, tee: g.tee,
      pars: lvCard(r.pars), si: lvCard(r.si), allowance: r.allowance, owner: !!pid && pid === ev.org, me: mineRow || null, detail,
      claim: r.kind === 'quick' ? table.map((p) => ({ m: p.m, nick: p.nick, taken: !!p.pid })) : null,
      players: table.filter((p) => p.grp === g.grp).map((p) => ({ m: p.m, nick: p.nick, ph: p.ph, team: p.team, pts: p.pts, thru: p.thru, pos: p.pos, holes: p.holes })),
      teams: r.fmt === 'bb' ? lvGames(r, table).teams : null,
      extras: { ntp: extras.ntp ? { m: extras.ntp.mkey, txt: extras.ntp.txt } : null, ld: extras.ld ? { m: extras.ld.mkey, txt: extras.ld.txt } : null } }, 200, noStore);
  }
  if (path === '/lv/score' && request.method === 'POST') {
    const t = q('t');
    const g = LV_TOKEN.test(t) ? await db.prepare('SELECT * FROM sc_groups WHERE token = ?').bind(t).first() : null;
    if (!g) return json({ ok: false, error: 'That scorecard link doesn’t work any more. Ask the organiser for it again.' }, 404, cors);
    const r = await lvRound(env, 'event', g.event);
    const quick = r && r.kind === 'quick';
    if (!r || (r.status === 'final' && !(quick && Date.now() - new Date(r.created).getTime() < 2 * 86400000))) return json({ ok: false, error: 'This round is finished: the scores are locked.' }, 400, cors);
    const hole = Math.round(Number(body.hole));
    if (!(hole >= 1 && hole <= 18)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const mine = (((await db.prepare('SELECT mkey FROM sc_players WHERE event = ? AND grp = ?').bind(g.event, g.grp).all()).results) || []).map((p) => p.mkey);
    const before = await lvTable(env, r);
    const now = new Date().toISOString(), steps = [];
    for (const m of mine) {
      if (!body.scores || !(m in body.scores)) continue;
      const v = body.scores[m];
      if (v === null || v === '') { steps.push(db.prepare('DELETE FROM sc_scores WHERE event = ? AND mkey = ? AND hole = ?').bind(g.event, m, hole)); continue; }
      const n = Math.round(Number(v));
      if (!(n >= 0 && n <= 15)) continue;
      const d = body.detail && body.detail[m] ? body.detail[m] : null;
      const fw = d && (d.fw === 0 || d.fw === 1) ? d.fw : null, pt = d && Number.isInteger(d.pt) && d.pt >= 0 && d.pt <= 6 ? d.pt : null;
      steps.push(db.prepare('INSERT INTO sc_scores (event, mkey, hole, strokes, at, fw, pt) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event, mkey, hole) DO UPDATE SET strokes = excluded.strokes, at = excluded.at, fw = COALESCE(excluded.fw, sc_scores.fw), pt = COALESCE(excluded.pt, sc_scores.pt)').bind(g.event, m, hole, n, now, fw, pt));
    }
    if (!steps.length) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await db.batch(steps);
    // The feed: birdies and better, and a new leader.
    const after = await lvTable(env, r), pars = lvCard(r.pars), feed = [], alerts = [];
    for (const m of mine) {
      const s = body.scores && body.scores[m], n = Math.round(Number(s)), p = after.find((x) => x.m === m);
      if (!p || !(n >= 1)) continue;
      const was = before.find((x) => x.m === m), had = was && was.holes[hole] !== undefined;
      if (had && was.holes[hole] === n) continue;
      const diff = n - pars[hole - 1], fl = feed.length;
      if (diff <= -3) feed.push(`${p.nick} makes an albatross on the ${fgOrd(hole)}. Somebody frame that card.`);
      else if (diff === -2) feed.push(n === 1 ? `${p.nick} has a HOLE-IN-ONE on the ${fgOrd(hole)}! Drinks are on them.` : `${p.nick} eagles the ${fgOrd(hole)}. The bar has been warned.`);
      else if (diff === -1) feed.push(`${p.nick} birdies the ${fgOrd(hole)}. ${lvPoints(n, pars[hole - 1], p.ph, lvCard(r.si)[hole - 1])} points and a smug face.`);
      if (feed.length > fl) alerts.push({ kind: 'birdie', nick: p.nick, short: `${p.nick} on the ${fgOrd(hole)}`, txt: feed[feed.length - 1] });
    }
    const lead0 = before.filter((x) => x.thru && x.pos === 1).map((x) => x.m), lead1 = after.filter((x) => x.thru && x.pos === 1);
    if (lead1.length === 1 && !(lead0.length === 1 && lead0[0] === lead1[0].m) && after.filter((x) => x.thru).length > 1) {
      feed.push(`${lead1[0].nick} takes the lead on ${lead1[0].pts} points.`);
      alerts.push({ kind: 'lead', txt: `${lead1[0].nick} takes the lead on ${lead1[0].pts} points, thru ${lead1[0].thru}.` });
    }
    // Movers: positions now against a snapshot taken at most every 10 minutes.
    let snap = {}; try { snap = JSON.parse(r.lastpos || '{}'); } catch (e) { /* none */ }
    if (!snap.at || Date.now() - new Date(snap.at).getTime() > 600000) {
      const pos = {}; before.forEach((x) => { if (x.thru) pos[x.m] = x.pos; });
      snap = { at: now, pos };
    }
    const fsteps = feed.map((txt) => db.prepare('INSERT INTO sc_feed (event, at, txt) VALUES (?, ?, ?)').bind(g.event, now, txt));
    fsteps.push(db.prepare('UPDATE sc_rounds SET lastpos = ?, updated = ? WHERE event = ?').bind(JSON.stringify(snap), now, g.event));
    // A quick round finishes itself when every card has 18 scores.
    if (quick && r.status !== 'final' && after.length && after.every((x) => x.thru >= 18)) {
      const gm = lvGames(r, after);
      let txt = `${after[0].nick} wins on ${after[0].pts} points.`;
      if (r.fmt === 'bb' && gm.teams && gm.teams[0]) txt = `${gm.teams[0].names.join(' and ')} win the better-ball with ${gm.teams[0].pts} points.`;
      if (r.fmt === 'skins' && gm.skins && gm.skins[0]) txt = `${gm.skins[0].nick} takes the most skins: ${gm.skins[0].n}.`;
      fsteps.push(db.prepare("UPDATE sc_rounds SET status = 'final' WHERE event = ?").bind(g.event));
      fsteps.push(db.prepare('INSERT INTO sc_feed (event, at, txt) VALUES (?, ?, ?)').bind(g.event, new Date(Date.now() + 1000).toISOString(), 'Final: ' + txt));
      alerts.length = 0; alerts.push({ kind: 'final', txt: lvFinalLine(r, after, txt) });
    }
    await db.batch(fsteps);
    await later(ctx, pushRound(env, r, alerts));
    return json({ ok: true, players: after.filter((p) => p.grp === g.grp).map((p) => ({ m: p.m, pts: p.pts, thru: p.thru, pos: p.pos })) }, 200, cors);
  }
  if (path === '/lv/extra' && request.method === 'POST') {
    const t = q('t');
    const g = LV_TOKEN.test(t) ? await db.prepare('SELECT * FROM sc_groups WHERE token = ?').bind(t).first() : null;
    if (!g) return json({ ok: false, error: 'Bad request.' }, 404, cors);
    const kind = ['ntp', 'ld'].includes(body.kind) ? body.kind : '', m = String(body.m || ''), txt = socText(body.txt, 40);
    if (!kind || txt === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse.' }, 400, cors);
    const ok = await db.prepare('SELECT nick FROM sc_players WHERE event = ? AND mkey = ?').bind(g.event, m).first('nick');
    if (!ok) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await db.prepare('INSERT INTO sc_extras (event, kind, mkey, txt) VALUES (?, ?, ?, ?) ON CONFLICT (event, kind) DO UPDATE SET mkey = excluded.mkey, txt = excluded.txt').bind(g.event, kind, m, txt || '').run();
    await db.prepare('INSERT INTO sc_feed (event, at, txt) VALUES (?, ?, ?)').bind(g.event, new Date().toISOString(), kind === 'ntp' ? `${ok} is nearest the pin${txt ? ', ' + txt : ''}.` : `${ok} has the longest drive${txt ? ', ' + txt : ''}.`).run();
    return json({ ok: true }, 200, cors);
  }
  // The live leaderboard (anyone with the link).
  if (path === '/lv/board') {
    const c = q('c');
    const r = LV_CODE.test(c) ? await lvRound(env, 'code', c) : null;
    if (!r) return json({ ok: false, error: 'We couldn’t find that leaderboard. Ask for the link again.' }, 404, noStore);
    const ev = await lvInfo(env, r);
    const table = await lvTable(env, r);
    let last = {}; try { last = JSON.parse(r.lastpos || '{}').pos || {}; } catch (e) { /* none */ }
    const feed = (((await db.prepare('SELECT at, txt FROM sc_feed WHERE event = ? ORDER BY at DESC LIMIT 8').bind(r.event).all()).results) || []);
    const nick = {}; table.forEach((p) => { nick[p.m] = p.nick; });
    const extras = {}; (((await db.prepare('SELECT kind, mkey, txt FROM sc_extras WHERE event = ?').bind(r.event).all()).results) || []).forEach((x) => { extras[x.kind] = { nick: nick[x.mkey] || '', txt: x.txt }; });
    const groups = (await db.prepare('SELECT grp, tee FROM sc_groups WHERE event = ? ORDER BY grp').bind(r.event).all()).results || [];
    const quick = r.kind === 'quick', organiser = !!pid && (pid === ev.org || (!!ev.co && pid === ev.co));
    const report = !quick && r.status === 'final' ? '/societies/form-guide/?e=' + r.event : null;
    return json(Object.assign({ ok: true, code: r.code, status: r.status, kind: quick ? 'quick' : 'soc', fmt: r.fmt || 'stb', title: ev.title, venue: ev.venue, day: ev.day, society: ev.society, updated: r.updated,
      organiser, event: quick ? null : r.event, report, groups,
      claim: quick ? table.map((p) => ({ m: p.m, nick: p.nick, taken: !!p.pid, mine: !!pid && p.pid === pid })) : null,
      tokens: quick && organiser ? (await db.prepare('SELECT grp, token FROM sc_groups WHERE event = ? ORDER BY grp').bind(r.event).all()).results : null,
      // Once it's final: everyone's card, hole by hole, for the scorecard and stats.
      pars: r.status === 'final' ? lvCard(r.pars) : null, si: r.status === 'final' ? lvCard(r.si) : null,
      rows: table.map((p) => Object.assign({ nick: p.nick, team: p.team, pts: p.pts, back: p.back, thru: p.thru, pos: p.pos, tie: p.tie, move: last[p.m] && p.thru ? last[p.m] - p.pos : 0 },
        r.status === 'final' ? { ph: p.ph, holes: p.holes } : {})),
      feed: feed.map((f) => ({ at: f.at, txt: f.txt })), extras }, lvGames(r, table)), 200, noStore);
  }
  // Live alerts: the key a browser needs, then "Alert me" and "Turn off".
  if (path === '/lv/pushkey') {
    const v = await pushKeys(env);
    return json({ ok: true, key: v.pub }, 200, Object.assign({ 'cache-control': 'public, max-age=3600' }, cors));
  }
  if ((path === '/lv/push' || path === '/lv/unpush') && request.method === 'POST') {
    const r = LV_CODE.test(q('c')) ? await lvRound(env, 'code', q('c')) : null;
    if (!r) return json({ ok: false, error: 'We couldn’t find that leaderboard.' }, 404, cors);
    await pushSetup(env);
    let ep = String(body.ep || '').slice(0, 1000), host = '';
    try { const u = new URL(ep); host = u.protocol === 'https:' ? u.hostname : ''; } catch (e) { /* bad */ }
    if (!PUSH_HOST.test(host)) return json({ ok: false, error: 'This browser can’t do alerts, sorry. The board still updates itself.' }, 400, cors);
    if (path === '/lv/unpush') {
      await db.prepare('DELETE FROM sc_push WHERE event = ? AND ep = ?').bind(r.event, ep).run();
      return json({ ok: true }, 200, cors);
    }
    if (r.status === 'final') return json({ ok: false, error: 'This round has finished: the result’s on the board.' }, 400, cors);
    const p256 = pushUnb64(body.p256dh), au = pushUnb64(body.auth);
    if (!p256 || p256.length !== 65 || p256[0] !== 4 || !au || au.length !== 16) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const kinds = PUSH_KINDS.filter((k) => Array.isArray(body.kinds) && body.kinds.includes(k));
    if (!kinds.length) return json({ ok: false, error: 'Pick at least one alert.' }, 400, cors);
    const nicks = new Set((((await db.prepare('SELECT nick FROM sc_players WHERE event = ?').bind(r.event).all()).results) || []).map((x) => x.nick));
    const who = (Array.isArray(body.who) ? body.who : []).map(String).filter((n) => nicks.has(n)).slice(0, 40);
    if (Array.isArray(body.who) && body.who.length && !who.length) return json({ ok: false, error: 'Pick at least one golfer.' }, 400, cors);
    await db.prepare('DELETE FROM sc_push WHERE created < ?').bind(new Date(Date.now() - 3 * 86400000).toISOString()).run();
    const have = await db.prepare('SELECT COUNT(*) AS n, SUM(ep = ?) AS me FROM sc_push WHERE event = ?').bind(ep, r.event).first();
    if (!(have && have.me) && have && have.n >= PUSH_MAX) return json({ ok: false, error: 'This round already has as many phones on alerts as we can buzz. The board still updates itself every few seconds.' }, 400, cors);
    await db.prepare('INSERT INTO sc_push (event, ep, p256dh, auth, kinds, who, created) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event, ep) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, kinds = excluded.kinds, who = excluded.who')
      .bind(r.event, ep, pushB64(p256), pushB64(au), kinds.join(','), who.length ? JSON.stringify(who) : '', new Date().toISOString()).run();
    if (!(have && have.me)) await useBump(env, 'lv_push_on');
    return json({ ok: true }, 200, cors);
  }
  // iPhone hand-over: a Home Screen web app starts with empty storage, so the
  // board passes this browser's player id (and saved fours) to it through a
  // one-use code in the saved link, good for 30 minutes.
  if (path === '/lv/hand' && request.method === 'POST') {
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await pushSetup(env);
    const crews = typeof body.crews === 'string' && body.crews.length <= 6000 ? body.crews : '';
    const code = socCode(12), cut = new Date(Date.now() - 1800000).toISOString();
    await db.batch([db.prepare('DELETE FROM sc_hand WHERE created < ? OR pid = ?').bind(cut, pid),
      db.prepare('INSERT INTO sc_hand (code, pid, crews, created) VALUES (?, ?, ?, ?)').bind(code, pid, crews, new Date().toISOString())]);
    return json({ ok: true, code }, 200, cors);
  }
  if (path === '/lv/take' && request.method === 'POST') {
    const h = String(body.h || '');
    if (!/^[a-z0-9]{12}$/.test(h)) return json({ ok: false }, 400, cors);
    await pushSetup(env);
    const row = await db.prepare('SELECT pid, crews, created FROM sc_hand WHERE code = ?').bind(h).first();
    if (row) await db.prepare('DELETE FROM sc_hand WHERE code = ?').bind(h).run();
    if (!row || Date.now() - new Date(row.created).getTime() > 1800000) return json({ ok: false }, 200, cors);
    return json({ ok: true, pid: row.pid, crews: row.crews || '' }, 200, cors);
  }
  // A quick round: friends, no society. Anyone can start one.
  if (path === '/lv/quick' && request.method === 'POST') {
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    if (await tooMany('lvq-' + ip, 20, 3600)) return json({ ok: false, error: 'That’s a lot of rounds for one afternoon. Try again in a bit.' }, 429, cors);
    const pars = body.pars, si = body.si;
    if (!lvValid(pars, si)) return json({ ok: false, error: 'The course card needs a par (3 to 6) and a different stroke index (1 to 18) for all 18 holes.' }, 400, cors);
    const course = ACE_COURSE_RX.test(String(body.course || '')) ? String(body.course) : '';
    const cname = socText(body.cname, 60);
    if (cname === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse.' }, 400, cors);
    const fmt = LV_FMT[body.fmt] ? body.fmt : 'stb';
    const allowance = [85, 90, 95, 100].includes(Number(body.allowance)) ? Number(body.allowance) : 95;
    const players = [];
    for (const p of (Array.isArray(body.players) ? body.players : []).slice(0, 24)) {
      const nick = cleanName(p && p.nick, 1, 20), ch = Math.round(Number(p && p.ch)), grp = Math.round(Number(p && p.grp)) || 1, team = Math.round(Number(p && p.team)) || 0;
      if (!nick || players.some((x) => x.nick.toLowerCase() === nick.toLowerCase()) || !(ch >= -10 && ch <= 54) || !(grp >= 1 && grp <= 6)) continue;
      players.push({ m: 'p' + (players.length + 1), nick, ch, ph: Math.round(ch * allowance / 100), grp, team: fmt === 'bb' ? Math.max(1, Math.min(12, team || 1)) : 0, me: !!p.me });
    }
    if (players.length < 2) return json({ ok: false, error: 'Add at least two golfers, each with a nickname and a handicap.' }, 400, cors);
    if (fmt === 'bb') {
      const sizes = {}; players.forEach((p) => { sizes[p.team] = (sizes[p.team] || 0) + 1; });
      if (Object.keys(sizes).length < 2 || Object.values(sizes).some((n) => n !== 2)) return json({ ok: false, error: 'Better-ball needs pairs: two golfers on each side.' }, 400, cors);
    }
    const id = socCode(8), code = socCode(8), now = new Date().toISOString();
    const title = socText(body.title, 50) || ((cname ? 'Quick round at ' + cname : 'Quick round') + (body.gross ? ' (gross)' : ''));
    const steps = [db.prepare('INSERT INTO sc_rounds (event, soc, code, course, cname, pars, si, allowance, status, lastpos, created, updated, kind, fmt, owner, title, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, '', code, course, cname || '', JSON.stringify(pars), JSON.stringify(si), allowance, 'live', '{}', now, now, 'quick', fmt, pid, title, hqDay())];
    players.forEach((p) => steps.push(db.prepare('INSERT INTO sc_players (event, mkey, nick, ch, ph, grp, team, pid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, p.m, p.nick, p.ch, p.ph, p.grp, p.team, p.me ? pid : null)));
    const grps = [...new Set(players.map((p) => p.grp))].sort((a, b) => a - b), toks = {};
    grps.forEach((gn) => { toks[gn] = socCode(12); steps.push(db.prepare('INSERT INTO sc_groups (event, grp, tee, marker, token) VALUES (?, ?, ?, ?, ?)').bind(id, gn, '', players.find((p) => p.grp === gn).m, toks[gn])); });
    await db.batch(steps);
    if (course && !body.gross) await cardVote(env, course + (body.tee === 'red' ? '-red' : ''), cname || '', pars, si, !!body.cardok, pid);
    await useBump(env, 'lv_quick');
    return json({ ok: true, code, groups: grps.map((gn) => ({ grp: gn, token: toks[gn], names: players.filter((p) => p.grp === gn).map((p) => p.nick) })) }, 200, cors);
  }
  // "Which one are you?": a golfer claims their own line in a quick round, for My Game.
  if (path === '/lv/claim' && request.method === 'POST') {
    const r = LV_CODE.test(q('c')) ? await lvRound(env, 'code', q('c')) : null;
    if (!r || r.kind !== 'quick' || !pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const m = String(body.m || '');
    await db.prepare('UPDATE sc_players SET pid = NULL WHERE event = ? AND pid = ?').bind(r.event, pid).run();
    const res = m ? await db.prepare('UPDATE sc_players SET pid = ? WHERE event = ? AND mkey = ? AND pid IS NULL').bind(pid, r.event, m).run() : null;
    return json({ ok: !m || !!(res && res.meta && res.meta.changes) , error: 'Someone else has already said that’s them.' }, 200, cors);
  }
  // The owner finishes a quick round early (someone went home at the turn).
  if (path === '/lv/end' && request.method === 'POST') {
    const r = LV_CODE.test(q('c')) ? await lvRound(env, 'code', q('c')) : null;
    if (!r || r.kind !== 'quick' || !pid || pid !== r.owner) return json({ ok: false, error: 'Only the golfer who started the round can finish it.' }, 403, cors);
    await db.prepare("UPDATE sc_rounds SET status = 'final', updated = ? WHERE event = ?").bind(new Date().toISOString(), r.event).run();
    const t = await lvTable(env, r);
    if (t[0] && t[0].thru) await later(ctx, pushRound(env, r, [{ kind: 'final', txt: lvFinalLine(r, t, `${t[0].nick} wins on ${t[0].pts} points.`) }]));
    else await later(ctx, pushRound(env, r, [{ kind: 'final', txt: 'The round has finished.' }]));
    return json({ ok: true }, 200, cors);
  }
  // My Game: every round this golfer played, quick rounds and society days.
  if (path === '/lv/mine') {
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, noStore);
    const rows = (await db.prepare(`SELECT r.event, r.kind, r.fmt, r.cname, r.course, r.pars, r.si, r.day, r.created, r.title, r.status, p.mkey, p.ph
      FROM sc_players p JOIN sc_rounds r ON r.event = p.event LEFT JOIN soc_members m ON m.soc = r.soc AND m.mkey = p.mkey
      WHERE p.pid = ? OR m.pid = ? ORDER BY r.created DESC LIMIT 60`).bind(pid, pid).all()).results || [];
    const out = [];
    for (const x of rows) {
      const sc = (await db.prepare('SELECT hole, strokes, fw, pt FROM sc_scores WHERE event = ? AND mkey = ?').bind(x.event, x.mkey).all()).results || [];
      if (!sc.length) continue;
      let day = x.day;
      if (!day && x.kind !== 'quick') day = await db.prepare('SELECT day FROM soc_events WHERE id = ?').bind(x.event).first('day');
      const h = {}; sc.forEach((s) => { h[s.hole] = [s.strokes, s.fw, s.pt]; });
      out.push({ kind: x.kind || 'soc', fmt: x.fmt || 'stb', course: x.course || '', cname: x.cname || '', day: day || String(x.created).slice(0, 10), title: x.title || '', ph: x.ph, pars: lvCard(x.pars), si: lvCard(x.si), h });
    }
    return json({ ok: true, rounds: out }, 200, noStore);
  }
  // Publish: the scores go into the Form Guide report, the Order of Merit and the League.
  if (path === '/lv/final' && request.method === 'POST') {
    const e = await hqEventFor(env, q('e'), pid);
    if (!e || !evOrg(e, pid)) return json({ ok: false, error: 'Only the organiser can publish the results.' }, 403, cors);
    const r = await lvRound(env, 'event', e.id);
    if (!r) return json({ ok: false, error: 'There’s no live round for this day.' }, 404, cors);
    const table = await lvTable(env, r);
    const extras = {}; (((await db.prepare('SELECT kind, mkey, txt FROM sc_extras WHERE event = ?').bind(e.id).all()).results) || []).forEach((x) => { extras[x.kind] = { m: x.mkey, txt: x.txt }; });
    const rows = table.map((p) => ({ m: p.m, pts: p.thru >= 18 ? p.pts : 'NR', back: p.thru >= 18 ? p.back : '' }));
    const res = await fgSave(env, { e: e.id, rows, ntp: extras.ntp || null, ld: extras.ld || null, line: String(body.line || ''), spoon: !!body.spoon, prize: body.prize || 0 }, pid, cors);
    const out = await res.clone().json();
    if (out.ok) {
      await db.prepare("UPDATE sc_rounds SET status = 'final', updated = ? WHERE event = ?").bind(new Date().toISOString(), e.id).run();
      await db.prepare('INSERT INTO sc_feed (event, at, txt) VALUES (?, ?, ?)').bind(e.id, new Date().toISOString(), table[0] ? `${table[0].nick} wins with ${table[0].pts} points. The report’s in.` : 'The report’s in.').run();
      await useBump(env, 'lv_final');
      if (table[0]) await later(ctx, pushRound(env, r, [{ kind: 'final', txt: lvFinalLine(r, table, `${table[0].nick} wins with ${table[0].pts} points.`) + ' The match report’s in.' }]));
    }
    return res;
  }
  return json({ ok: false, error: 'Not found.' }, 404, cors);
}

/* ------------------------------------------------------------------ Polls
   A question for the group, shared into WhatsApp and answered in one tap.
   Society polls (soc set) are made by the organiser or co-organiser and
   answered by members (by member key); quick polls (no society) are made by
   anyone and answered by anyone with the link, with a nickname.
     pl_polls    id, soc, owner (pid), kind (pick | date), q, multi, named (show who voted for what),
                 adds (members can add options), closes (ISO), status (open | closed), winner, created
     pl_options  poll, oid, label, course (UK course id), town, day (date polls), by (nick)
     pl_votes    poll, voter (member key, or the pid for quick polls), nick, oid, ans (y | m for date polls)
   Nicknames only, and only what people choose. */
let plReady = false;
async function plSetup(env) {
  if (plReady) return;
  await socSetup(env);
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pl_polls (id TEXT PRIMARY KEY, soc TEXT, owner TEXT, kind TEXT, q TEXT, multi INTEGER, named INTEGER, adds INTEGER, closes TEXT, status TEXT, winner INTEGER, created TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS pl_polls_soc ON pl_polls (soc, created)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pl_options (poll TEXT, oid INTEGER, label TEXT, course TEXT, town TEXT, day TEXT, by TEXT, PRIMARY KEY (poll, oid)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pl_votes (poll TEXT, voter TEXT, nick TEXT, oid INTEGER, ans TEXT, at TEXT, PRIMARY KEY (poll, voter, oid)) WITHOUT ROWID'),
  ]);
  plReady = true;
}
function plClosed(p) { return p.status === 'closed' || (p.closes && p.closes < new Date().toISOString()); }
async function plWho(env, p, pid) {
  // The voter's key and nickname: a member of the society, or (quick poll) their own pid.
  if (!pid) return null;
  if (p.soc) { const m = await env.DEMAND.prepare('SELECT mkey, nick FROM soc_members WHERE soc = ? AND pid = ?').bind(p.soc, pid).first(); return m ? { k: m.mkey, nick: m.nick } : null; }
  const v = await env.DEMAND.prepare('SELECT nick FROM pl_votes WHERE poll = ? AND voter = ? LIMIT 1').bind(p.id, pid).first('nick');
  return { k: pid, nick: v || '' };
}
async function plCanClose(env, p, pid) {
  if (!pid) return false;
  if (pid === p.owner) return true;
  if (!p.soc) return false;
  const s = await hqSoc(env, p.soc);
  return !!s && socOrg(s, pid);
}
async function polls(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'Polls are taking a short break. Please try again in a minute.' }, 503, cors);
  await plSetup(env);
  const db = env.DEMAND, path = url.pathname, ip = request.headers.get('cf-connecting-ip') || '';
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, 8000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    if (await tooMany('pl-' + ip, 120, 600)) return json({ ok: false, error: 'Easy, tiger. Please try again in a few minutes.' }, 429, cors);
  }
  const q = (k) => String(body[k] !== undefined ? body[k] : url.searchParams.get(k) || '');
  const pid = PID_RX.test(q('pid')) ? q('pid') : '';
  const noStore = Object.assign({ 'cache-control': 'no-store' }, cors);
  const poll = async () => { const id = q('p'); return SOC_RX.test(id) ? await db.prepare('SELECT * FROM pl_polls WHERE id = ?').bind(id).first() : null; };

  if (path === '/pl/new' && request.method === 'POST') {
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    let soc = '';
    if (q('s')) {
      const s = await hqSoc(env, q('s'));
      if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can start a society poll.' }, 403, cors);
      soc = s.id;
    } else if (await tooMany('pln-' + ip, 15, 3600)) return json({ ok: false, error: 'That’s a lot of polls for one afternoon. Try again later.' }, 429, cors);
    const kind = body.kind === 'date' ? 'date' : 'pick';
    const question = socText(body.q, 100);
    if (question === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse.' }, 400, cors);
    if (!question || question.length < 4) return json({ ok: false, error: 'Ask a question (at least a few words).' }, 400, cors);
    const opts = [];
    for (const o of (Array.isArray(body.options) ? body.options : []).slice(0, 12)) {
      if (kind === 'date') {
        const d = String(o && o.day || o || '');
        if (DAY_RX.test(d) && d >= hqDay() && !opts.some((x) => x.day === d)) opts.push({ label: d, day: d, course: '', town: '' });
      } else {
        const label = socText(o && o.label, 50);
        if (label === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse.' }, 400, cors);
        if (!label || opts.some((x) => x.label.toLowerCase() === label.toLowerCase())) continue;
        opts.push({ label, day: '', course: ACE_COURSE_RX.test(String(o.course || '')) ? String(o.course) : '', town: socText(o.town, 40) || '' });
      }
    }
    if (opts.length < 2) return json({ ok: false, error: kind === 'date' ? 'Add at least two dates (today or later).' : 'Add at least two options.' }, 400, cors);
    if (kind === 'date') opts.sort((a, b) => (a.day < b.day ? -1 : 1));
    let closes = String(body.closes || '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(closes) || closes < new Date().toISOString() || closes > new Date(Date.now() + 60 * 864e5).toISOString()) closes = new Date(Date.now() + 7 * 864e5).toISOString();
    const id = socCode(8), now = new Date().toISOString();
    const steps = [db.prepare('INSERT INTO pl_polls (id, soc, owner, kind, q, multi, named, adds, closes, status, winner, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, soc, pid, kind, question, kind === 'date' || body.multi ? 1 : 0, body.named === false ? 0 : 1, kind === 'pick' && body.adds ? 1 : 0, closes, 'open', null, now)];
    opts.forEach((o, i) => steps.push(db.prepare('INSERT INTO pl_options (poll, oid, label, course, town, day, by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, i + 1, o.label, o.course, o.town, o.day, '')));
    await db.batch(steps);
    await useBump(env, soc ? 'pl_soc' : 'pl_quick');
    return json({ ok: true, id }, 200, cors);
  }
  if (path === '/pl/get') {
    const p = await poll();
    if (!p) return json({ ok: false, error: 'We couldn’t find that poll. Ask for the link again.' }, 404, noStore);
    const closed = plClosed(p);
    const opts = (await db.prepare('SELECT oid, label, course, town, day, by FROM pl_options WHERE poll = ? ORDER BY oid').bind(p.id).all()).results || [];
    const votes = (await db.prepare('SELECT voter, nick, oid, ans FROM pl_votes WHERE poll = ?').bind(p.id).all()).results || [];
    const me = await plWho(env, p, pid);
    let soc = null, waiting = null, total = null;
    if (p.soc) {
      const s = await hqSoc(env, p.soc);
      const mem = (await db.prepare('SELECT mkey, nick FROM soc_members WHERE soc = ?').bind(p.soc).all()).results || [];
      soc = { id: p.soc, name: s ? s.name : 'Society' };
      total = mem.length;
      const voted = new Set(votes.map((v) => v.voter));
      if (p.named && me) waiting = mem.filter((m) => !voted.has(m.mkey)).map((m) => m.nick);
    }
    const voters = new Set(votes.map((v) => v.voter));
    return json({ ok: true, id: p.id, kind: p.kind, q: p.q, multi: !!p.multi, named: !!p.named, adds: !!p.adds, closes: p.closes, closed, winner: p.winner, soc, total, voters: voters.size, waiting,
      canClose: await plCanClose(env, p, pid), member: p.soc ? !!me : true, me: me && me.nick ? { nick: me.nick } : null,
      mine: me ? votes.filter((v) => v.voter === me.k).map((v) => ({ oid: v.oid, ans: v.ans || 'y' })) : [],
      options: opts.map((o) => {
        const vs = votes.filter((v) => v.oid === o.oid);
        return { oid: o.oid, label: o.label, course: o.course, town: o.town, day: o.day, by: o.by,
          yes: vs.filter((v) => (v.ans || 'y') === 'y').length, maybe: vs.filter((v) => v.ans === 'm').length,
          who: p.named ? vs.map((v) => ({ nick: v.nick, ans: v.ans || 'y' })) : null };
      }) }, 200, noStore);
  }
  if (path === '/pl/vote' && request.method === 'POST') {
    const p = await poll();
    if (!p) return json({ ok: false, error: 'We couldn’t find that poll.' }, 404, cors);
    if (plClosed(p)) return json({ ok: false, error: 'This poll has closed.' }, 400, cors);
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    let me = await plWho(env, p, pid);
    if (p.soc && !me) return json({ ok: false, error: 'Join the society to vote.', join: true }, 403, cors);
    if (!p.soc) {
      const nick = cleanName(body.nick || me.nick, 2, 20);
      if (nick === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse.' }, 400, cors);
      if (!nick) return json({ ok: false, error: 'Pick a nickname first.', nick: true }, 400, cors);
      const taken = await db.prepare('SELECT voter FROM pl_votes WHERE poll = ? AND lower(nick) = lower(?) AND voter != ? LIMIT 1').bind(p.id, nick, pid).first('voter');
      if (taken) return json({ ok: false, error: 'Someone’s already voting as ' + nick + '. Pick another nickname.', nick: true }, 400, cors);
      me = { k: pid, nick };
    }
    const oids = new Set((((await db.prepare('SELECT oid FROM pl_options WHERE poll = ?').bind(p.id).all()).results) || []).map((o) => o.oid));
    const now = new Date().toISOString(), rows = [];
    if (p.kind === 'date') {
      const a = body.answers && typeof body.answers === 'object' ? body.answers : {};
      Object.keys(a).forEach((k) => { const o = Number(k), v = a[k]; if (oids.has(o) && (v === 'y' || v === 'm')) rows.push([o, v]); });
    } else {
      let pick = (Array.isArray(body.oids) ? body.oids : []).map(Number).filter((o) => oids.has(o));
      pick = [...new Set(pick)];
      if (!p.multi) pick = pick.slice(0, 1);
      if (!pick.length) return json({ ok: false, error: 'Pick an option first.' }, 400, cors);
      pick.forEach((o) => rows.push([o, 'y']));
    }
    await db.batch([db.prepare('DELETE FROM pl_votes WHERE poll = ? AND voter = ?').bind(p.id, me.k)].concat(
      rows.map(([o, a]) => db.prepare('INSERT INTO pl_votes (poll, voter, nick, oid, ans, at) VALUES (?, ?, ?, ?, ?, ?)').bind(p.id, me.k, me.nick, o, a, now)),
      // A date poll with every day a "no" still counts as answered.
      p.kind === 'date' && !rows.length ? [db.prepare('INSERT INTO pl_votes (poll, voter, nick, oid, ans, at) VALUES (?, ?, ?, 0, ?, ?)').bind(p.id, me.k, me.nick, 'n', now)] : []));
    await useBump(env, 'pl_vote');
    return json({ ok: true }, 200, cors);
  }
  if (path === '/pl/add' && request.method === 'POST') {
    const p = await poll();
    if (!p || p.kind !== 'pick') return json({ ok: false, error: 'Bad request.' }, 400, cors);
    if (plClosed(p)) return json({ ok: false, error: 'This poll has closed.' }, 400, cors);
    const can = await plCanClose(env, p, pid);
    if (!p.adds && !can) return json({ ok: false, error: 'The organiser has switched off new options.' }, 403, cors);
    const me = await plWho(env, p, pid);
    if (p.soc && !me && !can) return json({ ok: false, error: 'Join the society to add an option.', join: true }, 403, cors);
    const label = socText(body.label, 50);
    if (label === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse.' }, 400, cors);
    if (!label) return json({ ok: false, error: 'Type an option first.' }, 400, cors);
    const opts = (await db.prepare('SELECT oid, label FROM pl_options WHERE poll = ?').bind(p.id).all()).results || [];
    if (opts.length >= 12) return json({ ok: false, error: 'That’s twelve options already: plenty to argue about.' }, 400, cors);
    if (opts.some((o) => o.label.toLowerCase() === label.toLowerCase())) return json({ ok: false, error: 'That one’s already on the list.' }, 400, cors);
    const oid = Math.max(0, ...opts.map((o) => o.oid)) + 1;
    await db.prepare('INSERT INTO pl_options (poll, oid, label, course, town, day, by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(p.id, oid, label, ACE_COURSE_RX.test(String(body.course || '')) ? String(body.course) : '', socText(body.town, 40) || '', '', me && me.nick ? me.nick : '').run();
    return json({ ok: true, oid }, 200, cors);
  }
  if (path === '/pl/close' && request.method === 'POST') {
    const p = await poll();
    if (!p || !(await plCanClose(env, p, pid))) return json({ ok: false, error: 'Only the organiser can close the poll.' }, 403, cors);
    const top = await db.prepare("SELECT oid, SUM(CASE WHEN ans = 'm' THEN 0.5 ELSE 1 END) AS n FROM pl_votes WHERE poll = ? AND oid > 0 GROUP BY oid ORDER BY n DESC, oid LIMIT 1").bind(p.id).first();
    await db.prepare("UPDATE pl_polls SET status = 'closed', winner = ?, closes = ? WHERE id = ?").bind(top ? top.oid : null, new Date().toISOString(), p.id).run();
    return json({ ok: true, winner: top ? top.oid : null }, 200, cors);
  }
  if (path === '/pl/delete' && request.method === 'POST') {
    const p = await poll();
    if (!p || !(await plCanClose(env, p, pid))) return json({ ok: false, error: 'Only the organiser can delete the poll.' }, 403, cors);
    await db.batch([db.prepare('DELETE FROM pl_votes WHERE poll = ?').bind(p.id), db.prepare('DELETE FROM pl_options WHERE poll = ?').bind(p.id), db.prepare('DELETE FROM pl_polls WHERE id = ?').bind(p.id)]);
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: false, error: 'Not found.' }, 404, cors);
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
/* ------------------------------------------------------------------ Crowd Caddie
   On every price page: "Where's this price heading in the next two weeks?"
   Golfers call Cheaper, Holds or Pricier. We lock in that day's lowest UK
   price (from the page's own data.json, never from the browser) and, 14 days
   later, check the real price from the same file's history: down 2% or more
   is Cheaper, up 2% or more is Pricier, anything in between Holds.
   Calls are kept under the random player id only. A nickname is optional and
   only needed for the Oracle board (golfpriceai.com/play/oracle/).
   Settling happens lazily, whenever a page asks: no schedule needed. */
const CC_CALLS = { down: 1, same: 1, up: 1 };
const CC_DAYS = 14, CC_BAND = 0.02, CC_MIN_BOARD = 5;
let ccReady = false;
async function ccSetup(env) {
  if (ccReady) return;
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS cc_votes (pid TEXT, slug TEXT, name TEXT, day TEXT, call TEXT, price REAL, due TEXT, result REAL, outcome TEXT, hit INTEGER, PRIMARY KEY (pid, slug, day)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS cc_slug ON cc_votes (slug, due)'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS cc_open ON cc_votes (outcome, due)'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS cc_nicks (id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT UNIQUE, nick TEXT, hidden INTEGER DEFAULT 0, updated TEXT)'),
  ]);
  ccReady = true;
}
function ccDay(offset = 0) { return new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10); }
function ccAdd(day, n) { return new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
const ccData = new Map();
async function ccProduct(env, slug) {
  const hit = ccData.get(slug);
  if (hit && Date.now() - hit.at < 1800e3) return hit.d;
  const res = await fetch(`${env.SITE || 'https://golfpriceai.com'}/prices/${slug}/data.json`, { cf: { cacheTtl: 1800, cacheEverything: true } });
  let d;
  if (res.status === 404) d = { gone: true };
  else if (!res.ok) return null;
  else {
    try { d = await res.json(); } catch (e) { return null; }
    if (!d || typeof d.lowestNewPrice !== 'number') d = { gone: true };
  }
  if (ccData.size > 500) ccData.clear();
  ccData.set(slug, { at: Date.now(), d });
  return d;
}
// The lowest price on a given day, from the data.json history (change points).
function ccPriceOn(d, day) {
  const s = (d.history && Array.isArray(d.history.series)) ? d.history.series : [];
  let p = null;
  for (const pt of s) { if (pt[0] <= day) p = Number(pt[1]); else break; }
  return p === null ? (d.checked && d.checked >= day ? d.lowestNewPrice : null) : p;
}
function ccOutcome(from, to) {
  if (!(from > 0) || !(to > 0)) return null;
  if (to <= from * (1 - CC_BAND)) return 'down';
  if (to >= from * (1 + CC_BAND)) return 'up';
  return 'same';
}
// Settle every call on one product that has reached its 14 days.
async function ccSettle(env, slug) {
  const db = env.DEMAND, today = ccDay();
  const due = (await db.prepare('SELECT pid, day, call, price, due FROM cc_votes WHERE slug = ? AND outcome IS NULL AND due <= ?').bind(slug, today).all()).results || [];
  if (!due.length) return 0;
  const d = await ccProduct(env, slug);
  if (!d) return 0;
  const ups = [];
  for (const v of due) {
    if (d.gone) { ups.push(db.prepare("UPDATE cc_votes SET outcome = 'void' WHERE pid = ? AND slug = ? AND day = ?").bind(v.pid, slug, v.day)); continue; }
    if (!d.checked || d.checked < v.due) continue; // the price file hasn't caught up yet
    const p = ccPriceOn(d, v.due), o = ccOutcome(Number(v.price), p);
    if (!o) continue;
    ups.push(db.prepare('UPDATE cc_votes SET result = ?, outcome = ?, hit = ? WHERE pid = ? AND slug = ? AND day = ?')
      .bind(Math.round(p * 100) / 100, o, o === v.call ? 1 : 0, v.pid, slug, v.day));
  }
  if (ups.length) await db.batch(ups);
  return ups.length;
}
async function ccSettleSome(env, where, args, max) {
  const rows = (await env.DEMAND.prepare(`SELECT DISTINCT slug FROM cc_votes WHERE outcome IS NULL AND due <= ? ${where} LIMIT ${max}`).bind(ccDay(), ...args).all()).results || [];
  for (const r of rows) { try { await ccSettle(env, r.slug); } catch (e) { /* try again next time */ } }
}
async function ccState(env, slug, pid) {
  const db = env.DEMAND, today = ccDay();
  try { await ccSettle(env, slug); } catch (e) { /* fine */ }
  const open = await db.prepare("SELECT SUM(call = 'down') AS down, SUM(call = 'same') AS same, SUM(call = 'up') AS up, COUNT(*) AS n FROM cc_votes WHERE slug = ? AND due > ?").bind(slug, today).first();
  const total = Number(await db.prepare('SELECT COUNT(*) AS c FROM cc_votes WHERE slug = ?').bind(slug).first('c')) || 0;
  const past = await db.prepare("SELECT COUNT(*) AS n, SUM(call = 'down') AS down, SUM(call = 'same') AS same, SUM(call = 'up') AS up, SUM(hit) AS r, MAX(due) AS last FROM cc_votes WHERE slug = ? AND outcome IN ('down', 'same', 'up') AND due >= ?").bind(slug, ccAdd(today, -45)).first();
  const lastOut = past && Number(past.n) ? await db.prepare("SELECT outcome, price, result FROM cc_votes WHERE slug = ? AND outcome IN ('down', 'same', 'up') ORDER BY due DESC LIMIT 1").bind(slug).first() : null;
  const site = await db.prepare("SELECT COUNT(*) AS n, SUM(hit) AS r FROM cc_votes WHERE outcome IN ('down', 'same', 'up') AND due >= ?").bind(ccAdd(today, -30)).first();
  let mine = null, last = null;
  if (pid) {
    mine = await db.prepare('SELECT call, price, day, due FROM cc_votes WHERE pid = ? AND slug = ? AND due > ? ORDER BY day DESC LIMIT 1').bind(pid, slug, today).first();
    last = await db.prepare("SELECT call, price, day, due, result, outcome, hit FROM cc_votes WHERE pid = ? AND slug = ? AND outcome IS NOT NULL ORDER BY due DESC LIMIT 1").bind(pid, slug).first();
    if (!mine) {
      const waiting = await db.prepare('SELECT call, price, day, due FROM cc_votes WHERE pid = ? AND slug = ? AND outcome IS NULL ORDER BY day DESC LIMIT 1').bind(pid, slug).first();
      if (waiting) mine = Object.assign(waiting, { settling: true });
    }
  }
  const N = (x) => Number(x) || 0;
  return {
    ok: true, slug, total,
    open: { down: N(open && open.down), same: N(open && open.same), up: N(open && open.up), n: N(open && open.n) },
    past: past && N(past.n) >= 5 ? { n: N(past.n), down: N(past.down), same: N(past.same), up: N(past.up), right: N(past.r),
      outcome: lastOut ? lastOut.outcome : null, from: lastOut ? lastOut.price : null, to: lastOut ? lastOut.result : null } : null,
    site: site && N(site.n) >= 20 ? { n: N(site.n), right: N(site.r) } : null,
    mine, last,
  };
}
async function ccNick(env, pid, raw) {
  const nick = cleanName(raw, 2, 20);
  if (nick === null) return { ok: false, error: 'Let’s keep it clean for the clubhouse. Try another nickname.' };
  if (!nick) return { ok: false, error: 'Pick a nickname (at least 2 letters).' };
  await env.DEMAND.prepare('INSERT INTO cc_nicks (pid, nick, updated) VALUES (?, ?, ?) ON CONFLICT (pid) DO UPDATE SET nick = excluded.nick, updated = excluded.updated')
    .bind(pid, nick, ccDay()).run();
  return { ok: true, nick };
}
async function crowdCaddie(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'The Crowd Caddie is taking a short break. Please try again later.' }, 503, cors);
  await ccSetup(env);
  const path = url.pathname, db = env.DEMAND, today = ccDay();
  const ip = request.headers.get('cf-connecting-ip') || '';
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, 1000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    if (await tooMany('cc-' + ip, 60, 3600)) return json({ ok: false, error: 'Easy, tiger. Please try again later.' }, 429, cors);
  }
  const pidIn = String((request.method === 'POST' ? body.pid : url.searchParams.get('pid')) || '');
  const pid = PID_RX.test(pidIn) ? pidIn : '';
  const noStore = Object.assign({ 'cache-control': 'no-store' }, cors);

  if (path === '/cc/state') {
    const slug = String(url.searchParams.get('s') || '');
    if (!SLUG_RX.test(slug)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    return json(await ccState(env, slug, pid), 200, noStore);
  }

  if (path === '/cc/vote' && request.method === 'POST') {
    const slug = String(body.slug || ''), call = String(body.call || '');
    if (!pid || !SLUG_RX.test(slug) || !CC_CALLS[call]) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const had = await db.prepare('SELECT 1 AS x FROM cc_votes WHERE pid = ? AND slug = ? AND (due > ? OR outcome IS NULL)').bind(pid, slug, today).first();
    if (had) return json(Object.assign(await ccState(env, slug, pid), { again: true }), 200, noStore);
    const mineToday = Number(await db.prepare('SELECT COUNT(*) AS c FROM cc_votes WHERE pid = ? AND day = ?').bind(pid, today).first('c')) || 0;
    if (mineToday >= 40) return json({ ok: false, error: 'Forty calls in a day? Save some for tomorrow.' }, 429, cors);
    // One call per visitor per product per day, whatever player id they send.
    await demandSetup(env);
    const v = (await sha1([ip, today, env.ALERTS_SECRET || ''].join('|'))).slice(0, 16);
    const fresh = await db.prepare('INSERT OR IGNORE INTO seen (day, v, kind, key) VALUES (?, ?, ?, ?)').bind(today, v, 'cc', slug).run();
    if (!(fresh.meta && fresh.meta.changes)) return json(Object.assign(await ccState(env, slug, pid), { again: true }), 200, noStore);
    const d = await ccProduct(env, slug);
    if (!d || d.gone) return json({ ok: false, error: 'We can’t find today’s price for that one. Please try again later.' }, 400, cors);
    await db.prepare('INSERT OR IGNORE INTO cc_votes (pid, slug, name, day, call, price, due) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(pid, slug, String(d.name || slug).slice(0, 90), today, call, Number(d.lowestNewPrice), ccAdd(today, CC_DAYS)).run();
    if (body.nick) await ccNick(env, pid, body.nick);
    return json(await ccState(env, slug, pid), 200, noStore);
  }

  if (path === '/cc/nick' && request.method === 'POST') {
    if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const r = await ccNick(env, pid, body.nick);
    return json(r, r.ok ? 200 : 400, cors);
  }

  // The Oracle board, plus this golfer's own calls.
  if (path === '/cc/board') {
    await ccSettleSome(env, '', [], 12);
    if (pid) await ccSettleSome(env, 'AND pid = ?', [pid], 8);
    const month = today.slice(0, 7);
    const SETTLED = "v.outcome IN ('down', 'same', 'up')";
    const board = async (extra, args) => ((await db.prepare(`SELECT v.pid AS pid, n.nick AS nick, COUNT(*) AS n, SUM(v.hit) AS r FROM cc_votes v JOIN cc_nicks n ON n.pid = v.pid AND n.hidden = 0
      WHERE ${SETTLED} ${extra} GROUP BY v.pid HAVING COUNT(*) >= ${CC_MIN_BOARD} ORDER BY SUM(v.hit) * 1.0 / COUNT(*) DESC, COUNT(*) DESC LIMIT 20`).bind(...args).all()).results || [])
      .map((x) => ({ nick: x.nick, n: Number(x.n), r: Number(x.r) || 0, me: !!pid && x.pid === pid }));
    const top = await board('AND substr(v.due, 1, 7) = ?', [month]);
    const ever = await board('', []);
    const crowd = await db.prepare(`SELECT COUNT(*) AS n, SUM(hit) AS r FROM cc_votes v WHERE ${SETTLED} AND substr(v.due, 1, 7) = ?`).bind(month).first();
    const crowdEver = await db.prepare(`SELECT COUNT(*) AS n, SUM(hit) AS r FROM cc_votes v WHERE ${SETTLED}`).first();
    const openN = Number(await db.prepare('SELECT COUNT(*) AS c FROM cc_votes WHERE outcome IS NULL').first('c')) || 0;
    const firstDue = await db.prepare('SELECT MIN(due) AS d FROM cc_votes WHERE outcome IS NULL').first('d');
    const hot = ((await db.prepare("SELECT slug, MAX(name) AS name, COUNT(*) AS n, SUM(call = 'down') AS down, SUM(call = 'same') AS same, SUM(call = 'up') AS up FROM cc_votes WHERE due > ? GROUP BY slug HAVING COUNT(*) >= 3 ORDER BY COUNT(*) DESC LIMIT 6").bind(today).all()).results || [])
      .map((x) => ({ slug: x.slug, name: x.name, n: Number(x.n), down: Number(x.down) || 0, same: Number(x.same) || 0, up: Number(x.up) || 0 }));
    let me = null;
    if (pid) {
      const nk = await db.prepare('SELECT nick, hidden FROM cc_nicks WHERE pid = ?').bind(pid).first();
      const mm = await db.prepare(`SELECT COUNT(*) AS n, SUM(hit) AS r FROM cc_votes v WHERE pid = ? AND ${SETTLED} AND substr(v.due, 1, 7) = ?`).bind(pid, month).first();
      const me2 = await db.prepare(`SELECT COUNT(*) AS n, SUM(hit) AS r FROM cc_votes v WHERE pid = ? AND ${SETTLED}`).bind(pid).first();
      const calls = (await db.prepare('SELECT slug, name, call, price, day, due, result, outcome, hit FROM cc_votes WHERE pid = ? ORDER BY day DESC LIMIT 30').bind(pid).all()).results || [];
      me = { nick: nk && !nk.hidden ? nk.nick : null, month: { n: Number(mm && mm.n) || 0, r: Number(mm && mm.r) || 0 },
        ever: { n: Number(me2 && me2.n) || 0, r: Number(me2 && me2.r) || 0 }, rank: (top.findIndex((x) => x.me) + 1) || null, calls };
    }
    return json({ ok: true, month, min: CC_MIN_BOARD, top, ever,
      crowd: { n: Number(crowd && crowd.n) || 0, r: Number(crowd && crowd.r) || 0, everN: Number(crowdEver && crowdEver.n) || 0, everR: Number(crowdEver && crowdEver.r) || 0, open: openN, firstDue: firstDue || null },
      hot, me }, 200, noStore);
  }

  // For the 6-hourly site build: the crowd's open calls per product (3 or more
  // golfers) and the crowd's record, so price pages, data.json files and the
  // Oracle board can show them as plain text. Counts only, no ids or nicknames.
  if (path === '/cc/summary') {
    await ccSettleSome(env, '', [], 12);
    const rows = (await db.prepare("SELECT slug, COUNT(*) AS n, SUM(call = 'down') AS down, SUM(call = 'same') AS same, SUM(call = 'up') AS up FROM cc_votes WHERE due > ? GROUP BY slug HAVING COUNT(*) >= 3").bind(today).all()).results || [];
    const month = today.slice(0, 7);
    const crowd = await db.prepare("SELECT COUNT(*) AS n, SUM(hit) AS r FROM cc_votes WHERE outcome IN ('down', 'same', 'up') AND substr(due, 1, 7) = ?").bind(month).first();
    const ever = await db.prepare("SELECT COUNT(*) AS n, SUM(hit) AS r FROM cc_votes WHERE outcome IN ('down', 'same', 'up')").first();
    const out = {};
    rows.forEach((r) => { out[r.slug] = { n: Number(r.n), down: Number(r.down) || 0, same: Number(r.same) || 0, up: Number(r.up) || 0 }; });
    return json({ ok: true, at: new Date().toISOString(), month, products: out,
      crowd: { n: Number(crowd && crowd.n) || 0, r: Number(crowd && crowd.r) || 0, everN: Number(ever && ever.n) || 0, everR: Number(ever && ever.r) || 0 } }, 200, Object.assign({ 'cache-control': 'public, max-age=300' }, cors));
  }

  // John only: hide or bring back a nickname on the Oracle board.
  if (path === '/cc/admin' && request.method === 'POST') {
    if (await keyLocked(ip || 'unknown')) return json({ ok: false, error: 'Too many wrong tries. The door opens again in ten minutes.' }, 429, cors);
    if (!keyMatches(env, body.key)) { await tooMany('stats-' + (ip || 'unknown'), 5, 600); return json({ ok: false, error: 'That key isn’t right.' }, 403, cors); }
    const id = Number(body.id), act = String(body.action || '');
    if (!(id > 0) || !['hide', 'show'].includes(act)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await db.prepare('UPDATE cc_nicks SET hidden = ? WHERE id = ?').bind(act === 'hide' ? 1 : 0, id).run();
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: false, error: 'Not found.' }, 404, cors);
}
/* ------------------------------------------------------------------ The People's Bag
   golfpriceai.com/play/peoples-bag/: golfers pick their favourite model in
   eight slots (driver to bag). The most-picked model in each slot makes the
   People's Bag. One pick per slot per player id, changeable any time. The
   models on offer come from the site's own data/peoples-bag.json, so only
   real models with price pages can be picked. */
const PB_SLOTS = { driver: 1, wood: 1, hybrid: 1, irons: 1, wedge: 1, putter: 1, ball: 1, bag: 1 };
let pbReady = false, pbList = null, pbListAt = 0;
async function pbSetup(env) {
  if (pbReady) return;
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS pb_picks (pid TEXT, slot TEXT, slug TEXT, at TEXT, PRIMARY KEY (pid, slot)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS pb_slot ON pb_picks (slot, slug)'),
  ]);
  pbReady = true;
}
async function pbAllowed(env) {
  if (pbList && Date.now() - pbListAt < 3600e3) return pbList;
  const res = await fetch((env.SITE || 'https://golfpriceai.com') + '/data/peoples-bag.json', { cf: { cacheTtl: 1800, cacheEverything: true } });
  if (!res.ok) return pbList;
  const d = await res.json(), m = {};
  (d.slots || []).forEach((s) => { m[s.key] = new Set((s.items || []).map((x) => x.s)); });
  pbList = m; pbListAt = Date.now();
  return m;
}
async function pbState(env, pid) {
  const db = env.DEMAND;
  const rows = (await db.prepare('SELECT slot, slug, COUNT(*) AS c FROM pb_picks GROUP BY slot, slug ORDER BY c DESC').all()).results || [];
  const slots = {};
  rows.forEach((r) => {
    const s = slots[r.slot] || (slots[r.slot] = { n: 0, top: [] });
    s.n += Number(r.c);
    if (s.top.length < 6) s.top.push({ s: r.slug, c: Number(r.c) });
  });
  const pickers = Number(await db.prepare('SELECT COUNT(DISTINCT pid) AS c FROM pb_picks').first('c')) || 0;
  let mine = null;
  if (pid) {
    mine = {};
    ((await db.prepare('SELECT slot, slug FROM pb_picks WHERE pid = ?').bind(pid).all()).results || []).forEach((r) => { mine[r.slot] = r.slug; });
  }
  return { ok: true, pickers, slots, mine };
}
async function peoplesBag(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'The People’s Bag is taking a short break. Please try again later.' }, 503, cors);
  await pbSetup(env);
  const path = url.pathname, db = env.DEMAND, ip = request.headers.get('cf-connecting-ip') || '';
  if (path === '/pb/state') {
    const p = String(url.searchParams.get('pid') || '');
    return json(await pbState(env, PID_RX.test(p) ? p : ''), 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  }
  // For the site build: the People's Bag as it stands, with no player ids.
  if (path === '/pb/summary') {
    const st = await pbState(env, '');
    delete st.mine;
    return json(st, 200, Object.assign({ 'cache-control': 'public, max-age=300' }, cors));
  }
  if (path === '/pb/pick' && request.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await request.text()).slice(0, 500)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    if (await tooMany('pb-' + ip, 120, 3600)) return json({ ok: false, error: 'Easy, tiger. Please try again later.' }, 429, cors);
    const pid = String(body.pid || ''), slot = String(body.slot || ''), slug = String(body.slug || '');
    if (!PID_RX.test(pid) || !PB_SLOTS[slot] || !SLUG_RX.test(slug)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const allowed = await pbAllowed(env);
    if (!allowed || !allowed[slot] || !allowed[slot].has(slug)) return json({ ok: false, error: 'We can’t find that one. Pick it from the list.' }, 400, cors);
    const had = await db.prepare('SELECT slug FROM pb_picks WHERE pid = ? AND slot = ?').bind(pid, slot).first();
    if (!had) {
      // A new picker in this slot: once per connection per slot per day, so the bag can't be stuffed.
      await demandSetup(env);
      const day = new Date().toISOString().slice(0, 10);
      const v = (await sha1([ip, day, env.ALERTS_SECRET || ''].join('|'))).slice(0, 16);
      const fresh = await db.prepare('INSERT OR IGNORE INTO seen (day, v, kind, key) VALUES (?, ?, ?, ?)').bind(day, v, 'pb', slot).run();
      if (!(fresh.meta && fresh.meta.changes)) return json({ ok: false, error: 'Someone on this connection already picked this slot today. Try again tomorrow.' }, 429, cors);
    }
    await db.prepare('INSERT INTO pb_picks (pid, slot, slug, at) VALUES (?, ?, ?, ?) ON CONFLICT (pid, slot) DO UPDATE SET slug = excluded.slug, at = excluded.at')
      .bind(pid, slot, slug, new Date().toISOString().slice(0, 10)).run();
    return json(await pbState(env, pid), 200, Object.assign({ 'cache-control': 'no-store' }, cors));
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
    reports: await one('SELECT COUNT(*) AS c FROM soc_reports'),
    reportsWeek: await one('SELECT COUNT(*) AS c FROM soc_reports WHERE published >= ?', weekAgo),
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
      'ms_first_hcp', 'ms_scratch', 'ms_bandit', 'ms_champion', 'ms_streak', 'ms_share', 'ms_called'].reduce((o, k) => {
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

  // ---- Crowd Caddie: calls, how often the crowd is right, and Oracle board nicknames to check.
  try {
    await ccSetup(env);
    const SET = "outcome IN ('down', 'same', 'up')";
    out.caddie = {
      today: await one('SELECT COUNT(*) AS c FROM cc_votes WHERE day = ?', day),
      week: await one('SELECT COUNT(*) AS c FROM cc_votes WHERE day >= ?', weekAgo),
      total: await one('SELECT COUNT(*) AS c FROM cc_votes'),
      open: await one('SELECT COUNT(*) AS c FROM cc_votes WHERE outcome IS NULL'),
      settled: await one(`SELECT COUNT(*) AS c FROM cc_votes WHERE ${SET}`),
      right: await one(`SELECT COUNT(*) AS c FROM cc_votes WHERE ${SET} AND hit = 1`),
      products: await one('SELECT COUNT(DISTINCT slug) AS c FROM cc_votes'),
      callers: await one('SELECT COUNT(DISTINCT pid) AS c FROM cc_votes'),
      views7: sumUse('cc_view', d7), shares7: sumUse('cc_share', d7), oracle7: sumUse('oracle_view', d7),
      nicks: await all('SELECT n.id, n.nick, n.hidden, n.updated, (SELECT COUNT(*) FROM cc_votes v WHERE v.pid = n.pid) AS calls FROM cc_nicks n ORDER BY n.id DESC LIMIT 25'),
    };
  } catch (e) { out.caddie = null; }

  out.societies.fgViews7 = sumUse('fg_view', d7); out.societies.fgShares7 = sumUse('fg_share', d7);

  // ---- The National Society League
  try {
    await lgSetup(env);
    out.league = {
      entries: await one('SELECT COUNT(*) AS c FROM lg_entries WHERE hidden = 0'),
      champ: await one('SELECT COUNT(*) AS c FROM lg_entries WHERE hidden = 0 AND champ = 1'),
      full: await one('SELECT COUNT(*) AS c FROM lg_entries WHERE hidden = 0 AND allowance = 100'),
      regions: await all('SELECT region, COUNT(*) AS c FROM lg_entries WHERE hidden = 0 GROUP BY region ORDER BY c DESC'),
      recent: await all('SELECT l.soc, s.name, l.region, l.division, l.hidden FROM lg_entries l JOIN soc_socs s ON s.id = l.soc ORDER BY l.entered DESC LIMIT 20'),
    };
  } catch (e) { out.league = null; }

  // ---- The People's Bag
  try {
    await pbSetup(env);
    out.peoplesBag = {
      pickers: await one('SELECT COUNT(DISTINCT pid) AS c FROM pb_picks'),
      picks: await one('SELECT COUNT(*) AS c FROM pb_picks'),
      full: await one('SELECT COUNT(*) AS c FROM (SELECT pid FROM pb_picks GROUP BY pid HAVING COUNT(*) >= 8)'),
      week: await one('SELECT COUNT(*) AS c FROM pb_picks WHERE at >= ?', weekAgo),
      views7: sumUse('pb_view', d7), shares7: sumUse('pb_share', d7),
    };
  } catch (e) { out.peoplesBag = null; }
  // Clubhouse keys: how many golfers can get back in, and co-organisers.
  try {
    await ckSetup(env);
    out.keys = { keys: await one('SELECT COUNT(*) AS c FROM ck_keys'), vaults: await one('SELECT COUNT(*) AS c FROM ck_vault'),
      made7: sumUse('ck_made', d7), restored30: sumUse('ck_restored', d30), passkeys: await one('SELECT COUNT(DISTINCT pid) AS c FROM pk_creds'), pkUnlocked30: sumUse('pk_unlocked', d30),
      orgs: await one('SELECT COUNT(*) AS c FROM soc_socs'), orgKeys: await one('SELECT COUNT(*) AS c FROM soc_socs s JOIN ck_keys k ON k.pid = s.pid'),
      co: await one('SELECT COUNT(*) AS c FROM soc_socs WHERE co IS NOT NULL') };
  } catch (e) { out.keys = null; }
  // Shot Saver: anonymous counts only (golfers a day who looked, added a round, shared).
  out.shotSaver = { views7: sumUse('ss_view', d7), views30: sumUse('ss_view', d30), rounds7: sumUse('ss_round', d7),
    rounds30: sumUse('ss_round', d30), shares7: sumUse('ss_share', d7), saved30: sumUse('ms_saved', d30) };

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

  // ---- Money: clicks out to shops, where shoppers came from, alert sources, gaps
  const span = (k) => ({ today: sumUse(k, day), d7: sumUse(k, d7), d30: sumUse(k, d30) });
  out.money = {
    out: span('out_any'),
    outPage: MONEY_PAGES.map((k) => [k, span('out_' + k)]),
    from: MONEY_FROM.map((k) => [k, span('arr_' + k), span('outf_' + k)]),
    alerts: ALERT_FROM.map((k) => [k, span('al_' + k)]),
    ask: span('ask_group'), pcLink: span('pc_link'), unsub: span('unsub'),
    // Growth tests (Nov 2026): the Cheat Sheet, "It's my ball", and Money Sorted on Society HQ.
    tests: { csMake: span('cs_make'), csView: span('cs_view'), csClick: span('cs_click'), mbView: span('mb_view'), mbSignup: span('mb_signup'), mbMine: span('al_myball'),
      ipaid: span('mny_ipaid'), confirm: span('mny_confirm'), chase: span('mny_chase'), kitty: span('mny_kitty'), drop: span('mny_drop'), ref: span('mny_ref') },
    misses: [], embeds: [],
  };
  try {
    await demandSetup(env);
    out.money.misses = (await all("SELECT key, SUM(n) AS c FROM counts WHERE kind = 'miss' AND day >= ? GROUP BY key ORDER BY c DESC LIMIT 25", d30))
      .map((r) => [r.key, Number(r.c) || 0]);
    out.money.embeds = (await all("SELECT key, SUM(n) AS c, MAX(day) AS last FROM counts WHERE kind = 'emb' GROUP BY key ORDER BY c DESC LIMIT 40"))
      .map((r) => [r.key, Number(r.c) || 0, r.last]);
  } catch (e) { /* none yet */ }

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
const SIGNAL_KINDS = { view: 1, heart: 1, search: 1, pp: 1, miss: 1, emb: 1 };
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
  } else if (kind === 'search' || kind === 'miss') {
    const q = cleanSearch(body.q);
    if (q) items = [[q, 0]];
  } else if (kind === 'emb') {
    // Which websites show our embedded charts or Ace Board: the site's name only.
    const m = String(body.q || '').toLowerCase().match(/^(price|aces) ([a-z0-9][a-z0-9.-]{1,80}\.[a-z]{2,})$/);
    if (m && !/(^|\.)golfpriceai\.com$|^localhost$/.test(m[2])) items = [[m[1] + ' ' + m[2], 0]];
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
const MISSED = 10; // a missed round counts as +10 in the weekly table: the worst a round can score, so not playing never beats playing
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
      active.sort((a, b) => a.week - b.week || b.played - a.played);
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
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_results (event TEXT, mkey TEXT, pts INTEGER, back INTEGER, PRIMARY KEY (event, mkey)) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_reports (event TEXT PRIMARY KEY, extras TEXT, prize TEXT, published TEXT) WITHOUT ROWID'),
  ]);
  // Find a Society (added Nov 2026): home course, when they play, who it suits, typical cost;
  // spare places on a golf day; and "ask to join" requests (nickname and a note only).
  for (const col of ['course TEXT', 'cname TEXT', 'ctown TEXT', 'lat REAL', 'lon REAL', 'days TEXT', 'ability TEXT', 'cost TEXT']) {
    try { await env.DEMAND.prepare('ALTER TABLE soc_socs ADD COLUMN ' + col).run(); } catch (e) { /* already there */ }
  }
  try { await env.DEMAND.prepare('ALTER TABLE soc_events ADD COLUMN spare INTEGER').run(); } catch (e) { /* already there */ }
  await env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_requests (id TEXT PRIMARY KEY, soc TEXT, pid TEXT, nick TEXT, note TEXT, event TEXT, at TEXT, status TEXT) WITHOUT ROWID').run();
  // Co-organiser (added Nov 2026): a second member who can run the society too.
  try { await env.DEMAND.prepare('ALTER TABLE soc_socs ADD COLUMN co TEXT').run(); } catch (e) { /* already there */ }
  await env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_handback (token TEXT PRIMARY KEY, soc TEXT, exp INTEGER) WITHOUT ROWID').run();
  // County for Find a Society (added Oct 2026): add the column once; it already exists after that.
  try { await env.DEMAND.prepare('ALTER TABLE soc_socs ADD COLUMN county TEXT').run(); } catch (e) { /* already there */ }
  // Money Sorted (Nov 2026): "how to pay" note, "I've paid" claims, how a place
  // was paid (kitty), the drop-out rule per fixture and the season kitty ledger.
  for (const [t, col] of [['soc_socs', 'paynote TEXT'], ['soc_entries', 'claim TEXT'], ['soc_entries', 'via TEXT'], ['soc_events', 'droprule INTEGER']]) {
    try { await env.DEMAND.prepare(`ALTER TABLE ${t} ADD COLUMN ${col}`).run(); } catch (e) { /* already there */ }
  }
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_kitty (id TEXT PRIMARY KEY, soc TEXT, mkey TEXT, amount REAL, note TEXT, event TEXT, kind TEXT, at TEXT) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS soc_kitty_soc ON soc_kitty (soc, mkey)'),
  ]);
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
  if (path === '/soc/asks') return await hqAsks(env, pid, cors);
  if (request.method === 'POST' && path === '/soc/ask') return await hqAsk(env, body, pid, request, cors);
  if (request.method === 'POST' && path === '/soc/answer') return await hqAnswer(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/fromleague') return await hqFromLeague(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/leaguereq') return await hqLeagueReq(env, body, pid, cors);
  if (path === '/soc/s') return await hqGet(env, String(url.searchParams.get('s') || ''), pid, cors);
  if (path === '/soc/pp') return await sppGet(env, String(url.searchParams.get('s') || ''), pid, cors);
  if (path === '/soc/ppnat') return await sppNational(env, cors);
  if (request.method === 'POST' && path === '/soc/ppset') return await sppSet(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/new') return await hqNew(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/edit') return await hqEdit(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/join') return await hqJoin(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/leave') return await hqLeave(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/event') return await hqEvent(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/rsvp') return await hqRsvp(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/paid') return await hqPaid(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/ipaid') return await hqIPaid(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/kitty') return await hqKitty(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/remove') return await hqRemove(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/coorg') return await hqCoOrg(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/handback') return await hqHandback(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/claim') return await hqClaim(env, body, pid, request, cors);
  if (path === '/soc/fg') return await fgGet(env, String(url.searchParams.get('e') || ''), pid, cors);
  if (path === '/soc/scores') return await fgScores(env, String(url.searchParams.get('e') || ''), pid, cors);
  if (request.method === 'POST' && path === '/soc/results') return await fgSave(env, body, pid, cors);
  if (request.method === 'POST' && path === '/soc/unpublish') return await fgUnpublish(env, body, pid, cors);
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
// The organiser, or the co-organiser they picked.
function socOrg(s, pid) { return !!(s && pid && (pid === s.pid || (s.co && pid === s.co))); }
function evOrg(e, pid) { return !!(e && pid && (pid === e.org || (e.co && pid === e.co))); }
async function hqSoc(env, id) { return SOC_RX.test(id) ? await env.DEMAND.prepare('SELECT * FROM soc_socs WHERE id = ?').bind(id).first() : null; }
async function hqTouch(env, id) { await env.DEMAND.prepare('UPDATE soc_socs SET updated = ? WHERE id = ?').bind(hqDay(), id).run(); }
function hqFields(body) {
  const name = socText(body.name, 40), area = socText(body.area, 40), about = socText(body.about, 240);
  if (name === null || area === null || about === null) return { error: 'Let’s keep it clean for the clubhouse. Please check the wording.' };
  if (!name || name.length < 3) return { error: 'Give your society a name (at least 3 letters).' };
  const pay = String(body.pay || '').trim();
  if (pay && !PAY_RX.test(pay)) return { error: 'The payment link must be your own PayPal.me, Monzo.me or Revolut.me link.' };
  const county = socText(body.county, 40);
  const paynote = socText(body.paynote, 140);
  if (paynote === null) return { error: 'Let’s keep it clean for the clubhouse. Please check the wording.' };
  const cname = socText(body.cname, 60), ctown = socText(body.ctown, 40), cost = socText(body.cost, 24);
  if (cname === null || ctown === null || cost === null) return { error: 'Let’s keep it clean for the clubhouse. Please check the wording.' };
  const course = ACE_COURSE_RX.test(String(body.course || '')) ? String(body.course) : '';
  const lat = Number(body.lat), lon = Number(body.lon), placed = course && lat >= 49 && lat <= 61.5 && lon >= -9 && lon <= 2.5;
  return { name, area: area || '', about: about || '', pay, paynote: paynote || '', open: body.open ? 1 : 0, county: county || '',
    course: placed ? course : '', cname: placed ? cname || '' : '', ctown: placed ? ctown || '' : '', lat: placed ? Math.round(lat * 1e4) / 1e4 : null, lon: placed ? Math.round(lon * 1e4) / 1e4 : null,
    days: ['sat', 'sun', 'wkend', 'wkday', 'mix'].includes(body.days) ? body.days : '', ability: ['all', 'beg', 'hcp'].includes(body.ability) ? body.ability : '', cost: cost || '' };
}
async function hqExtras(env, id, f) {
  await env.DEMAND.prepare('UPDATE soc_socs SET course = ?, cname = ?, ctown = ?, lat = ?, lon = ?, days = ?, ability = ?, cost = ?, paynote = ? WHERE id = ?')
    .bind(f.course, f.cname, f.ctown, f.lat, f.lon, f.days, f.ability, f.cost, f.paynote || '', id).run();
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
    env.DEMAND.prepare('DELETE FROM soc_kitty WHERE soc IN (SELECT id FROM soc_socs WHERE updated < ?)').bind(stale),
    env.DEMAND.prepare('DELETE FROM soc_socs WHERE updated < ?').bind(stale),
  ]);
  const day = hqDay();
  for (let i = 0; i < 5; i++) {
    const id = socCode(8);
    const r = await env.DEMAND.prepare('INSERT OR IGNORE INTO soc_socs (id, pid, name, area, about, pay, open, created, updated, county) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, pid, f.name, f.area, f.about, f.pay, f.open, day, day, f.county).run();
    if (r.meta && r.meta.changes) {
      await hqExtras(env, id, f);
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
  if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can change the society.' }, 403, cors);
  const f = hqFields(body);
  if (f.error) return json({ ok: false, error: f.error }, 400, cors);
  await env.DEMAND.prepare('UPDATE soc_socs SET name = ?, area = ?, about = ?, pay = ?, open = ?, county = ?, updated = ? WHERE id = ?').bind(f.name, f.area, f.about, f.pay, f.open, f.county, hqDay(), s.id).run();
  await hqExtras(env, s.id, f);
  return json({ ok: true }, 200, cors);
}
async function hqGet(env, id, pid, cors) {
  const s = await hqSoc(env, id);
  if (!s) return json({ ok: false, error: 'We couldn’t find that society. Ask the organiser for a fresh link.' }, 404, cors);
  const members = (await env.DEMAND.prepare('SELECT pid, mkey, nick, joined FROM soc_members WHERE soc = ? ORDER BY joined, nick').bind(s.id).all()).results || [];
  const me = members.find((m) => pid && m.pid === pid);
  const organiser = socOrg(s, pid);
  const founding = (await env.DEMAND.prepare('SELECT n FROM soc_founding WHERE soc = ?').bind(s.id).first('n')) || 0;
  const coM = s.co ? members.find((m) => m.pid === s.co) : null;
  const base = { ok: true, id: s.id, name: s.name, area: s.area, county: s.county || '', about: s.about, open: !!s.open, count: members.length, founding, organiser, member: !!me,
    lead: !!pid && pid === s.pid, co: !!pid && !!s.co && pid === s.co, coNick: organiser && coM ? coM.nick : null, coKey: organiser && coM ? coM.mkey : null,
    course: s.course || '', cname: s.cname || '', ctown: s.ctown || '', lat: s.lat, lon: s.lon, days: s.days || '', ability: s.ability || '', cost: s.cost || '' };
  if (!me) return json(base, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const events = (await env.DEMAND.prepare('SELECT * FROM soc_events WHERE soc = ? AND day >= ? ORDER BY day').bind(s.id, since).all()).results || [];
  const ids = events.map((e) => e.id);
  let entries = [];
  if (ids.length) entries = (await env.DEMAND.prepare(`SELECT * FROM soc_entries WHERE event IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results || [];
  const nickOf = {}; members.forEach((m) => { nickOf[m.mkey] = m.nick; });
  const reported = {};
  if (ids.length) (((await env.DEMAND.prepare(`SELECT event FROM soc_reports WHERE event IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results) || []).forEach((r) => { reported[r.event] = 1; });
  const live = {};
  if (ids.length) try { (((await env.DEMAND.prepare(`SELECT event, code, status FROM sc_rounds WHERE event IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results) || []).forEach((r) => { live[r.event] = { code: r.code, status: r.status }; }); } catch (e) { /* no live rounds yet */ }
  const requests = organiser ? ((await env.DEMAND.prepare("SELECT id, nick, note, event, at FROM soc_requests WHERE soc = ? AND status = 'new' ORDER BY at").bind(s.id).all()).results || []) : [];
  let pollList = [];
  try {
    const ps = (await env.DEMAND.prepare('SELECT id, kind, q, closes, status, winner FROM pl_polls WHERE soc = ? ORDER BY created DESC LIMIT 6').bind(s.id).all()).results || [];
    for (const p of ps) {
      const n = await env.DEMAND.prepare('SELECT COUNT(DISTINCT voter) AS n FROM pl_votes WHERE poll = ?').bind(p.id).first('n');
      const mine = await env.DEMAND.prepare('SELECT 1 AS y FROM pl_votes WHERE poll = ? AND voter = ? LIMIT 1').bind(p.id, me.mkey).first('y');
      const win = p.winner ? await env.DEMAND.prepare('SELECT label, day FROM pl_options WHERE poll = ? AND oid = ?').bind(p.id, p.winner).first() : null;
      pollList.push({ id: p.id, kind: p.kind, q: p.q, closes: p.closes, closed: plClosed(p), votes: n || 0, voted: !!mine, winner: win });
    }
  } catch (e) { /* no polls yet */ }
  // The season kitty: the organisers see everyone's lines, a member only their own.
  const kq = organiser
    ? env.DEMAND.prepare('SELECT id, mkey, amount, note, event, kind, at FROM soc_kitty WHERE soc = ? ORDER BY at DESC LIMIT 400').bind(s.id)
    : env.DEMAND.prepare('SELECT id, mkey, amount, note, event, kind, at FROM soc_kitty WHERE soc = ? AND mkey = ? ORDER BY at DESC LIMIT 100').bind(s.id, me.mkey);
  const kitty = ((await kq.all()).results || []).filter((k) => nickOf[k.mkey]).map((k) => ({ id: k.id, m: k.mkey, nick: nickOf[k.mkey], amount: k.amount, note: k.note, event: k.event || '', kind: k.kind, at: k.at }));
  const out = Object.assign(base, {
    you: me.mkey, pay: s.pay, paynote: s.paynote || '', requests, polls: pollList, kitty,
    members: members.map((m) => ({ m: m.mkey, nick: m.nick, organiser: m.pid === s.pid, co: !!s.co && m.pid === s.co })),
    events: events.map((e) => ({ id: e.id, title: e.title, venue: e.venue, day: e.day, tee: e.tee, entry: e.entry, cap: e.cap, deadline: e.deadline, notes: e.notes, report: !!reported[e.id], live: live[e.id] || null, spare: e.spare || 0, droprule: e.droprule ? 1 : 0,
      // claim: the date a member tapped "I've paid" ('no' = the organiser couldn't find it); only they and the organisers see it.
      entries: entries.filter((x) => x.event === e.id && nickOf[x.mkey]).map((x) => ({ m: x.mkey, nick: nickOf[x.mkey], status: x.status, paid: !!x.paid, at: x.at,
        claim: (organiser || x.mkey === me.mkey) ? (x.claim || '') : '', via: x.via || '' })) })),
  });
  return json(out, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}
/* Society Par Price leagues. Every Society HQ society has its own Par Price
   table, worked out from its members' rounds (members already have a player
   id, so nobody joins anything new). A member's week = their best SPP_BEST
   rounds, Monday to Sunday; a round they can no longer play counts +MISSED.
   Society v Society = the average week of each society's best SPP_TEAM
   members (at least SPP_TEAM must have played), like the National Society
   League's best four. The organiser can switch either off. */
const SPP_BEST = 5, SPP_TEAM = 4;
let sppReady = false;
async function sppSetup(env) {
  if (sppReady) return;
  await ppSetup(env);
  await env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS soc_pp (soc TEXT PRIMARY KEY, off INTEGER DEFAULT 0, solo INTEGER DEFAULT 0, updated TEXT) WITHOUT ROWID').run();
  sppReady = true;
}
// One member's week from their round totals; `upto` = the last round number that has happened.
function sppWeek(totals, monday, upto, playedUpto) {
  const best = totals.slice().sort((a, b) => a - b).slice(0, SPP_BEST);
  const finished = upto < ppToday();
  const left = finished ? 0 : Math.max(0, (monday + 6) - upto) + (playedUpto ? 0 : 1); // rounds still to come
  const short = Math.max(0, SPP_BEST - totals.length - left);
  return best.reduce((t, x) => t + x, 0) + MISSED * short;
}
// Every society's table for the week starting `monday` (round numbers), as of round `upto`.
async function sppTables(env, socIds, monday, upto) {
  const q = socIds ? `AND m.soc IN (${socIds.map(() => '?').join(',')})` : '';
  const rows = (await env.DEMAND.prepare(`SELECT m.soc, m.pid, m.nick, s.n, s.total FROM soc_members m JOIN pp_scores s ON s.pid = m.pid WHERE s.n >= ? AND s.n <= ? ${q}`)
    .bind(monday, upto, ...(socIds || [])).all()).results || [];
  const out = {};
  rows.forEach((r) => {
    const t = (out[r.soc] = out[r.soc] || {});
    const p = (t[r.pid] = t[r.pid] || { nick: r.nick, totals: [], last: null });
    p.totals.push(r.total);
    if (r.n === upto) p.last = r.total;
  });
  Object.keys(out).forEach((soc) => {
    out[soc] = Object.entries(out[soc]).map(([pid, p]) => ({ pid, nick: p.nick, rounds: p.totals.length, best: Math.min(...p.totals), today: p.last,
      week: sppWeek(p.totals, monday, upto, p.last !== null) })).sort((a, b) => a.week - b.week || b.rounds - a.rounds || a.nick.localeCompare(b.nick));
  });
  return out;
}
function sppTeam(table) {
  if (!table || table.length < SPP_TEAM) return null;
  return Math.round(table.slice(0, SPP_TEAM).reduce((t, p) => t + p.week, 0) / SPP_TEAM * 100) / 100;
}
// The national table: every society that's in, ranked by its best-four average.
async function sppRank(env, monday, upto) {
  const flags = {};
  (((await env.DEMAND.prepare('SELECT soc, off, solo FROM soc_pp').all()).results) || []).forEach((r) => { flags[r.soc] = r; });
  const tables = await sppTables(env, null, monday, upto);
  const ids = Object.keys(tables).filter((id) => !(flags[id] && (flags[id].off || flags[id].solo)) && sppTeam(tables[id]) !== null);
  const names = {};
  if (ids.length) (((await env.DEMAND.prepare(`SELECT id, name, area FROM soc_socs WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results) || []).forEach((r) => { names[r.id] = r; });
  const list = ids.filter((id) => names[id]).map((id) => ({ id, name: names[id].name, area: names[id].area || '', avg: sppTeam(tables[id]), played: tables[id].length }))
    .sort((a, b) => a.avg - b.avg || b.played - a.played || a.name.localeCompare(b.name));
  list.forEach((x, i) => { x.pos = i && list[i - 1].avg === x.avg ? list[i - 1].pos : i + 1; });
  return list;
}
async function sppGet(env, id, pid, cors) {
  await sppSetup(env);
  const s = await hqSoc(env, id);
  if (!s || !pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const me = await env.DEMAND.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, pid).first('mkey');
  if (!me) return json({ ok: false, error: 'Members only.' }, 403, cors);
  const f = (await env.DEMAND.prepare('SELECT off, solo FROM soc_pp WHERE soc = ?').bind(s.id).first()) || { off: 0, solo: 0 };
  const organiser = socOrg(s, pid);
  const base = { ok: true, on: !f.off, national: !f.off && !f.solo, organiser, best: SPP_BEST, team: SPP_TEAM, missed: MISSED };
  if (f.off) return json(base, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  const today = ppToday(), monday = ppMonday(today);
  const count = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM soc_members WHERE soc = ?').bind(s.id).first('c');
  const mine = (await sppTables(env, [s.id], monday, today))[s.id] || [];
  const lastT = (await sppTables(env, [s.id], monday - 7, monday - 1))[s.id] || [];
  const strip = (t) => t.map((p) => ({ nick: p.nick, rounds: p.rounds, best: p.best, week: p.week, today: p.today, you: p.pid === pid }));
  const out = Object.assign(base, { n: today, monday, daysLeft: monday + 6 - today, count, table: strip(mine), last: strip(lastT).slice(0, 12), lastCount: lastT.length });
  // Who hasn't played this week: only the organiser sees it (for the nudge).
  if (organiser) {
    const all = (((await env.DEMAND.prepare('SELECT pid, nick FROM soc_members WHERE soc = ?').bind(s.id).all()).results) || []);
    const played = new Set(mine.map((p) => p.pid));
    out.waiting = all.filter((m) => !played.has(m.pid)).map((m) => m.nick);
  }
  if (!f.solo) {
    try {
      const nat = await sppRank(env, monday, today);
      const pos = nat.find((x) => x.id === s.id);
      out.rank = { of: nat.length, pos: pos ? pos.pos : null, avg: pos ? pos.avg : sppTeam(mine), need: Math.max(0, SPP_TEAM - mine.length) };
      const natLast = await sppRank(env, monday - 7, monday - 1);
      const pl = natLast.find((x) => x.id === s.id);
      out.lastRank = pl ? { pos: pl.pos, of: natLast.length } : null;
    } catch (e) { /* no national table this time */ }
  }
  return json(out, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}
async function sppNational(env, cors) {
  await sppSetup(env);
  const today = ppToday(), monday = ppMonday(today);
  const strip = (l) => l.slice(0, 100).map(({ id, ...x }) => x);
  const now = await sppRank(env, monday, today), last = await sppRank(env, monday - 7, monday - 1);
  return json({ ok: true, n: today, monday, daysLeft: monday + 6 - today, team: SPP_TEAM, table: strip(now), last: strip(last).slice(0, 10) }, 200,
    Object.assign({ 'cache-control': 'public, max-age=300' }, cors));
}
async function sppSet(env, body, pid, cors) {
  await sppSetup(env);
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can change this.' }, 403, cors);
  await env.DEMAND.prepare('INSERT INTO soc_pp (soc, off, solo, updated) VALUES (?, ?, ?, ?) ON CONFLICT (soc) DO UPDATE SET off = excluded.off, solo = excluded.solo, updated = excluded.updated')
    .bind(s.id, body.on === false ? 1 : 0, body.national === false ? 1 : 0, hqDay()).run();
  return json({ ok: true, on: body.on !== false, national: body.on !== false && body.national !== false }, 200, cors);
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
  if (s.co === pid) await env.DEMAND.prepare('UPDATE soc_socs SET co = NULL WHERE id = ?').bind(s.id).run();
  return json({ ok: true }, 200, cors);
}
async function hqRemove(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can remove members.' }, 403, cors);
  const mk = String(body.m || '');
  const m = await env.DEMAND.prepare('SELECT pid FROM soc_members WHERE soc = ? AND mkey = ?').bind(s.id, mk).first('pid');
  if (!m || m === s.pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  if (m === s.co) await env.DEMAND.prepare('UPDATE soc_socs SET co = NULL WHERE id = ?').bind(s.id).run();
  await env.DEMAND.batch([
    env.DEMAND.prepare('DELETE FROM soc_entries WHERE mkey = ?').bind(mk),
    env.DEMAND.prepare('DELETE FROM soc_kitty WHERE soc = ? AND mkey = ?').bind(s.id, mk),
    env.DEMAND.prepare('DELETE FROM soc_members WHERE soc = ? AND mkey = ?').bind(s.id, mk),
  ]);
  return json({ ok: true }, 200, cors);
}
/* Co-organiser: the organiser picks a member who can run the society with
   them. If the organiser loses their phone and their Clubhouse key, the
   co-organiser sends them a one-time hand-back link (24 hours) that moves the
   organiser role, with their member place, entries and paid ticks, to the new
   phone. The co-organiser can't use the link themselves. */
async function hqCoOrg(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !pid || s.pid !== pid) return json({ ok: false, error: 'Only the organiser can pick a co-organiser.' }, 403, cors);
  const mk = String(body.m || '');
  if (!mk) { await env.DEMAND.prepare('UPDATE soc_socs SET co = NULL WHERE id = ?').bind(s.id).run(); return json({ ok: true }, 200, cors); }
  const m = await env.DEMAND.prepare('SELECT pid FROM soc_members WHERE soc = ? AND mkey = ?').bind(s.id, mk).first('pid');
  if (!m || m === s.pid) return json({ ok: false, error: 'Pick another member of the society.' }, 400, cors);
  await env.DEMAND.prepare('UPDATE soc_socs SET co = ? WHERE id = ?').bind(m, s.id).run();
  await hqTouch(env, s.id);
  return json({ ok: true }, 200, cors);
}
async function hqHandback(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !pid || !s.co || s.co !== pid) return json({ ok: false, error: 'Only the co-organiser can send a hand-back link.' }, 403, cors);
  const now = Date.now();
  await env.DEMAND.prepare('DELETE FROM soc_handback WHERE exp < ? OR soc = ?').bind(now, s.id).run();
  const token = socCode(16);
  await env.DEMAND.prepare('INSERT INTO soc_handback (token, soc, exp) VALUES (?, ?, ?)').bind(token, s.id, now + 24 * 3600 * 1000).run();
  return json({ ok: true, token, name: s.name }, 200, cors);
}
async function hqClaim(env, body, pid, request, cors) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (await tooMany('handback-' + ip, 10, 600)) return json({ ok: false, error: 'Too many tries. Please wait ten minutes.' }, 429, cors);
  const token = String(body.t || '');
  if (!pid || !/^[a-z0-9]{16}$/.test(token)) return json({ ok: false, error: 'That link doesn’t look right. Ask your co-organiser for a fresh one.' }, 400, cors);
  const row = await env.DEMAND.prepare('SELECT soc FROM soc_handback WHERE token = ? AND exp >= ?').bind(token, Date.now()).first();
  if (!row) return json({ ok: false, error: 'That link has run out or been used. Ask your co-organiser for a fresh one.' }, 404, cors);
  const s = await hqSoc(env, row.soc);
  if (!s) return json({ ok: false, error: 'We couldn’t find that society.' }, 404, cors);
  if (pid === s.co) return json({ ok: false, error: 'This link is for the organiser’s new phone. Send it to them on WhatsApp.' }, 400, cors);
  const db = env.DEMAND, old = s.pid;
  if (pid !== old) {
    const mine = await db.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, pid).first('mkey');
    const steps = [];
    // Rejoined as a member on the new phone already? That place goes; the organiser's own comes back.
    if (mine) steps.push(db.prepare('DELETE FROM soc_entries WHERE mkey = ?').bind(mine), db.prepare('DELETE FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, pid));
    steps.push(db.prepare('UPDATE soc_members SET pid = ? WHERE soc = ? AND pid = ?').bind(pid, s.id, old),
      db.prepare('UPDATE soc_socs SET pid = ?, updated = ? WHERE id = ?').bind(pid, hqDay(), s.id));
    await db.batch(steps);
  }
  await db.prepare('DELETE FROM soc_handback WHERE token = ?').bind(token).run();
  return json({ ok: true, id: s.id, name: s.name }, 200, cors);
}
async function hqEvent(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can change the fixtures.' }, 403, cors);
  const eid = String(body.e || '');
  if (body.del) {
    if (!SOC_RX.test(eid)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await env.DEMAND.batch([
      env.DEMAND.prepare('DELETE FROM soc_entries WHERE event = ?').bind(eid),
      // Drop-out charges and credits for a deleted fixture go too; credit already used stays.
      env.DEMAND.prepare("DELETE FROM soc_kitty WHERE soc = ? AND event = ? AND kind IN ('drop', 'held', 'filled', 'refund', 'used')").bind(s.id, eid),
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
  const spare = Math.round(Math.min(12, Math.max(0, Number(body.spare) || 0)));
  const droprule = body.droprule && deadline && entry > 0 ? 1 : 0;
  if (eid) {
    if (!SOC_RX.test(eid)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await env.DEMAND.prepare('UPDATE soc_events SET title = ?, venue = ?, day = ?, tee = ?, entry = ?, cap = ?, deadline = ?, notes = ?, spare = ?, droprule = ? WHERE id = ? AND soc = ?').bind(title, venue || '', day, tee, entry, cap, deadline, notes || '', spare, droprule, eid, s.id).run();
    await hqTouch(env, s.id);
    return json({ ok: true, id: eid }, 200, cors);
  }
  const n = await env.DEMAND.prepare('SELECT COUNT(*) AS c FROM soc_events WHERE soc = ? AND day >= ?').bind(s.id, hqDay()).first('c');
  if (n >= 30) return json({ ok: false, error: 'Thirty fixtures ahead is plenty.' }, 400, cors);
  const id = socCode(8);
  await env.DEMAND.prepare('INSERT INTO soc_events (id, soc, title, venue, day, tee, entry, cap, deadline, notes, created, spare, droprule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, s.id, title, venue || '', day, tee, entry, cap, deadline, notes || '', hqDay(), spare, droprule).run();
  await hqTouch(env, s.id);
  return json({ ok: true, id }, 200, cors);
}
async function hqEventFor(env, eid, pid) {
  if (!SOC_RX.test(eid) || !pid) return null;
  const e = await env.DEMAND.prepare('SELECT e.*, s.pid AS org, s.co AS co FROM soc_events e JOIN soc_socs s ON s.id = e.soc WHERE e.id = ?').bind(eid).first();
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
    if (!evOrg(e, pid)) return json({ ok: false, error: 'Only the organiser can change someone else.' }, 403, cors);
    const ok = await env.DEMAND.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND mkey = ?').bind(e.soc, String(body.m)).first('mkey');
    if (!ok) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    who = ok;
  }
  const db = env.DEMAND;
  const before = await db.prepare('SELECT status, paid FROM soc_entries WHERE event = ? AND mkey = ?').bind(e.id, who).first();
  let final = status;
  if (status === 'in' && e.cap > 0 && !(before && before.status === 'in')) {
    const ins = await db.prepare("SELECT COUNT(*) AS c FROM soc_entries WHERE event = ? AND status = 'in' AND mkey != ?").bind(e.id, who).first('c');
    if (ins >= e.cap) final = 'wait';
  }
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO soc_entries (event, mkey, status, paid, at) VALUES (?, ?, ?, 0, ?) ON CONFLICT (event, mkey) DO UPDATE SET status = excluded.status, at = CASE WHEN soc_entries.status = excluded.status THEN soc_entries.at ELSE excluded.at END').bind(e.id, who, final, now).run();
  // Money Sorted's drop-out rule: after the club's final-numbers date, a player who
  // drops out still owes their entry unless someone takes their place.
  const rule = !!(e.droprule && e.entry > 0 && e.deadline && hqDay() > e.deadline && e.day >= hqDay());
  let promoted = null, dropped = false;
  if (before && before.status === 'in' && final !== 'in') {
    // Someone dropped out: the first on the waiting list moves up.
    if (e.cap > 0) {
      const ins = await db.prepare("SELECT COUNT(*) AS c FROM soc_entries WHERE event = ? AND status = 'in'").bind(e.id).first('c');
      if (ins < e.cap) {
        promoted = await db.prepare("SELECT mkey FROM soc_entries WHERE event = ? AND status = 'wait' ORDER BY at LIMIT 1").bind(e.id).first('mkey');
        if (promoted) await db.prepare("UPDATE soc_entries SET status = 'in', at = ? WHERE event = ? AND mkey = ?").bind(now, e.id, promoted).run();
      }
    }
    if (rule) {
      dropped = true;
      if (promoted) {
        // Place filled straight away: nothing owed, and a paid entry comes back as credit.
        if (before.paid) await hqKittyAdd(db, e.soc, who, e.entry, 'Place filled after you dropped out: your entry back as credit', e.id, 'refund');
      } else {
        await hqKittyAdd(db, e.soc, who, before.paid ? 0 : -e.entry, before.paid ? 'Dropped out after numbers went in (already paid)' : 'Dropped out after numbers went in', e.id, before.paid ? 'held' : 'drop');
      }
    }
  } else if (final === 'in' && !(before && before.status === 'in')) {
    // Back in? Their own drop-out line goes. Someone new? They fill the oldest open place.
    const mine = await db.prepare("SELECT id FROM soc_kitty WHERE soc = ? AND event = ? AND mkey = ? AND kind IN ('drop', 'held')").bind(e.soc, e.id, who).first('id');
    if (mine) await db.prepare('DELETE FROM soc_kitty WHERE id = ?').bind(mine).run();
    else await hqFillPlace(db, e, who);
  }
  await hqTouch(env, e.soc);
  return json({ ok: true, status: final, promoted: !!promoted, dropped }, 200, cors);
}
// A new player takes a place someone dropped: their charge is cleared, or a paid entry comes back as credit.
async function hqFillPlace(db, e, filler) {
  const open = await db.prepare("SELECT id, mkey, kind FROM soc_kitty WHERE soc = ? AND event = ? AND kind IN ('drop', 'held') AND mkey != ? ORDER BY at LIMIT 1").bind(e.soc, e.id, filler).first();
  if (!open) return;
  if (open.kind === 'held') await db.prepare("UPDATE soc_kitty SET kind = 'refund', amount = ?, note = ? WHERE id = ?").bind(e.entry, 'Place filled after you dropped out: your entry back as credit', open.id).run();
  else await db.prepare("UPDATE soc_kitty SET kind = 'filled', amount = 0, note = ? WHERE id = ?").bind('Dropped out, but the place was filled: nothing owed', open.id).run();
}
async function hqKittyAdd(db, soc, mkey, amount, note, event, kind) {
  await db.prepare('INSERT INTO soc_kitty (id, soc, mkey, amount, note, event, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(socCode(10), soc, mkey, Math.round(Number(amount) * 100) / 100, String(note).slice(0, 120), event || '', kind, new Date().toISOString()).run();
}
async function hqBalance(db, soc, mkey) {
  return Math.round(((await db.prepare('SELECT SUM(amount) AS b FROM soc_kitty WHERE soc = ? AND mkey = ?').bind(soc, mkey).first('b')) || 0) * 100) / 100;
}
async function hqPaid(env, body, pid, cors) {
  const e = await hqEventFor(env, String(body.e || ''), pid);
  if (!e || !evOrg(e, pid)) return json({ ok: false, error: 'Only the organiser can tick who’s paid.' }, 403, cors);
  const db = env.DEMAND, mk = String(body.m || '');
  const ok = await db.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND mkey = ?').bind(e.soc, mk).first('mkey');
  if (!ok) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  const row = await db.prepare('SELECT status, paid, via FROM soc_entries WHERE event = ? AND mkey = ?').bind(e.id, mk).first();
  // "Not arrived yet": the organiser couldn't find an "I've paid" payment; the member sees it and can try again.
  if (body.reject) {
    await db.prepare("UPDATE soc_entries SET claim = 'no' WHERE event = ? AND mkey = ? AND paid = 0").bind(e.id, mk).run();
    return json({ ok: true }, 200, cors);
  }
  // Paid but not playing (dropped out before numbers went in): their entry becomes credit in the kitty.
  if (body.credit) {
    if (!row || !row.paid || row.status === 'in' || !(e.entry > 0)) return json({ ok: false, error: 'Only for someone who paid and isn’t playing.' }, 400, cors);
    if (row.via === 'kitty') await db.prepare("DELETE FROM soc_kitty WHERE soc = ? AND mkey = ? AND event = ? AND kind = 'used'").bind(e.soc, mk, e.id).run();
    else await hqKittyAdd(db, e.soc, mk, e.entry, 'Entry back as credit: ' + (e.title || 'golf day'), e.id, 'refund');
    await db.prepare("DELETE FROM soc_kitty WHERE soc = ? AND mkey = ? AND event = ? AND kind = 'held'").bind(e.soc, mk, e.id).run();
    await db.prepare("UPDATE soc_entries SET paid = 0, via = '', claim = NULL WHERE event = ? AND mkey = ?").bind(e.id, mk).run();
    return json({ ok: true }, 200, cors);
  }
  let via = '';
  if (body.paid && body.kitty) {
    // Paid from the season kitty: only with enough credit, and it shows as a line in their kitty.
    if (!(e.entry > 0)) return json({ ok: false, error: 'This day has no entry fee to pay.' }, 400, cors);
    if (row && row.paid) return json({ ok: true }, 200, cors);
    if (await hqBalance(db, e.soc, mk) < e.entry) return json({ ok: false, error: 'Not enough credit in their kitty for this one.' }, 400, cors);
    await hqKittyAdd(db, e.soc, mk, -e.entry, 'Paid from credit: ' + (e.title || 'golf day'), e.id, 'used');
    via = 'kitty';
  }
  if (!body.paid && row && row.via === 'kitty') await db.prepare("DELETE FROM soc_kitty WHERE soc = ? AND mkey = ? AND event = ? AND kind = 'used'").bind(e.soc, mk, e.id).run();
  if (row) await db.prepare('UPDATE soc_entries SET paid = ?, via = ?, claim = NULL WHERE event = ? AND mkey = ?').bind(body.paid ? 1 : 0, via, e.id, mk).run();
  else await db.prepare("INSERT INTO soc_entries (event, mkey, status, paid, at, via) VALUES (?, ?, 'in', ?, ?, ?)").bind(e.id, mk, body.paid ? 1 : 0, new Date().toISOString(), via).run();
  // A drop-out who'd been charged and then pays: the charge is settled by the payment.
  if (body.paid && row && row.status !== 'in') {
    const drop = await db.prepare("SELECT id FROM soc_kitty WHERE soc = ? AND mkey = ? AND event = ? AND kind = 'drop'").bind(e.soc, mk, e.id).first('id');
    if (drop) await db.prepare("UPDATE soc_kitty SET kind = 'held', amount = 0, note = 'Dropped out after numbers went in (paid)' WHERE id = ?").bind(drop).run();
  }
  return json({ ok: true }, 200, cors);
}
// A member taps "I've paid" (or takes it back); the organiser then confirms with one tap.
async function hqIPaid(env, body, pid, cors) {
  const e = await hqEventFor(env, String(body.e || ''), pid);
  if (!e) return json({ ok: false, error: 'Join the society first.' }, 403, cors);
  const r = await env.DEMAND.prepare('UPDATE soc_entries SET claim = ? WHERE event = ? AND mkey = ? AND paid = 0').bind(body.on ? hqDay() : null, e.id, e.me).run();
  if (!(r.meta && r.meta.changes)) return json({ ok: false, error: 'Put yourself down as in first.' }, 400, cors);
  return json({ ok: true }, 200, cors);
}
/* The season kitty: a running balance per member, kept by the organisers.
   Positive = credit the society holds for them; negative = what they owe.
   GolfPrice AI never holds any money: this is the organiser's record only.
   body: { s, m | all, amount (+ credit / - owes), note } · { s, settle: m } · { s, del: id } */
async function hqKitty(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can change the kitty.' }, 403, cors);
  const db = env.DEMAND;
  if (body.del) {
    const r = await db.prepare("DELETE FROM soc_kitty WHERE id = ? AND soc = ? AND kind IN ('manual', 'settle')").bind(String(body.del), s.id).run();
    if (!(r.meta && r.meta.changes)) return json({ ok: false, error: 'That line can’t be removed here. Lines from a golf day change with the day itself.' }, 400, cors);
    return json({ ok: true }, 200, cors);
  }
  if (body.settle) {
    const mk = String(body.settle);
    if (!await db.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND mkey = ?').bind(s.id, mk).first('mkey')) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const b = await hqBalance(db, s.id, mk);
    if (!b) return json({ ok: true }, 200, cors);
    await hqKittyAdd(db, s.id, mk, -b, b > 0 ? 'Paid back' : 'Paid what they owed', '', 'settle');
    await hqTouch(env, s.id);
    return json({ ok: true }, 200, cors);
  }
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!amount || !isFinite(amount) || Math.abs(amount) > 2000) return json({ ok: false, error: 'Enter an amount up to £2,000.' }, 400, cors);
  const note = socText(body.note, 60);
  if (note === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Please check the wording.' }, 400, cors);
  if (!note) return json({ ok: false, error: 'Add a short note, e.g. Season subs 2027.' }, 400, cors);
  let who = [];
  if (body.all) who = ((await db.prepare('SELECT mkey FROM soc_members WHERE soc = ?').bind(s.id).all()).results || []).map((m) => m.mkey);
  else {
    const mk = await db.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND mkey = ?').bind(s.id, String(body.m || '')).first('mkey');
    if (mk) who = [mk];
  }
  if (!who.length) return json({ ok: false, error: 'Pick a member.' }, 400, cors);
  const n = await db.prepare('SELECT COUNT(*) AS c FROM soc_kitty WHERE soc = ?').bind(s.id).first('c');
  if (n + who.length > 3000) return json({ ok: false, error: 'The kitty is full. Settle a few lines first.' }, 400, cors);
  const now = new Date().toISOString();
  await db.batch(who.map((mk) => db.prepare('INSERT INTO soc_kitty (id, soc, mkey, amount, note, event, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(socCode(10), s.id, mk, amount, note, '', 'manual', now)));
  await hqTouch(env, s.id);
  return json({ ok: true, n: who.length }, 200, cors);
}
/* ---- The Form Guide: a preview before each society day and a report after it.
     soc_results  event, mkey, pts (stableford points; -1 = no return), back (back-nine points, for countback)
     soc_reports  event, extras (nearest the pin, longest drive, the organiser's line, wooden spoon on/off),
                  prize (a Prize Picker link for the winner, organiser only), published
   The organiser enters the scores in Society HQ; the preview and report
   (golfpriceai.com/societies/form-guide/?e=<event>) are open to anyone with
   the link, nicknames and points only, so they can go in the group chat. */
const FG_OOM = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
function fgNum(n) { return ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n); }
function fgCap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
function fgOrd(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function fgRank(rows) {
  const ok = rows.filter((r) => r.pts >= 0).sort((a, b) => b.pts - a.pts || (b.back || 0) - (a.back || 0));
  ok.forEach((r, i) => {
    const prev = ok[i - 1];
    r.pos = prev && prev.pts === r.pts && (prev.back || 0) === (r.back || 0) ? prev.pos : i + 1;
    r.cb = !!((prev && prev.pts === r.pts) || (ok[i + 1] && ok[i + 1].pts === r.pts)) && r.back != null;
  });
  return ok.concat(rows.filter((r) => r.pts < 0).map((r) => Object.assign(r, { pos: null, nr: true })));
}
function fgPick(seed, list) { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return list[h % list.length]; }
async function fgHistory(env, soc) {
  // Every result this society has published in the last 400 days, oldest first.
  const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const evs = (await env.DEMAND.prepare('SELECT e.id, e.title, e.venue, e.day FROM soc_events e JOIN soc_reports r ON r.event = e.id WHERE e.soc = ? AND e.day >= ? ORDER BY e.day').bind(soc, since).all()).results || [];
  const res = evs.length ? (await env.DEMAND.prepare(`SELECT event, mkey, pts, back FROM soc_results WHERE event IN (${evs.map(() => '?').join(',')})`).bind(...evs.map((e) => e.id)).all()).results || [] : [];
  return evs.map((e) => Object.assign(e, { rows: fgRank(res.filter((r) => r.event === e.id).map((r) => ({ m: r.mkey, pts: Number(r.pts), back: r.back == null ? null : Number(r.back) }))) }));
}
async function fgGet(env, eid, pid, cors) {
  if (!SOC_RX.test(eid)) return json({ ok: false, error: 'That link doesn’t look right.' }, 400, cors);
  const db = env.DEMAND;
  const e = await db.prepare('SELECT e.*, s.name AS sname, s.pid AS org, s.co AS co FROM soc_events e JOIN soc_socs s ON s.id = e.soc WHERE e.id = ?').bind(eid).first();
  if (!e) return json({ ok: false, error: 'We couldn’t find that society day. Ask the organiser for a fresh link.' }, 404, cors);
  const members = (await db.prepare('SELECT pid, mkey, nick FROM soc_members WHERE soc = ?').bind(e.soc).all()).results || [];
  const nick = {}; members.forEach((m) => { nick[m.mkey] = m.nick; });
  const mine = pid ? members.find((m) => m.pid === pid) : null;
  const hist = await fgHistory(env, e.soc);
  const report = await db.prepare('SELECT extras, prize, published FROM soc_reports WHERE event = ?').bind(eid).first();
  const before = hist.filter((h) => h.day < e.day || (h.day === e.day && h.id !== eid && !report));
  const prior = report ? hist.filter((h) => h.id !== eid && h.day <= e.day) : before;
  // Each golfer's record before this day: finishes, newest first.
  const rec = {};
  prior.slice().reverse().forEach((h) => h.rows.forEach((r) => {
    const x = rec[r.m] || (rec[r.m] = { fin: [], wins: 0, top6: 0, venue: [] });
    x.fin.push(r.nr ? 'NR' : r.pos);
    if (r.pos === 1) x.wins++;
    if (r.pos && r.pos <= 6) x.top6++;
    if (e.venue && h.venue && h.venue.toLowerCase() === e.venue.toLowerCase() && r.pos) x.venue.push(r.pos);
  }));
  const formOf = (m) => (rec[m] ? rec[m].fin.slice(0, 3) : []);
  const season = e.day.slice(0, 4);
  const oomRows = {};
  hist.filter((h) => h.day.slice(0, 4) === season && (report || h.id !== eid)).forEach((h) => h.rows.forEach((r) => {
    if (!nick[r.m]) return;
    const o = oomRows[r.m] || (oomRows[r.m] = { nick: nick[r.m], pts: 0, played: 0, wins: 0 });
    o.played++; if (r.pos && r.pos <= FG_OOM.length) o.pts += FG_OOM[r.pos - 1]; if (r.pos === 1) o.wins++;
  }));
  const oom = Object.values(oomRows).sort((a, b) => b.pts - a.pts || b.wins - a.wins).slice(0, 10);
  const base = { ok: true, id: eid, soc: { id: e.soc, name: e.sname }, title: e.title, venue: e.venue, day: e.day, tee: e.tee,
    organiser: evOrg(e, pid), member: !!mine, season, oom, events: hist.length };
  try { const lg = await db.prepare('SELECT region, division, season FROM lg_entries WHERE soc = ? AND hidden = 0').bind(e.soc).first(); if (lg) base.league = lg; } catch (err) { /* no league yet */ }

  if (!report) {
    const ents = (await db.prepare("SELECT mkey, status, at FROM soc_entries WHERE event = ? AND status IN ('in', 'wait') ORDER BY at").bind(eid).all()).results || [];
    const field = ents.filter((x) => x.status === 'in' && nick[x.mkey]).map((x) => ({ m: x.mkey, nick: nick[x.mkey], form: formOf(x.mkey), played: rec[x.mkey] ? rec[x.mkey].fin.length : 0 }));
    const avg = (l) => { const n = l.filter((v) => typeof v === 'number'); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : 99; };
    const watch = [], used = {};
    const add = (m, tag, line) => { if (m && !used[m]) { used[m] = 1; watch.push({ nick: nick[m], tag, line }); } };
    const inform = field.filter((f) => f.form.filter((v) => typeof v === 'number').length >= 2).sort((a, b) => avg(a.form) - avg(b.form))[0];
    if (inform) add(inform.m, 'In form', (rec[inform.m].fin[0] === 1 ? 'Won last time out. ' : '') + 'Form: ' + inform.form.map((v) => (typeof v === 'number' ? fgOrd(v) : v)).join(' · '));
    const spec = field.filter((f) => rec[f.m] && rec[f.m].venue.length >= 2 && !used[f.m]).sort((a, b) => avg(rec[a.m].venue) - avg(rec[b.m].venue))[0];
    if (spec) { const v = rec[spec.m].venue, w = v.filter((p) => p === 1).length; add(spec.m, 'Course specialist', (w ? (w === 1 ? 'A win here' : fgCap(fgNum(w)) + ' wins here') + ' in ' + fgNum(v.length) + ' visits.' : 'Best finish here: ' + fgOrd(Math.min(...v)) + '.') + ' Knows where the bunkers are. Avoids them, mostly.'); }
    const dark = field.filter((f) => rec[f.m] && !rec[f.m].wins && rec[f.m].fin.slice(0, 5).filter((p) => typeof p === 'number' && p <= 6).length >= 2 && !used[f.m])[0];
    if (dark) add(dark.m, 'Dark horse', fgCap(fgNum(rec[dark.m].fin.slice(0, 5).filter((p) => typeof p === 'number' && p <= 6).length)) + ' top-six finishes, never a win. Surely their turn?');
    const deb = field.filter((f) => !f.played && !used[f.m])[0];
    if (deb && watch.length < 3) add(deb.m, 'On debut', 'First society day with us. No form, no pressure. Well, a bit of pressure.');
    return json(Object.assign(base, { phase: 'preview', field: field.map((f) => ({ nick: f.nick, form: f.form, played: f.played })), waiting: ents.filter((x) => x.status === 'wait').length, watch }), 200, Object.assign({ 'cache-control': 'no-store' }, cors));
  }

  const now = hist.find((h) => h.id === eid);
  const rows = (now ? now.rows : []).filter((r) => nick[r.m]).map((r) => ({ nick: nick[r.m], pos: r.pos, pts: r.pts, back: r.back, nr: !!r.nr, cb: r.cb, me: !!mine && r.m === mine.mkey, m: r.m }));
  const ex = JSON.parse(report.extras || '{}');
  const ok = rows.filter((r) => !r.nr);
  const w = ok[0], r2 = ok[1], r3 = ok[2];
  let headline = '', story = [];
  if (w) {
    const rw = rec[w.m] || { fin: [], wins: 0, top6: 0 };
    headline = !rw.fin.length ? fgPick(eid, [`${w.nick} wins on debut.`, `Debut, and a win. Steady on, ${w.nick}.`])
      : !rw.wins && rw.top6 >= 2 ? `${w.nick} finally does it.`
      : rw.wins ? fgPick(eid, [`${w.nick} does it again.`, `${w.nick} adds another one.`])
      : fgPick(eid, [`${w.nick} takes the ${e.title}.`, `It’s ${w.nick}’s day.`]);
    let s = `${w.nick}’s ${w.pts} points`;
    if (r2) s += r2.pts === w.pts ? ` edged out ${r2.nick} on countback` : r2.pts === w.pts - 1 ? ` pipped ${r2.nick} by a single point` : ` beat ${r2.nick} by ${w.pts - r2.pts} points`;
    if (r3) s += `, with ${r3.nick} ${r3.pts === (r2 ? r2.pts : w.pts) ? 'level on points' : (r2 ? r2.pts : w.pts) - r3.pts === 1 ? 'a point further back' : ((r2 ? r2.pts : w.pts) - r3.pts) + ' points back'} in third`;
    story.push(s + '.');
    if (!rw.fin.length) story.push('Not a bad way to introduce yourself.');
    else if (!rw.wins && rw.top6 >= 2) story.push(`After ${fgNum(rw.top6)} top-six finishes without a win, nobody begrudges this one.`);
    const debs = ok.filter((r) => r !== w && !(rec[r.m] && rec[r.m].fin.length));
    if (debs.length === 1) story.push(`${debs[0].nick} finished ${fgOrd(debs[0].pos)} on debut, which is better than most of us managed on ours.`);
    else if (debs.length > 1) story.push(`${fgCap(fgNum(debs.length))} golfers made their debut. Welcome to the society, and to the banter.`);
    story.push(`${fgCap(fgNum(ok.length))} golfers handed in a card${e.venue ? ' at ' + e.venue : ''}.`);
  }
  const awards = [];
  if (ex.ntp && nick[ex.ntp.m]) awards.push({ t: 'Nearest the pin', who: nick[ex.ntp.m], line: ex.ntp.txt || '' });
  if (ex.ld && nick[ex.ld.m]) awards.push({ t: 'Longest drive', who: nick[ex.ld.m], line: ex.ld.txt || '' });
  const backs = ok.filter((r) => r.back != null);
  if (backs.length >= 3) { const b = backs.slice().sort((a, c) => c.back - a.back)[0]; awards.push({ t: 'Best back nine', who: b.nick, line: b.back + ' points' }); }
  if (ex.spoon && ok.length >= 4) { const l = ok[ok.length - 1]; awards.push({ t: 'Wooden spoon', who: l.nick, line: l.pts + ' points. Better luck next month.', spoon: true }); }
  const out = Object.assign(base, { phase: 'report', published: report.published, headline, story, line: ex.line || '', leaderboard: rows.map((r) => { const o = Object.assign({}, r); delete o.m; return o; }),
    awards, prize: ex.prize || 0, winner: w ? { nick: w.nick, pts: w.pts, first: !(rec[w.m] && rec[w.m].wins), me: w.me } : null });
  if (base.organiser && report.prize) out.prizeUrl = '/societies/prize/?t=' + report.prize;
  return json(out, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}
// The organiser's own copy of the scores, to edit them.
async function fgScores(env, eid, pid, cors) {
  const e = await hqEventFor(env, eid, pid);
  if (!e || !evOrg(e, pid)) return json({ ok: false, error: 'Only the organiser can enter the results.' }, 403, cors);
  const rows = (await env.DEMAND.prepare('SELECT mkey AS m, pts, back FROM soc_results WHERE event = ?').bind(e.id).all()).results || [];
  const rep = await env.DEMAND.prepare('SELECT extras, prize FROM soc_reports WHERE event = ?').bind(e.id).first();
  return json({ ok: true, rows, extras: rep ? JSON.parse(rep.extras || '{}') : null, prize: rep && rep.prize ? '/societies/prize/?t=' + rep.prize : null }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
}
async function fgSave(env, body, pid, cors) {
  const e = await hqEventFor(env, String(body.e || ''), pid);
  if (!e || !evOrg(e, pid)) return json({ ok: false, error: 'Only the organiser can enter the results.' }, 403, cors);
  if (e.day > hqDay()) return json({ ok: false, error: 'You can enter results on the day, or after it.' }, 400, cors);
  const db = env.DEMAND;
  const mem = {}; (((await db.prepare('SELECT mkey, nick FROM soc_members WHERE soc = ?').bind(e.soc).all()).results) || []).forEach((m) => { mem[m.mkey] = m.nick; });
  const rows = [];
  for (const r of (Array.isArray(body.rows) ? body.rows : []).slice(0, 200)) {
    const m = String(r && r.m || '');
    if (!mem[m] || rows.some((x) => x.m === m)) continue;
    const nr = String(r.pts).trim().toUpperCase() === 'NR';
    const pts = nr ? -1 : Math.round(Number(r.pts));
    if (!nr && !(pts >= 0 && pts <= 70)) continue;
    const back = r.back === '' || r.back == null ? null : Math.round(Number(r.back));
    rows.push({ m, pts, back: back != null && back >= 0 && back <= 40 ? back : null });
  }
  if (rows.filter((r) => r.pts >= 0).length < 2) return json({ ok: false, error: 'Add at least two golfers’ points.' }, 400, cors);
  const pickM = (x) => (x && mem[String(x.m || '')] ? { m: String(x.m), txt: socText(x.txt, 40) || '' } : null);
  const line = socText(body.line, 200);
  if (line === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Please check your line.' }, 400, cors);
  const prize = Math.round(Math.min(250, Math.max(0, Number(body.prize) || 0)));
  const extras = { ntp: pickM(body.ntp), ld: pickM(body.ld), line: line || '', spoon: !!body.spoon, prize };
  // The winner's Prize Picker link (organiser's eyes only), made or updated when there's a prize.
  const ranked = fgRank(rows.map((r) => Object.assign({}, r)));
  const old = await db.prepare('SELECT prize FROM soc_reports WHERE event = ?').bind(e.id).first('prize');
  let token = old || null;
  if (prize > 0 && ranked[0] && !ranked[0].nr) {
    const award = [{ t: 'Winner: ' + e.title, w: mem[ranked[0].m], d: '', b: prize }];
    const s = await db.prepare('SELECT name FROM soc_socs WHERE id = ?').bind(e.soc).first('name');
    if (token) {
      const p = await db.prepare('SELECT kit FROM soc_prizes WHERE token = ?').bind(token).first('kit');
      if (p) await db.batch([
        db.prepare('UPDATE soc_kits SET awards = ?, updated = ? WHERE id = ?').bind(JSON.stringify(award), hqDay(), p),
        db.prepare('UPDATE soc_prizes SET budget = ? WHERE token = ?').bind(prize, token),
      ]);
      else token = null;
    }
    if (!token) {
      const kit = socCode(8); token = socCode(12);
      await db.batch([
        db.prepare('INSERT INTO soc_kits (id, pid, name, season, awards, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(kit, pid, String(s || 'Society').slice(0, 40), e.day.slice(0, 4), JSON.stringify(award), hqDay(), hqDay()),
        db.prepare('INSERT INTO soc_prizes (token, kit, idx, budget, choice, chosen) VALUES (?, ?, 0, ?, NULL, NULL)').bind(token, kit, prize),
      ]);
    }
  }
  await db.batch([db.prepare('DELETE FROM soc_results WHERE event = ?').bind(e.id)].concat(
    rows.map((r) => db.prepare('INSERT INTO soc_results (event, mkey, pts, back) VALUES (?, ?, ?, ?)').bind(e.id, r.m, r.pts, r.back)),
    [db.prepare('INSERT INTO soc_reports (event, extras, prize, published) VALUES (?, ?, ?, ?) ON CONFLICT (event) DO UPDATE SET extras = excluded.extras, prize = excluded.prize').bind(e.id, JSON.stringify(extras), token, new Date().toISOString())]));
  await hqTouch(env, e.soc);
  return json({ ok: true, url: '/societies/form-guide/?e=' + e.id, prize: token ? '/societies/prize/?t=' + token : null }, 200, cors);
}
async function fgUnpublish(env, body, pid, cors) {
  const e = await hqEventFor(env, String(body.e || ''), pid);
  if (!e || !evOrg(e, pid)) return json({ ok: false, error: 'Only the organiser can do that.' }, 403, cors);
  await env.DEMAND.batch([
    env.DEMAND.prepare('DELETE FROM soc_results WHERE event = ?').bind(e.id),
    env.DEMAND.prepare('DELETE FROM soc_reports WHERE event = ?').bind(e.id),
  ]);
  return json({ ok: true }, 200, cors);
}
/* ---- The National Society League (golfpriceai.com/societies/league/).
     lg_entries  soc, region, division, allowance (95 or 100), public (name on the tables),
                 champ (interested in a Champions' Day, a show of interest only), season, entered
   Societies enter from Society HQ (organiser only). Every society day reported
   in the Form Guide counts automatically: each month a society's team score is
   the average of its four best stableford scores (one per golfer, from days
   with at least four golfers). Societies on a 100% allowance have 1 point taken
   off, shown on the table. Monthly points by rank in the division: 10, 8, 6, 5,
   4, 3, 2, 1. Divisions of up to 10, filled in the order societies enter. */
const LG_SEASON = '2027', LG_FIRST = '04', LG_LAST = '10', LG_SIZE = 10;
const LG_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const LG_REGIONS = ['North East', 'North West', 'Yorkshire', 'Midlands', 'East of England', 'London and South East', 'South West', 'Scotland', 'Wales and Northern Ireland'];
const LG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
let lgReady = false;
async function lgSetup(env) {
  if (lgReady) return;
  await socSetup(env);
  await env.DEMAND.batch([
    env.DEMAND.prepare('CREATE TABLE IF NOT EXISTS lg_entries (soc TEXT PRIMARY KEY, region TEXT, division INTEGER, allowance INTEGER, public INTEGER, champ INTEGER, season TEXT, entered TEXT, hidden INTEGER DEFAULT 0) WITHOUT ROWID'),
    env.DEMAND.prepare('CREATE INDEX IF NOT EXISTS lg_div ON lg_entries (season, region, division)'),
  ]);
  lgReady = true;
}
// Each entered society's team score per month of the season, from its Form Guide results.
async function lgMonths(env, socs) {
  if (!socs.length) return {};
  const db = env.DEMAND, out = {};
  const evs = (await db.prepare(`SELECT e.id, e.soc, e.day FROM soc_events e JOIN soc_reports r ON r.event = e.id WHERE e.soc IN (${socs.map(() => '?').join(',')}) AND e.day >= ? AND e.day <= ?`)
    .bind(...socs, `${LG_SEASON}-${LG_FIRST}-01`, `${LG_SEASON}-${LG_LAST}-31`).all()).results || [];
  if (!evs.length) return out;
  const res = (await db.prepare(`SELECT event, mkey, pts FROM soc_results WHERE pts >= 0 AND event IN (${evs.map(() => '?').join(',')})`).bind(...evs.map((e) => e.id)).all()).results || [];
  const byEv = {}; res.forEach((r) => { (byEv[r.event] = byEv[r.event] || []).push(r); });
  evs.forEach((e) => {
    const rows = byEv[e.id] || [];
    if (rows.length < 4) return; // a day counts with four or more golfers
    const m = e.day.slice(0, 7), s = (out[e.soc] = out[e.soc] || {}), b = (s[m] = s[m] || {});
    rows.forEach((r) => { if (!(r.mkey in b) || r.pts > b[r.mkey]) b[r.mkey] = Number(r.pts); });
  });
  const team = {};
  Object.keys(out).forEach((soc) => {
    team[soc] = {};
    Object.keys(out[soc]).forEach((m) => {
      const best = Object.entries(out[soc][m]).sort((a, b) => b[1] - a[1]).slice(0, 4);
      if (best.length < 4) return;
      team[soc][m] = { score: best.reduce((a, b) => a + b[1], 0) / 4, top: best[0] };
    });
  });
  return team;
}
async function lgTable(env, region, division) {
  const db = env.DEMAND;
  const ents = (await db.prepare('SELECT l.soc, l.allowance, l.public, l.entered, s.name FROM lg_entries l JOIN soc_socs s ON s.id = l.soc WHERE l.season = ? AND l.region = ? AND l.division = ? AND l.hidden = 0 ORDER BY l.entered, l.soc').bind(LG_SEASON, region, division).all()).results || [];
  const team = await lgMonths(env, ents.map((e) => e.soc));
  const months = [...new Set(Object.values(team).flatMap((t) => Object.keys(t)))].sort();
  const rows = ents.map((e) => ({ soc: e.soc, name: e.public ? e.name : 'A society in ' + region, allowance: e.allowance, pts: 0, played: 0, sum: 0, pos: [] }));
  const byId = {}; rows.forEach((r) => { byId[r.soc] = r; });
  let latest = null;
  months.forEach((m) => {
    const scored = rows.map((r) => { const t = team[r.soc] && team[r.soc][m]; return t ? { r, s: t.score - (r.allowance === 100 ? 1 : 0), top: t.top } : null; }).filter(Boolean).sort((a, b) => b.s - a.s);
    let place = 0;
    scored.forEach((x, i) => {
      if (i === 0 || x.s < scored[i - 1].s - 1e-9) place = i;
      x.r.pts += LG_POINTS[place] || 0; x.r.played++; x.r.sum += x.s; x.r.pos.push({ m, p: place + 1 });
    });
    rows.forEach((r) => { if (!r.pos.some((p) => p.m === m)) r.pos.push({ m, p: null }); });
    latest = { month: m, scored: scored.map((x) => ({ soc: x.r.soc, name: x.r.name, score: Math.round(x.s * 100) / 100, top: x.top })), missed: rows.filter((r) => !scored.some((x) => x.r === r)).map((r) => r.name) };
  });
  rows.sort((a, b) => b.pts - a.pts || (b.played ? b.sum / b.played : 0) - (a.played ? a.sum / a.played : 0) || 0);
  let note = null;
  if (latest && latest.scored.length) {
    const w = latest.scored[0], second = latest.scored[1];
    const nick = w.top ? await db.prepare('SELECT nick FROM soc_members WHERE mkey = ?').bind(w.top[0]).first('nick') : null;
    note = `${LG_MONTHS[Number(latest.month.slice(5)) - 1]}: ${w.name} top with a team score of ${w.score.toFixed(2)}` + (nick && w.top ? `, helped by ${w.top[1]} points from ${nick}` : '') + '.' +
      (second ? ` ${second.name} ${second.score === w.score ? 'level on' : 'next on'} ${second.score.toFixed(2)}.` : '') +
      (latest.missed.length ? ` ${latest.missed.length === 1 ? latest.missed[0] + ' didn’t play' : latest.missed.length + ' societies didn’t play'}, so no points.` : '');
  }
  const over = hqDay() > `${LG_SEASON}-${LG_LAST}-31`;
  return { region, division, season: LG_SEASON, months: months.length, over, note,
    rows: rows.map((r, i) => ({ pos: i + 1, soc: r.soc, name: r.name, pts: r.pts, played: r.played, avg: r.played ? Math.round(r.sum / r.played * 100) / 100 : null, allowance: r.allowance, form: r.pos.slice(-3).map((p) => p.p), champion: over && i === 0 && r.played > 0 })) };
}
async function nationalLeague(request, url, env, cors) {
  if (!env.DEMAND) return json({ ok: false, error: 'The League is taking a short break. Please try again later.' }, 503, cors);
  await lgSetup(env);
  const path = url.pathname, db = env.DEMAND, ip = request.headers.get('cf-connecting-ip') || '';
  let body = {};
  if (request.method === 'POST') {
    try { body = JSON.parse((await request.text()).slice(0, 2000)); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400, cors); }
    if (await tooMany('lg-' + ip, 30, 600)) return json({ ok: false, error: 'Easy, tiger. Please try again in a few minutes.' }, 429, cors);
  }
  const pidIn = String(body.pid || url.searchParams.get('pid') || '');
  const pid = PID_RX.test(pidIn) ? pidIn : '';
  const cache = Object.assign({ 'cache-control': 'public, max-age=120' }, cors), noStore = Object.assign({ 'cache-control': 'no-store' }, cors);

  if (path === '/lg/home') {
    const rows = (await db.prepare('SELECT region, division, COUNT(*) AS n FROM lg_entries WHERE season = ? AND hidden = 0 GROUP BY region, division').bind(LG_SEASON).all()).results || [];
    const regions = LG_REGIONS.map((r) => { const ds = rows.filter((x) => x.region === r); return { region: r, societies: ds.reduce((a, x) => a + Number(x.n), 0), divisions: ds.map((x) => Number(x.division)).sort((a, b) => a - b) }; });
    // Society of the Month: the best team score anywhere in the latest month played.
    let sotm = null;
    const all = (await db.prepare('SELECT l.soc, l.region, l.division, l.allowance, l.public, s.name FROM lg_entries l JOIN soc_socs s ON s.id = l.soc WHERE l.season = ? AND l.hidden = 0').bind(LG_SEASON).all()).results || [];
    const team = await lgMonths(env, all.map((x) => x.soc));
    const months = [...new Set(Object.values(team).flatMap((t) => Object.keys(t)))].sort();
    const m = months.filter((x) => x < hqDay().slice(0, 7)).pop() || null;
    if (m) {
      const best = all.map((x) => ({ x, s: team[x.soc] && team[x.soc][m] ? team[x.soc][m].score - (x.allowance === 100 ? 1 : 0) : null })).filter((y) => y.s !== null && y.x.public).sort((a, b) => b.s - a.s)[0];
      if (best) sotm = { month: m, name: best.x.name, region: best.x.region, division: best.x.division, score: Math.round(best.s * 100) / 100 };
    }
    return json({ ok: true, season: LG_SEASON, open: hqDay() >= LG_SEASON + '-02-01', total: all.length, regions, sotm }, 200, cache);
  }
  if (path === '/lg/div') {
    const region = String(url.searchParams.get('r') || ''), division = Math.round(Number(url.searchParams.get('d')) || 1);
    if (!LG_REGIONS.includes(region) || !(division >= 1 && division <= 50)) return json({ ok: false, error: 'We couldn’t find that division.' }, 404, cors);
    return json(Object.assign({ ok: true }, await lgTable(env, region, division)), 200, cache);
  }
  if (path === '/lg/mine') {
    const s = await hqSoc(env, String(url.searchParams.get('s') || ''));
    if (!s) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    const e = await db.prepare('SELECT region, division, allowance, public, champ, entered FROM lg_entries WHERE soc = ? AND season = ? AND hidden = 0').bind(s.id, LG_SEASON).first();
    return json({ ok: true, season: LG_SEASON, open: hqDay() >= LG_SEASON + '-02-01', regions: LG_REGIONS, entry: e || null, organiser: socOrg(s, pid) }, 200, noStore);
  }
  if (path === '/lg/enter' && request.method === 'POST') {
    const s = await hqSoc(env, String(body.s || ''));
    if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can enter the society.' }, 403, cors);
    const region = String(body.region || ''), allowance = Number(body.allowance) === 100 ? 100 : 95;
    if (!LG_REGIONS.includes(region)) return json({ ok: false, error: 'Pick your region.' }, 400, cors);
    if (hqDay() > `${LG_SEASON}-${LG_LAST}-01`) return json({ ok: false, error: 'This season’s entries have closed. Next season’s open in February.' }, 400, cors);
    const had = await db.prepare('SELECT region, division FROM lg_entries WHERE soc = ? AND season = ?').bind(s.id, LG_SEASON).first();
    let division = had && had.region === region ? had.division : null;
    if (!division) {
      const counts = (await db.prepare('SELECT division, COUNT(*) AS n FROM lg_entries WHERE season = ? AND region = ? AND hidden = 0 GROUP BY division ORDER BY division').bind(LG_SEASON, region).all()).results || [];
      division = 1;
      for (const c of counts) { if (Number(c.division) === division && Number(c.n) >= LG_SIZE) division++; }
    }
    const pub = body.public === false ? 0 : 1, champ = body.champ ? 1 : 0;
    if (had) {
      // The allowance is fixed once the season starts (1 April), so nobody switches mid-way.
      const lock = hqDay() >= `${LG_SEASON}-${LG_FIRST}-01`;
      await db.prepare(`UPDATE lg_entries SET region = ?, division = ?, public = ?, champ = ?, hidden = 0${lock ? '' : ', allowance = ?'} WHERE soc = ?`)
        .bind(...(lock ? [region, division, pub, champ, s.id] : [region, division, pub, champ, allowance, s.id])).run();
    } else {
      await db.prepare('INSERT INTO lg_entries (soc, region, division, allowance, public, champ, season, entered, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
        .bind(s.id, region, division, allowance, pub, champ, LG_SEASON, new Date().toISOString()).run();
    }
    await hqTouch(env, s.id);
    return json({ ok: true, region, division }, 200, cors);
  }
  if (path === '/lg/leave' && request.method === 'POST') {
    const s = await hqSoc(env, String(body.s || ''));
    if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can do that.' }, 403, cors);
    await db.prepare('DELETE FROM lg_entries WHERE soc = ? AND season = ?').bind(s.id, LG_SEASON).run();
    return json({ ok: true }, 200, cors);
  }
  // John only: take a society off the tables, or put it back.
  if (path === '/lg/admin' && request.method === 'POST') {
    if (await keyLocked(ip || 'unknown')) return json({ ok: false, error: 'Too many wrong tries. The door opens again in ten minutes.' }, 429, cors);
    if (!keyMatches(env, body.key)) { await tooMany('stats-' + (ip || 'unknown'), 5, 600); return json({ ok: false, error: 'That key isn’t right.' }, 403, cors); }
    const soc = String(body.soc || ''), act = String(body.action || '');
    if (!SOC_RX.test(soc) || !['hide', 'show'].includes(act)) return json({ ok: false, error: 'Bad request.' }, 400, cors);
    await db.prepare('UPDATE lg_entries SET hidden = ? WHERE soc = ?').bind(act === 'hide' ? 1 : 0, soc).run();
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: false, error: 'Not found.' }, 404, cors);
}
async function hqFind(env, cors) {
  const rows = (await env.DEMAND.prepare('SELECT s.id, s.name, s.area, s.county, s.about, s.updated, s.cname, s.ctown, s.lat, s.lon, s.days, s.ability, s.cost, (SELECT COUNT(*) FROM soc_members m WHERE m.soc = s.id) AS members, (SELECT n FROM soc_founding f WHERE f.soc = s.id) AS founding FROM soc_socs s WHERE s.open = 1 ORDER BY s.updated DESC LIMIT 300').all()).results || [];
  const ids = rows.map((r) => r.id), spare = {}, league = {};
  if (ids.length) {
    const q = ids.map(() => '?').join(',');
    // Spare places on golf days in the next 60 days, shown only when the organiser asked.
    const until = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    (((await env.DEMAND.prepare(`SELECT id, soc, title, venue, day, tee, entry, spare FROM soc_events WHERE soc IN (${q}) AND spare > 0 AND day >= ? AND day <= ? ORDER BY day`).bind(...ids, hqDay(), until).all()).results) || [])
      .forEach((e) => { (spare[e.soc] = spare[e.soc] || []).push({ id: e.id, title: e.title, venue: e.venue, day: e.day, tee: e.tee, entry: e.entry, spare: e.spare }); });
    try { (((await env.DEMAND.prepare(`SELECT soc, region, division FROM lg_entries WHERE soc IN (${q}) AND hidden = 0 AND public = 1`).bind(...ids).all()).results) || []).forEach((l) => { league[l.soc] = { region: l.region, division: l.division }; }); } catch (e) { /* no league yet */ }
  }
  return json({ ok: true, societies: rows.map((r) => ({ id: r.id, name: r.name, area: r.area, county: r.county || '', about: r.about, members: r.members, founding: r.founding || 0,
    course: r.cname || '', town: r.ctown || '', lat: r.lat, lon: r.lon, days: r.days || '', ability: r.ability || '', cost: r.cost || '',
    spare: (spare[r.id] || []).slice(0, 3), league: league[r.id] || null })) }, 200, Object.assign({ 'cache-control': 'public, max-age=300' }, cors));
}
/* Ask to join: a golfer finds a society (or a spare place on one golf day)
   and asks. The organiser sees the nickname and note in Society HQ and says
   yes or no. Yes adds them as a member (and, for a spare place, puts them in
   for that day). No email, no phone number: the asker checks back on the
   society's page or in My Clubhouse. */
async function hqAsk(env, body, pid, request, cors) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!pid) return json({ ok: false, error: 'Bad request.' }, 400, cors);
  if (await tooMany('ask-' + ip, 8, 3600)) return json({ ok: false, error: 'That’s a lot of asking. Please try again in an hour.' }, 429, cors);
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !s.open) return json({ ok: false, error: 'This society isn’t taking new members just now.' }, 404, cors);
  if (await env.DEMAND.prepare('SELECT 1 AS x FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, pid).first('x')) return json({ ok: false, error: 'You’re already in this society.', member: true }, 400, cors);
  const nick = cleanName(body.nick, 2, 20), note = socText(body.note, 200);
  if (nick === null || note === null) return json({ ok: false, error: 'Let’s keep it clean for the clubhouse. Please check the wording.' }, 400, cors);
  if (!nick) return json({ ok: false, error: 'Pick a nickname (at least 2 letters).' }, 400, cors);
  let event = '';
  if (body.e) {
    const e = await env.DEMAND.prepare('SELECT id, spare FROM soc_events WHERE id = ? AND soc = ? AND day >= ?').bind(String(body.e), s.id, hqDay()).first();
    if (!e || !(e.spare > 0)) return json({ ok: false, error: 'Those spare places have gone. Ask to join the society instead.' }, 400, cors);
    event = e.id;
  }
  const open = await env.DEMAND.prepare("SELECT COUNT(*) AS c FROM soc_requests WHERE soc = ? AND status = 'new'").bind(s.id).first('c');
  if (open >= 30) return json({ ok: false, error: 'The organiser has lots of requests to get through. Try again in a few days.' }, 429, cors);
  await env.DEMAND.prepare("DELETE FROM soc_requests WHERE soc = ? AND pid = ? AND status = 'new'").bind(s.id, pid).run();
  await env.DEMAND.prepare("INSERT INTO soc_requests (id, soc, pid, nick, note, event, at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')").bind(socCode(10), s.id, pid, nick, note || '', event, new Date().toISOString()).run();
  await useBump(env, 'soc_ask');
  return json({ ok: true }, 200, cors);
}
async function hqAnswer(env, body, pid, cors) {
  const s = await hqSoc(env, String(body.s || ''));
  if (!s || !socOrg(s, pid)) return json({ ok: false, error: 'Only the organiser can answer requests.' }, 403, cors);
  const r = await env.DEMAND.prepare("SELECT * FROM soc_requests WHERE id = ? AND soc = ? AND status = 'new'").bind(String(body.r || ''), s.id).first();
  if (!r) return json({ ok: false, error: 'That request has already been answered.' }, 404, cors);
  if (!body.yes) {
    await env.DEMAND.prepare("UPDATE soc_requests SET status = 'no' WHERE id = ?").bind(r.id).run();
    return json({ ok: true }, 200, cors);
  }
  const db = env.DEMAND;
  let mk = await db.prepare('SELECT mkey FROM soc_members WHERE soc = ? AND pid = ?').bind(s.id, r.pid).first('mkey');
  if (!mk) {
    let nick = r.nick;
    for (let i = 2; i < 9 && await db.prepare('SELECT 1 AS x FROM soc_members WHERE soc = ? AND lower(nick) = lower(?)').bind(s.id, nick).first('x'); i++) nick = (r.nick + ' ' + i).slice(0, 20);
    mk = socCode(8);
    await db.prepare('INSERT INTO soc_members (soc, pid, mkey, nick, joined) VALUES (?, ?, ?, ?, ?)').bind(s.id, r.pid, mk, nick, hqDay()).run();
    await hqFounding(env, s.id);
  }
  if (r.event) {
    await db.batch([
      db.prepare("INSERT INTO soc_entries (event, mkey, status, paid, at) VALUES (?, ?, 'in', 0, ?) ON CONFLICT (event, mkey) DO UPDATE SET status = 'in'").bind(r.event, mk, new Date().toISOString()),
      db.prepare('UPDATE soc_events SET spare = MAX(0, COALESCE(spare, 0) - 1) WHERE id = ?').bind(r.event),
    ]);
  }
  await db.prepare("UPDATE soc_requests SET status = 'yes' WHERE id = ?").bind(r.id).run();
  await hqTouch(env, s.id);
  await useBump(env, 'soc_ask_yes');
  return json({ ok: true }, 200, cors);
}
// The asker's own requests, so the society page and My Clubhouse can show the answer.
async function hqAsks(env, pid, cors) {
  if (!pid) return json({ ok: true, asks: [] }, 200, cors);
  const rows = (await env.DEMAND.prepare('SELECT r.soc, s.name, r.event, r.status, r.at, e.day, e.title FROM soc_requests r JOIN soc_socs s ON s.id = r.soc LEFT JOIN soc_events e ON e.id = r.event WHERE r.pid = ? ORDER BY r.at DESC LIMIT 20').bind(pid).all()).results || [];
  return json({ ok: true, asks: rows.map((r) => ({ s: r.soc, name: r.name, status: r.status, event: r.event || '', day: r.day || '', title: r.title || '' })) }, 200, Object.assign({ 'cache-control': 'no-store' }, cors));
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
  for (const name of ['WATCHLIST', 'CONSENT_AT', 'DIGEST', 'STOCKWATCH', 'BOUGHTWATCH', 'BUDGETWATCH', 'PPREMIND', 'PRESS']) {
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
  const what = opts.press
    ? `<strong>The UK Golf Price Report</strong>: one email a month, when the new edition is out, with the headline figures and a link to the press note`
    : opts.remind
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
