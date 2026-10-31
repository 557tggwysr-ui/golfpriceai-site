/* Shot Saver: the maths, shared by the Shot Saver page and My Clubhouse.

   A golfer adds five numbers from a scorecard: score, fairways hit, greens in
   regulation, putts and penalty shots. Each round is compared with a golfer
   at the level they're chasing, using Shot Scope's published averages by
   handicap (via Golf Monthly). Rounds stay in this browser (gpShotSaver).

   Where the shots go, per round, against the benchmark golfer:
     Putting         putts − their putts
     Penalties       every penalty shot counts in full (no reliable published
                     average exists by handicap, so we don't guess one)
     Approach        greens missed beyond theirs × (1 − their up-and-down
                     rate): a missed green costs a shot unless you get up and
                     down, and they get up and down that often
     Everything else whatever's left of the score gap: chips, bunkers, the odd
                     duff, and anything not entered
   A minus number is a strength: you're already better than them there. */
(function () {
  'use strict';
  if (window.gpShotSaverCore) return;

  // Shot Scope averages by handicap, via Golf Monthly. Scores are on a par 72.
  // Break 80 sits between the published scratch and 10-handicap figures for
  // fairways and putts; its greens and score are published.
  var AIMS = {
    '100': { label: 'Break 100', who: 'a 20-handicapper', hcp: 20, score: 95, fw: 45, gir: 14, putts: 33.4, ud: 31 },
    '90': { label: 'Break 90', who: 'a 10-handicapper', hcp: 10, score: 85, fw: 48, gir: 32, putts: 31.2, ud: 39 },
    '80': { label: 'Break 80', who: 'a 5-handicapper', hcp: 5, score: 79, fw: 49, gir: 41, putts: 30.6, ud: 46 },
    'sc': { label: 'Scratch', who: 'a scratch golfer', hcp: 0, score: 74, fw: 50, gir: 59, putts: 29.9, ud: 54 }
  };
  var ORDER = ['100', '90', '80', 'sc'];
  var CATS = [
    ['putt', 'Putting'], ['pen', 'Penalties'], ['app', 'Approach shots'], ['rest', 'Short game and the rest']
  ];
  var KEY = 'gpShotSaver';

  function get() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY));
      if (v && typeof v === 'object' && Array.isArray(v.rounds)) return { aim: AIMS[v.aim] ? v.aim : '90', par: [70, 71, 72, 73].indexOf(+v.par) >= 0 ? +v.par : 72, rounds: v.rounds.filter(valid).slice(-20) };
    } catch (e) { /* fall through */ }
    return { aim: '90', par: 72, rounds: [] };
  }
  function put(s) { try { localStorage.setItem(KEY, JSON.stringify({ aim: s.aim, par: s.par, rounds: s.rounds.slice(-20) })); return true; } catch (e) { return false; } }
  function num(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; }
  function valid(r) {
    return r && num(r.s, 50, 160) && (r.f == null || num(r.f, 0, 14)) && (r.g == null || num(r.g, 0, 18)) &&
      (r.p == null || num(r.p, 0, 70)) && (r.n == null || num(r.n, 0, 30)) && (r.par == null || num(r.par, 66, 74));
  }

  // One round against one aim. Returns shots per category (minus = a strength).
  function round(r, aimId) {
    var b = AIMS[aimId] || AIMS['90'], par = r.par || 72;
    var gap = (r.s - par) - (b.score - 72), out = {};
    out.putt = r.p == null ? null : r.p - b.putts;
    out.pen = r.n == null ? null : r.n;
    out.app = r.g == null ? null : (b.gir / 100 * 18 - r.g) * (1 - b.ud / 100);
    out.rest = gap - (out.putt || 0) - (out.pen || 0) - (out.app || 0);
    out.gap = gap;
    out.leaks = CATS.reduce(function (t, c) { return t + Math.max(0, out[c[0]] || 0); }, 0);
    out.fwShort = r.f == null ? null : b.fw / 100 * 14 - r.f;
    return out;
  }

  // The last n rounds, averaged.
  function summary(s, n) {
    var rs = s.rounds.slice(-(n || 5)), aim = s.aim;
    if (!rs.length) return null;
    var per = rs.map(function (r) { return round(r, aim); }), avg = {};
    CATS.concat([['gap'], ['leaks']]).forEach(function (c) {
      var k = c[0], vals = per.map(function (p) { return p[k]; }).filter(function (v) { return v != null; });
      avg[k] = vals.length ? vals.reduce(function (a, v) { return a + v; }, 0) / vals.length : null;
    });
    var fw = per.map(function (p) { return p.fwShort; }).filter(function (v) { return v != null; });
    avg.fwShort = fw.length ? fw.reduce(function (a, v) { return a + v; }, 0) / fw.length : null;
    var cats = CATS.map(function (c) { return { k: c[0], label: c[1], v: avg[c[0]] }; }).filter(function (c) { return c.v != null; });
    var leaks = cats.filter(function (c) { return c.v >= 0.05; }).sort(function (a, b) { return b.v - a.v; });
    var strengths = cats.filter(function (c) { return c.v <= -0.25; }).sort(function (a, b) { return a.v - b.v; });
    var all = s.rounds.map(function (r) { return round(r, aim).leaks; });
    var missing = rs.filter(function (r) { return r.p == null || r.g == null || r.n == null; }).length;
    return { aim: AIMS[aim], aimId: aim, n: rs.length, avg: avg, leaks: leaks, strengths: strengths, missing: missing,
      total: leaks.reduce(function (t, c) { return t + c.v; }, 0),
      trend: s.rounds.slice(-5).map(function (r) { return { d: r.d, v: round(r, aim).leaks }; }),
      sinceFirst: all.length > 1 ? all[0] - all[all.length - 1] : null };
  }
  function one(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  window.gpShotSaverCore = { AIMS: AIMS, ORDER: ORDER, CATS: CATS, get: get, put: put, valid: valid, round: round, summary: summary, one: one };
})();
