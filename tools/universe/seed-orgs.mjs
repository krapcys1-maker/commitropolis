#!/usr/bin/env node
// Bakes organisation star systems: the org (the star), its repositories (megastructures) and its
// public members (worlds on the outer orbits). Also makes sure each org is a star in the galaxy.
//
//   GITHUB_TOKEN=$(gh auth token) node tools/universe/seed-orgs.mjs [org ...]
//
// Output: public/universe/orgs/<org>.json, public/universe/galaxy.json (patched)
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'public/universe';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('Set GITHUB_TOKEN (e.g. GITHUB_TOKEN=$(gh auth token))');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'commitverse-seed', Accept: 'application/vnd.github+json' };
const api = async (url) => {
  const res = await fetch(`https://api.github.com${url}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const ORGS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['microsoft', 'google', 'facebook', 'react', 'vercel', 'anthropics', 'openai', 'huggingface', 'pytorch', 'ollama', 'rust-lang', 'golang', 'nodejs', 'kubernetes'];

const compact = (r) => ({
  n: r.name,
  s: r.stargazers_count,
  f: r.forks_count,
  lang: r.language,
  kb: r.size,
  c: Math.round(Date.parse(r.created_at) / 1000),
  p: Math.round(Date.parse(r.pushed_at) / 1000),
  a: r.archived ? 1 : 0,
  d: (r.description ?? '').slice(0, 140),
  topics: (r.topics ?? []).slice(0, 6),
});

fs.mkdirSync(path.join(OUT, 'orgs'), { recursive: true });
const galaxyFile = path.join(OUT, 'galaxy.json');
const galaxy = JSON.parse(fs.readFileSync(galaxyFile, 'utf8'));

for (const login of ORGS) {
  const org = await api(`/orgs/${login}`);
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await api(`/orgs/${login}/repos?per_page=100&type=public&sort=pushed&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const members = await api(`/orgs/${login}/public_members?per_page=24`).catch(() => []);
  const own = repos.filter((r) => !r.fork).map(compact).sort((a, b) => b.s - a.s);
  const data = {
    login: org.login,
    id: org.id,
    type: 'Organization',
    name: org.name,
    bio: org.description,
    avatar: org.avatar_url,
    followers: org.followers,
    created: Math.round(Date.parse(org.created_at) / 1000),
    repos: own,
    members: members.map((m) => ({ l: m.login, avatar: m.avatar_url })),
  };
  fs.writeFileSync(path.join(OUT, 'orgs', `${org.login.toLowerCase()}.json`), JSON.stringify(data));
  const stars = own.reduce((s, r) => s + r.s, 0);

  // the org must be a star in the galaxy, with its full total
  const langs = {};
  for (const r of own) if (r.lang) langs[r.lang] = (langs[r.lang] ?? 0) + r.s;
  let a = galaxy.accounts.find((x) => x.l.toLowerCase() === org.login.toLowerCase());
  if (!a) {
    a = { l: org.login, i: org.id, t: 'O', s: 0, n: 0, lang: Object.entries(langs).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'Other', ai: 0, pushed: Math.max(...own.map((r) => r.p), 0), arch: 0, top: [], sector: 'titan' };
    galaxy.accounts.push(a);
  }
  a.t = 'O';
  a.s = Math.max(a.s, stars);
  a.n = Math.max(a.n, own.length);
  a.top = own.slice(0, 3).map((r) => r.n);
  console.log(`${org.login.padEnd(14)} ${own.length} repos, ${stars} ★, ${data.members.length} public members (sector ${a.sector})`);
}
galaxy.accounts.sort((x, y) => y.s - x.s);
fs.writeFileSync(galaxyFile, JSON.stringify(galaxy));
