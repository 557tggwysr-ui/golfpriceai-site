import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errs = []; const sleep = ms => new Promise(r => setTimeout(r, ms));
const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
p.on('pageerror', e => errs.push(e.message));
await p.goto(`file://${process.cwd()}/index-test.html`); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('wildnine-tut', '1'); localStorage.setItem('wildnine-wallet', JSON.stringify({ bal: 999999, earned: 999999, owned: [], eq: {}, name: 'John' })); }); await p.reload(); await sleep(400);
await p.click('[data-go="shop"]'); await sleep(200);
for (const t of ['layer', 'glove', 'watch']) { await p.evaluate(t => document.querySelector(`[data-t="${t}"]`).click(), t); await sleep(200); await p.evaluate(() => document.querySelector('.ps-grid').scrollIntoView()); await sleep(100); await p.screenshot({ path: `k-${t}.png` }); }
// wear a puffer gilet, tour glove, green dial watch
await p.evaluate(() => { const w = JSON.parse(localStorage.getItem('wildnine-wallet')); w.owned.push('gi_club', 'gl_tour', 'wa_green'); Object.assign(w.eq, { layer: 'gi_club', glove: 'gl_tour', watch: 'wa_green', top: 'polo_white' }); localStorage.setItem('wildnine-wallet', JSON.stringify(w)); });
await p.reload(); await sleep(300); await p.click('[data-go="shop"]'); await sleep(200);
await p.evaluate(() => document.querySelector('#myGolfer').click()); await sleep(400); await p.screenshot({ path: 'k-card.png' });
const big = await p.evaluate(() => { const s = document.querySelector('.overlay.show svg'); return s ? s.outerHTML : ''; });
await p.setContent(`<body style="margin:0;background:#f4efe1">${big.replace(/width="[^"]+" height="[^"]+"/, 'width="540" height="600"')}</body>`); await sleep(200); await p.screenshot({ path: 'k-big.png', clip: { x: 0, y: 0, width: 540, height: 600 } });
console.log(errs); await b.close();
