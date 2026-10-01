#!/usr/bin/env node
// Turns a Git repository into a city dataset for the viewer.
//
//   npm run ingest -- https://github.com/expressjs/express
//   npm run ingest -- facebook/react
//   npm run ingest -- ../some/local/repo
//
// Output: public/data/<slug>.json + an updated public/data/index.json
// Service mode (server/server.mjs): --out <dir> --cache <dir> --progress (JSON lines on stdout) --clean
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildTree, layoutCity } from './layout.mjs';

const args = process.argv.slice(2);
if (!args[0] || args[0].startsWith('--')) {
  console.error('usage: npm run ingest -- <github-url | owner/repo | local-path> [--out public/data]');
  process.exit(1);
}
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const outDir = opt('--out', 'public/data');
const cacheDir = opt('--cache', '.cache/repos');
const PROGRESS = args.includes('--progress');
const CLEAN = args.includes('--clean');
// --progress: machine-readable steps on stdout, human messages on stderr
const log = PROGRESS ? (m) => process.stderr.write(`${m}\n`) : (m) => console.log(m);
const step = (name, extra = {}) => PROGRESS && process.stdout.write(`${JSON.stringify({ step: name, ...extra })}\n`);

const IGNORE = [
  /(^|\/)(node_modules|vendor|third_party|dist|build)\//,
  /\.min\.(js|css)$/,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock)$/,
  /\.(png|jpe?g|gif|ico|svg|webp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp3|mp4|mov|wasm)$/i,
];
const ignored = (p) => IGNORE.some((re) => re.test(p));
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'core.quotepath=off', ...a], { cwd, maxBuffer: 1 << 30, encoding: 'utf8' });

function resolveRepo(src) {
  if (fs.existsSync(src)) {
    const dir = path.resolve(src);
    return { dir, slug: path.basename(dir).toLowerCase(), name: path.basename(dir), url: null };
  }
  const m = src.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/) || src.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error(`Not a GitHub URL, owner/repo or local path: ${src}`);
  const [owner, repo] = [m[1], m[2]];
  const url = `https://github.com/${owner}/${repo}`;
  const slug = `${owner}-${repo}`.toLowerCase();
  const dir = path.resolve(cacheDir, slug);
  if (fs.existsSync(path.join(dir, '.git'))) {
    log(`Updating ${dir}`);
    git(dir, 'pull', '--ff-only', '-q');
  } else {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    log(`Cloning ${url}`);
    step('clone');
    execFileSync('git', ['clone', '-q', '--single-branch', `${url}.git`, dir], { stdio: PROGRESS ? ['ignore', 'ignore', 'pipe'] : 'inherit' });
  }
  return { dir, slug, name: `${owner}/${repo}`, url };
}

function countLines(file) {
  let buf;
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) return null;
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  if (buf.subarray(0, 8000).includes(0)) return null; // binary
  let lines = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++;
  if (buf.length && buf[buf.length - 1] !== 10) lines++;
  return lines;
}

