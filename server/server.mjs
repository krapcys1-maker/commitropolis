#!/usr/bin/env node
// Commitverse mapping service: builds a city (full git history) for any public GitHub repository on
// request, so every world in the universe can be landed on.
//
//   node server/server.mjs                     (or: docker compose up -d, see server/README.md)
//
// Endpoints
//   GET  /health                 liveness + queue length
//   POST /api/map  {"repo":"owner/name"}   queue a repository; returns its job
//   GET  /api/map/:slug          job status: queued | mapping (with step) | done | error
//   GET  /api/city/:slug         the city bundle (JSON), once mapped
//
// Each job runs ingest/ingest.mjs in a child process (isolated memory, killable on timeout) and
// streams its progress steps back to the job record.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => process.env[k] ?? d;
const PORT = Number(env('PORT', 8787));
const DATA = path.resolve(env('DATA_DIR', path.join(here, '..', 'server-data', 'cities')));
const CACHE = path.resolve(env('CACHE_DIR', path.join(here, '..', 'server-data', 'cache')));
const ORIGIN = env('ALLOWED_ORIGIN', '*');
const MAX_REPO_MB = Number(env('MAX_REPO_MB', 400));
const CONCURRENCY = Number(env('CONCURRENCY', 1));
const FRESH_HOURS = Number(env('FRESH_HOURS', 24));
const JOB_TIMEOUT_MIN = Number(env('JOB_TIMEOUT_MIN', 15));
const RATE_PER_HOUR = Number(env('RATE_PER_HOUR', 20));
const TOKEN = env('GITHUB_TOKEN', '');
const INGEST = path.join(here, '..', 'ingest', 'ingest.mjs');

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const slugOf = (repo) => repo.toLowerCase().replace('/', '-');
const cityFile = (slug) => path.join(DATA, `${slug}.json`);

const jobs = new Map(); // slug -> job
const queue = [];
let running = 0;

function fresh(slug) {
  try {
    return Date.now() - fs.statSync(cityFile(slug)).mtimeMs < FRESH_HOURS * 3600e3;
  } catch {
    return false;
  }
}

// GitHub metadata check: exists, public, not too large. Uses the canonical name (handles renames).
async function inspect(repo) {
  const headers = { 'User-Agent': 'commitverse-mapper', Accept: 'application/vnd.github+json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (res.status === 404) throw Object.assign(new Error('Repository not found (or private)'), { code: 404 });
  if (!res.ok) throw Object.assign(new Error(`GitHub API error ${res.status}`), { code: 502 });
  const meta = await res.json();
  if (meta.private) throw Object.assign(new Error('Private repositories cannot be mapped here'), { code: 403 });
  if (meta.size / 1024 > MAX_REPO_MB) throw Object.assign(new Error(`Too large for this service (${Math.round(meta.size / 1024)} MB > ${MAX_REPO_MB} MB)`), { code: 413 });
  return { repo: meta.full_name, stars: meta.stargazers_count, sizeMb: Math.round(meta.size / 1024) };
}

function publicJob(job) {
  const { slug, repo, status, step, error, position, queuedAt, startedAt, finishedAt, stats } = job;
  return { slug, repo, status, step, error, position, queuedAt, startedAt, finishedAt, stats };
}

function pump() {
  queue.forEach((j, i) => (j.position = i + 1));
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    job.position = 0;
    run(job);
  }
}

function run(job) {
  running++;
  job.status = 'mapping';
  job.step = 'clone';
  job.startedAt = Date.now();
  const child = spawn(process.execPath, [INGEST, job.repo, '--out', DATA, '--cache', CACHE, '--progress', '--clean'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      try {
        const evt = JSON.parse(line);
        job.step = evt.step;
        if (evt.step === 'done') job.stats = { files: evt.files, commits: evt.commits, kb: evt.kb };
      } catch {
        /* not a progress line */
      }
    }
  });
  child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
  const timer = setTimeout(() => child.kill('SIGKILL'), JOB_TIMEOUT_MIN * 60e3);
  child.on('close', (code) => {
    clearTimeout(timer);
    running--;
    job.finishedAt = Date.now();
    if (code === 0 && fs.existsSync(cityFile(job.slug))) {
      job.status = 'done';
      job.step = 'done';
    } else {
      job.status = 'error';
      job.error = code === null ? 'Timed out' : (stderr.trim().split('\n').pop() || `ingest exited with ${code}`).slice(0, 300);
      fs.rmSync(path.join(CACHE, job.slug), { recursive: true, force: true });
    }
    console.log(`[${new Date().toISOString()}] ${job.repo}: ${job.status}${job.error ? ` (${job.error})` : ''}`);
    pump();
  });
}

// ---------------------------------------------------------------- http

const hits = new Map(); // ip -> timestamps
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3600e3);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_PER_HOUR;
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req, limit = 4096) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error('Body too large'), { code: 413 });
  }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? '').trim();
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, queue: queue.length, running });

    let m = url.pathname.match(/^\/api\/city\/([a-z0-9._-]+)$/);
    if (req.method === 'GET' && m) {
      const file = cityFile(m[1]);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'Not mapped yet' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': ORIGIN, 'Cache-Control': 'public, max-age=300' });
      return fs.createReadStream(file).pipe(res);
    }

    m = url.pathname.match(/^\/api\/map\/([a-z0-9._-]+)$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1]);
      if (job) return send(res, 200, publicJob(job));
      if (fs.existsSync(cityFile(m[1]))) return send(res, 200, { slug: m[1], status: 'done' });
      return send(res, 404, { slug: m[1], status: 'unknown' });
    }

    if (req.method === 'POST' && url.pathname === '/api/map') {
      const { repo } = await readBody(req);
      if (typeof repo !== 'string' || !REPO_RE.test(repo)) return send(res, 400, { error: 'Expected {"repo": "owner/name"}' });
      const slug = slugOf(repo);
      const existing = jobs.get(slug);
      if (existing && (existing.status === 'queued' || existing.status === 'mapping')) return send(res, 200, publicJob(existing));
      if (fresh(slug)) return send(res, 200, { slug, repo, status: 'done' });
      if (limited(ip)) return send(res, 429, { error: 'Too many requests, try again later' });
      const meta = await inspect(repo);
      const canonical = slugOf(meta.repo);
      if (canonical !== slug && fresh(canonical)) return send(res, 200, { slug: canonical, repo: meta.repo, status: 'done' });
      const job = { slug: canonical, repo: meta.repo, status: 'queued', step: 'queued', queuedAt: Date.now() };
      jobs.set(canonical, job);
      if (canonical !== slug) jobs.set(slug, job);
      queue.push(job);
      pump();
      return send(res, 202, publicJob(job));
    }

    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, err.code && err.code >= 400 && err.code < 600 ? err.code : 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Commitverse mapper on :${PORT} (data ${DATA})`));
