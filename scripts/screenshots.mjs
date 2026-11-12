// Capture the README screenshots from the real app (run after `npm run build`).
// Usage: node scripts/screenshots.mjs   (set PW_CHROMIUM_PATH to use a specific Chromium)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = `${root}docs/images`;
mkdirSync(outDir, { recursive: true });
const port = 5177;
const server = spawn(
  process.execPath,
  [`${root}packages/cli/dist/raisedline.mjs`, 'serve', '--port', String(port)],
  { stdio: 'pipe' },
);
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes('running at') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited (${c})`)));
});
const url = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 860 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const shot = async (name) => {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`docs/images/${name}.png`);
};
try {
  await page.goto(url + '#chart');
  await page.waitForSelector('.sheet.tactile [data-rl-id="bar-0-0"]');
  await shot('app-chart');

  // Touch preview on a graphic that needs work: select the first finding, show the fingertip.
  await page.getByRole('button', { name: 'Temperatures (needs work)' }).click();
  await page.waitForTimeout(500);
  await page.locator('.issues .issue').first().click();
  await page.waitForTimeout(600);
  const sheet = page.locator('.sheet.tactile');
  const box = await sheet.boundingBox();
  await page.mouse.move(box.x + box.width * 0.47, box.y + box.height * 0.5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/touch-preview.png` });
  console.log('docs/images/touch-preview.png');

  for (const [tab, name] of [
    ['Diagram', 'app-diagram'],
    ['Map', 'app-map'],
    ['Image', 'app-image'],
  ]) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(900);
    await shot(name);
  }

  // Close-up of the tactile map as it looks raised on swell paper.
  await page.getByRole('tab', { name: 'Map' }).click();
  await page.getByRole('button', { name: 'Side by side' }).click();
  await page.getByRole('button', { name: 'Touch preview' }).click();
  await page.waitForTimeout(700);
  await page.locator('.sheet.tactile').screenshot({ path: `${outDir}/tactile-map.png` });
  console.log('docs/images/tactile-map.png');

  // Banner: sighted chart → tactile chart.
  const { buildChart, chartFromCsv, renderTactileSvg } = await import(
    `${root}packages/core/dist/index.js`
  );
  const csv = readFileSync(`${root}examples/rainfall.csv`, 'utf8');
  const r = buildChart(chartFromCsv(csv, { type: 'bar', title: 'Monthly rainfall (mm)' }));
  const tactile = renderTactileSvg(r.tactile, 0, {
    raised: true,
    interactive: false,
    width: '100%',
  });
  const sighted = r.sighted.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%"');
  const logo = readFileSync(`${root}packages/web/public/favicon.svg`, 'utf8');
  const html = `<!doctype html><html><head><style>
    body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#1f1b16;color:#f7f1e3}
    .wrap{width:1280px;height:640px;box-sizing:border-box;padding:40px 56px;display:grid;grid-template-columns:1fr 60px 1.08fr;grid-template-rows:auto 1fr;gap:20px 24px;align-items:center;
      background:radial-gradient(1200px 500px at 80% 0%,#3a3025 0%,#1f1b16 60%)}
    h1{grid-column:1/-1;margin:0;display:flex;align-items:center;gap:18px;font-size:46px;letter-spacing:-.02em}
    h1 svg{width:58px;height:58px} h1 small{font-size:22px;font-weight:500;color:#d8ccb6;margin-left:8px}
    .card{background:#fff;border-radius:14px;padding:10px;box-shadow:0 20px 50px rgba(0,0,0,.45)}
    .card.t{background:#f7f1e3}
    .arrow{font-size:54px;color:#f3c969;text-align:center}
    .cap{font-size:15px;color:#d8ccb6;margin:10px 4px 0;text-align:center}
  </style></head><body><div class="wrap">
    <h1>${logo}Raisedline <small>charts and maps you can read by touch</small></h1>
    <div><div class="card">${sighted}</div><div class="cap">The textbook graphic</div></div>
    <div class="arrow">→</div>
    <div><div class="card t">${tactile}</div><div class="cap">The tactile graphic: textures, braille, checked for touch</div></div>
  </div></body></html>`;
  const tmp = `${outDir}/.banner.html`;
  writeFileSync(tmp, html);
  const p2 = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 2,
  });
  await p2.goto('file://' + tmp);
  await p2.screenshot({ path: `${outDir}/banner.png` });
  console.log('docs/images/banner.png');
  (await import('node:fs')).rmSync(tmp);
} finally {
  await browser.close();
  server.kill();
}
