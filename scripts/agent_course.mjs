// Helper for the game master: prints each requested day's Wild Nine course
// (pars and hole types) by running the game's own engine from the live page.
// Usage: node scripts/agent_course.mjs 20261123 20261124 ...
import fs from 'node:fs';
const html = fs.readFileSync('play/wild-nine/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const engine = scripts.find(s => s.includes('G.WildNine ='));
if (!engine) { console.log('{}'); process.exit(0); }
globalThis.window = globalThis;
const tune = scripts.find(s => s.includes('window.WN_TUNING='));
if (tune) (0, eval)(tune);
(0, eval)(engine);
const out = {};
for (const a of process.argv.slice(2)) {
  const c = globalThis.WildNine.makeCourse(Number(a));
  out[a] = { name: c.name, major: c.major, holes: c.holes.map(h => ({ par: h.par, mod: h.mod, hw: Math.round(h.hw * 10) / 10, wind: h.wind.mph })) };
}
console.log(JSON.stringify(out));
