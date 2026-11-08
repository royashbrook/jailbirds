import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
// the background is the tile colour, so the corners and a maskable crop are all one warm yellow
const svg = await readFile('public/icon.svg', 'utf8'), browser = await chromium.launch({ headless: true });
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>body{margin:0;background:#ffe9b8}svg{width:100%;height:100%}</style>${svg}`);
  await page.screenshot({ path: `public/icon-${size}.png` }); await page.close();
}
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.setContent(`<style>body{margin:0;background:#ffe9b8;display:grid;place-items:center;width:512px;height:512px}svg{width:410px;height:410px}</style>${svg}`);
await page.screenshot({ path: 'public/icon-maskable-512.png' });
await browser.close();