// numstat prints renames as "old => new" or "dir/{old => new}/file"
function parsePath(p) {
  if (!p.includes(' => ')) return { from: null, to: p };
  const m = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  const clean = (s) => s.replace(/\/{2,}/g, '/').replace(/^\//, '');
  if (m) return { from: clean(m[1] + m[2] + m[4]), to: clean(m[1] + m[3] + m[4]) };
  const [from, to] = p.split(' => ');
  return { from, to };
}

const repo = resolveRepo(args[0]);
const head = git(repo.dir, 'rev-parse', 'HEAD').trim();

// 1. Final state: every tracked text file and its line count.
step('scan');
const buildings = [];
for (const p of git(repo.dir, 'ls-files', '-z').split('\0')) {
  if (!p || ignored(p)) continue;
  const loc = countLines(path.join(repo.dir, p));
  if (loc === null) continue;
  buildings.push({ p, loc, alive: true });
}
log(`${buildings.length} files at HEAD`);
step('history', { files: buildings.length });

// 2. History, newest -> oldest. Each building is a file IDENTITY: renames are followed back
// so a file's whole life lands on one building, and files that were later deleted get
// buildings of their own. The timelapse can then show construction AND demolition, and
// mature repos don't look empty for their first years (in Express, 66% of all lines ever
// added live in paths that no longer exist).
const raw = git(repo.dir, '-c', 'diff.renameLimit=20000', 'log', '--no-merges', '-M', '--numstat',
  '--format=%x1e%H%x1f%at%x1f%aN%x1f%s', 'HEAD');
const alias = new Map(buildings.map((b, i) => [b.p, i]));
const authors = [];
const authorIndex = new Map();
const commits = [];
for (const chunk of raw.split('\x1e')) {
  if (!chunk.trim()) continue;
  const nl = chunk.indexOf('\n');
  const [hash, t, author, subject] = (nl < 0 ? chunk : chunk.slice(0, nl)).split('\x1f');
  const changes = [];
  for (const line of nl < 0 ? [] : chunk.slice(nl + 1).split('\n')) {
    if (!line) continue;
    const [add, del, p] = line.split('\t');
    if (add === '-') continue;
    const { from, to } = parsePath(p);
    let i = alias.get(to);
    if (i === undefined) {
      if (ignored(to)) continue;
      i = buildings.length;
      buildings.push({ p: to, loc: 0, alive: false });
      alias.set(to, i);
    }
    if (from !== null) {
      alias.delete(to);
      alias.set(from, i);
    }
    changes.push(i, Number(add), Number(del));
  }
  if (!changes.length) continue;
  if (!authorIndex.has(author)) {
    authorIndex.set(author, authors.length);
    authors.push(author);
  }
  commits.push({ h: hash.slice(0, 10), t: Number(t), a: authorIndex.get(author), s: subject.slice(0, 120), c: changes });
}
commits.reverse();

// 3. Replay forward once for per-building stats: peak size, churn, first/last touch.
const cur = new Float64Array(buildings.length);
for (const b of buildings) Object.assign(b, { peak: b.loc, c: 0, first: 0, last: 0 });
for (const commit of commits) {
  for (let k = 0; k < commit.c.length; k += 3) {
    const b = buildings[commit.c[k]];
    cur[commit.c[k]] = Math.max(0, cur[commit.c[k]] + commit.c[k + 1] - commit.c[k + 2]);
    b.peak = Math.max(b.peak, cur[commit.c[k]]);
    b.c++;
    if (!b.first) b.first = commit.t;
    b.last = commit.t;
  }
}

// Drop deleted files that never had content we can see (e.g. only touched by merges).
const keep = buildings.map((b) => b.alive || b.peak > 0);
const remap = new Int32Array(buildings.length).fill(-1);
const kept = [];
buildings.forEach((b, i) => {
  if (keep[i]) {
    remap[i] = kept.length;
    kept.push(b);
  }
});
for (const commit of commits) {
  const c = [];
  for (let k = 0; k < commit.c.length; k += 3) {
    if (remap[commit.c[k]] >= 0) c.push(remap[commit.c[k]], commit.c[k + 1], commit.c[k + 2]);
  }
  commit.c = c;
}
const alive = kept.filter((b) => b.alive).length;
log(`${commits.length} commits, ${alive} standing buildings, ${kept.length - alive} demolished`);
step('layout', { commits: commits.length, buildings: kept.length });

// 4. One layout for every building that ever existed, sized by peak, so nothing moves in the timelapse.
const layout = layoutCity(buildTree(kept.map((b) => ({ p: b.p, loc: b.peak }))), kept.length);
const unplaced = layout.files.filter((f) => !f).length;
if (unplaced) throw new Error(`Layout left ${unplaced} buildings without a lot`);
const files = kept.map((b, i) => ({
  p: b.p,
  loc: b.loc,
  peak: b.peak,
  alive: b.alive ? 1 : 0,
  c: b.c,
  first: b.first,
  last: b.last,
  ...layout.files[i],
}));

// 5. Events for the universe: release tags (rockets) and the biggest deletions (asteroid impacts).
const tagLines = git(repo.dir, 'for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:unix)', 'refs/tags')
  .split('\n')
  .filter(Boolean)
  .slice(0, 300)
  .map((l) => l.split('\t'))
  .map(([name, t]) => [name, Number(t)])
  .filter(([, t]) => t > 0);
const kept_commits = commits.filter((c) => c.c.length);
const impacts = kept_commits
  .map((c, i) => {
    let added = 0;
    let deleted = 0;
    for (let k = 0; k < c.c.length; k += 3) {
      added += c.c[k + 1];
      deleted += c.c[k + 2];
    }
    return { i, h: c.h, t: c.t, s: c.s, added, deleted };
  })
  .filter((x) => x.deleted >= 200 && x.deleted > x.added * 2)
  .sort((a, b) => b.deleted - a.deleted)
  .slice(0, 6);

const data = {
  version: 1,
  repo: { name: repo.name, url: repo.url, head, generatedAt: new Date().toISOString() },
  size: layout.size,
  districts: layout.districts,
  files,
  authors,
  commits: kept_commits,
  events: { tags: tagLines, impacts },
};

step('write');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${repo.slug}.json`);
fs.writeFileSync(outFile, JSON.stringify(data));

const indexFile = path.join(outDir, 'index.json');
const list = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
const entry = { slug: repo.slug, name: repo.name, files: alive, commits: data.commits.length };
fs.writeFileSync(indexFile, JSON.stringify([...list.filter((e) => e.slug !== repo.slug), entry], null, 2));

log(`Wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
if (CLEAN && repo.url) fs.rmSync(repo.dir, { recursive: true, force: true });
step('done', { slug: repo.slug, files: alive, commits: data.commits.length, kb: Math.round(fs.statSync(outFile).size / 1024) });
