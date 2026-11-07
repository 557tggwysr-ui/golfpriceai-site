// GolfPrice AI extension: looks up golf products against GolfPrice AI's own
// public price files. It only ever talks to golfpriceai.com (and the alerts
// service when you tap Watch). It never reads or changes cookies or links.
importScripts('match.js');
var SITE = 'https://golfpriceai.com';
var ALERTS = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
var SIX_HOURS = 6 * 3600 * 1000;
var models = null, used = null, pages = {};

function cached(key, url, pick) {
  return chrome.storage.local.get(key).then(function (s) {
    var c = s[key];
    if (c && Date.now() - c.t < SIX_HOURS) return c.d;
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { var d = pick(j); var o = {}; o[key] = { t: Date.now(), d: d }; chrome.storage.local.set(o); return d; })
      .catch(function () { return c ? c.d : null; });
  });
}
function getModels() {
  if (!models) models = cached('models', SITE + '/data/search-suggest.json', function (j) { return j.m || []; })
    .then(function (m) { var l = GPMatch.prep(m || []); if (!l.length) models = null; return l; });
  return models;
}
function getUsed() {
  if (!used) used = cached('used', SITE + '/data/used-prices.json', function (j) { return j.m || {}; })
    .then(function (u) { return u || {}; });
  return used;
}
function getPage(slug) {
  var c = pages[slug];
  if (c && Date.now() - c.t < 30 * 60 * 1000) return c.p;
  var p = fetch(SITE + '/prices/' + encodeURIComponent(slug) + '/data.json')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(function () { delete pages[slug]; return null; });
  pages[slug] = { t: Date.now(), p: p };
  return p;
}

function lookup(titles) {
  return getModels().then(function (list) {
    var hit = null;
    for (var i = 0; i < titles.length && !hit; i++) if (titles[i]) hit = GPMatch.find(titles[i], list);
    if (!hit) return { found: false };
    return Promise.all([getPage(hit.slug), getUsed()]).then(function (r) {
      if (!r[0]) return { found: false };
      return { found: true, slug: hit.slug, data: r[0], used: r[1][hit.slug] || null };
    });
  });
}

function watch(slug, name, email) {
  return fetch(ALERTS + '/subscribe', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email, model: slug, modelName: name, src: 'extension' })
  }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
    .catch(function () { return { ok: false, error: 'Couldn’t reach GolfPrice AI just now. Please try again.' }; });
}

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (msg && msg.type === 'lookup') { lookup(msg.titles || []).then(reply); return true; }
  if (msg && msg.type === 'watch') { watch(msg.slug, msg.name, msg.email).then(reply); return true; }
  if (msg && msg.type === 'settings') {
    chrome.storage.local.get(['email', 'auto']).then(function (s) { reply({ email: s.email || '', auto: s.auto !== false }); });
    return true;
  }
  if (msg && msg.type === 'saveEmail') { chrome.storage.local.set({ email: msg.email }).then(function () { reply({ ok: true }); }); return true; }
});
