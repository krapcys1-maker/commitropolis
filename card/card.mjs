#!/usr/bin/env node
// Your world in the Commitverse, as an animated SVG for your GitHub profile README.
//
//   GITHUB_TOKEN=... node card/card.mjs <login> [out.svg]
//
// Used by the GitHub Action (card/action.yml), or run it yourself. Without a token GitHub allows 60
// requests an hour, which is plenty for one card.
import fs from 'node:fs';
import path from 'node:path';
import { worldCard, worldOf } from '../src/card.js';

const [login, out = 'commitverse-world.svg'] = process.argv.slice(2);
if (!login) {
  console.error('usage: node card/card.mjs <login> [out.svg]');
  process.exit(1);
}
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'commitverse-card' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const api = async (p) => {
  const res = await fetch(`https://api.github.com${p}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${p}`);
  return res.json();
};

const user = await api(`/users/${encodeURIComponent(login)}`);
const repos = [];
for (let page = 1; page <= 10; page++) {
  const batch = await api(`/users/${encodeURIComponent(login)}/repos?per_page=100&type=owner&sort=pushed&page=${page}`);
  repos.push(...batch);
  if (batch.length < 100) break;
}
const world = worldOf(
  user,
  repos.map((r) => ({ n: r.name, s: r.stargazers_count, lang: r.language, p: Math.round(Date.parse(r.pushed_at) / 1000), a: r.archived ? 1 : 0, fork: r.fork, topics: r.topics ?? [] }))
);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, worldCard(world));
console.log(`${out}: @${world.login}, Level ${world.level.level} ${world.level.name} in ${world.galaxy.name} (${world.stars} ★, ${world.cities} cities)`);
