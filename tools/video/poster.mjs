#!/usr/bin/env node
// The README poster of the film: a frame of the film under a title and a play button (poster.html).
//   node tools/video/poster.mjs --video video/bigbang.mp4 --at 24.75 --out docs/img/film-poster.jpg
// Any image works as the frame, and the words can change, e.g. the repository's social preview:
//   node tools/video/poster.mjs --video shot.png --at 0 --size 1280x640 --title Commitverse --sub "…" --badge "" --play 0 --out docs/img/social.jpg
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const frame = join(mkdtempSync(join(tmpdir(), 'poster-')), 'frame.png');
execFileSync(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-ss', opt('at', '24.75'), '-i', opt('video', 'video/bigbang.mp4'), '-frames:v', '1', frame]);

const [w, h] = opt('size', '1600x900').split('x').map(Number);
const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const html = pathToFileURL(resolve('tools/video/poster.html'));
html.searchParams.set('frame', pathToFileURL(frame).href);
for (const key of ['title', 'sub', 'badge', 'play']) if (opt(key, null) !== null) html.searchParams.set(key, opt(key));
await page.goto(html.href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: opt('out', 'docs/img/film-poster.jpg'), type: 'jpeg', quality: 86 });
await browser.close();
console.log(`Wrote ${opt('out', 'docs/img/film-poster.jpg')}`);
