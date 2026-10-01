#!/usr/bin/env node
// Renders the film "The Big Bang of open source" frame by frame: opens the universe and the city in
// director mode (?director&capture), steps each director by exactly 1/fps per frame, screenshots the
// page (WebGL + captions) and pipes the frames into ffmpeg. The run is deterministic, so it doesn't
// matter how slow the machine is.
//
//   npm run dev                       # or: npx vite preview --port 5173
//   node tools/video/capture.mjs [--base http://localhost:5173/] [--fps 30] [--size 1920x1080]
//                                [--out video/bigbang.mp4] [--only universe|city] [--stills 3,12.5,30]
//
// Needs ffmpeg on PATH (or FFMPEG=...) and Microsoft Edge or Chrome (BROWSER=msedge|chrome).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = opt('base', 'http://localhost:5173/');
const FPS = Number(opt('fps', 30));
const [W, H] = opt('size', '1920x1080').split('x').map(Number);
const OUT = resolve(opt('out', 'video/bigbang-silent.mp4'));
const ONLY = opt('only', null);
const STILLS = opt('stills', null)?.split(',').map(Number);
const CRF = opt('crf', '16');

const SEGMENTS = [
  { name: 'universe', url: `${BASE}?director&capture` },
  { name: 'city', url: `${BASE}city.html?repo=karpathy-llm.c&from=karpathy&director&capture` },
].filter((s) => !ONLY || s.name === ONLY);

const browser = await chromium.launch({
  channel: process.env.BROWSER ?? 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--hide-scrollbars'],
});

let ffmpeg = null;
if (!STILLS) {
  mkdirSync(dirname(OUT), { recursive: true });
  ffmpeg = spawn(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
}
const write = (buf) => new Promise((ok) => (ffmpeg.stdin.write(buf) ? ok() : ffmpeg.stdin.once('drain', ok)));

const cues = [];
const segments = [];
let offset = 0; // film time where the current segment starts
for (const seg of SEGMENTS) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && console.error(`[${seg.name}] ${m.text()}`));
  page.on('pageerror', (e) => console.error(`[${seg.name}] ${e.message}`));
  await page.goto(seg.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.director?.ready, null, { timeout: 120_000 });
  const info = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return { duration: window.director.duration, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown' };
  });
  const frames = Math.round(info.duration * FPS);
  console.log(`${seg.name}: ${info.duration}s, ${frames} frames · ${info.gpu}`);
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    const t = (f + 1) / FPS;
    const want = STILLS?.filter((s) => s >= offset + t - 0.5 / FPS && s < offset + t + 0.5 / FPS);
    await page.evaluate((dt) => window.director.step(dt), 1 / FPS);
    if (STILLS) {
      for (const s of want) {
        const file = resolve(`video/stills/${seg.name}-${s.toFixed(1)}.jpg`);
        mkdirSync(dirname(file), { recursive: true });
        await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
        console.log(`  still ${file}`);
      }
      if (!STILLS.some((s) => s > offset + t)) break;
    } else {
      await write(await page.screenshot({ type: 'jpeg', quality: 95 }));
    }
    if (f % (FPS * 5) === 0) {
      const rate = (f + 1) / ((Date.now() - started) / 1000);
      process.stdout.write(`  ${seg.name} ${(t).toFixed(1)}s / ${info.duration}s · ${rate.toFixed(1)} frames/s\n`);
    }
  }
  const segCues = (await page.evaluate(() => window.director.cues ?? [])).map(([t, kind]) => [Number((offset + t).toFixed(3)), kind]);
  cues.push(...segCues);
  segments.push({ name: seg.name, start: offset, duration: frames / FPS });
  offset += frames / FPS;
  await page.close();
}
await browser.close();

if (ffmpeg) {
  ffmpeg.stdin.end();
  await new Promise((ok, fail) => ffmpeg.on('close', (code) => (code ? fail(new Error(`ffmpeg exited ${code}`)) : ok())));
  writeFileSync(OUT.replace(/\.mp4$/, '.cues.json'), JSON.stringify({ fps: FPS, duration: offset, segments, cues }, null, 1));
  console.log(`Wrote ${OUT} (${offset.toFixed(1)} s) and its cues`);
}
