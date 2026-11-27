import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1200, height: 630 });
await p.goto(`file://${process.cwd()}/out/og.html`); await p.screenshot({ path: './out/og.png' }); await b.close();
