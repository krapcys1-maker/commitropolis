#!/usr/bin/env node
// Seeds the Commitverse from the GitHub API: the top repositories in ~45 languages, AI topics and
// fast-rising new repos (protostars), aggregated into accounts (worlds); everyone who starred the
// project's own repo joins too. Run daily (.github/workflows/universe.yml), it also logs what moved:
// worlds that migrated to another galaxy, protostars that ignited into megastars.
// Bakes full planet data (profile + all repos) for a handful of showcase worlds.
//
//   GITHUB_TOKEN=$(gh auth token) node tools/universe/seed.mjs
//
// Output: public/universe/galaxy.json, public/universe/migrations.json, public/universe/planets/<login>.json
import fs from 'node:fs';
import path from 'node:path';
import { galaxyOf } from '../../src/universe/cosmos.js';
import { logMoves } from './migrations.mjs';

const OUT = 'public/universe';
if (process.argv.includes('--patch-only')) {
  patchGalaxyWithPlanets();
  process.exit(0);
}
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('Set GITHUB_TOKEN (e.g. GITHUB_TOKEN=$(gh auth token))');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'commitverse-seed', Accept: 'application/vnd.github+json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, { headers });
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const wait = Math.max(5000, reset - Date.now() + 1000);
      console.log(`  rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(Math.min(wait, 65000));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`gave up on ${url}`);
}

// Search API allows 30 requests/minute with a token.
async function search(q, pages = 1) {
  const items = [];
  for (let page = 1; page <= pages; page++) {
    const data = await api(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`);
    items.push(...data.items);
    await sleep(2200);
    if (data.items.length < 100) break;
  }
  return items;
}

// The big languages get several pages of results (up to 100 repos each), the rest one or two.
const BIG = ['JavaScript', 'TypeScript', 'Python', 'Rust', 'Go', 'Java', 'C++', 'C', 'C#', 'PHP', 'Ruby', 'Swift', 'Kotlin', 'Shell', 'Jupyter Notebook', 'Dart'];
const MID = ['Scala', 'Zig', 'Lua', 'Haskell', 'Elixir', 'HTML', 'Vue', 'CSS', 'Svelte', 'R', 'Julia', 'Objective-C', 'Perl', 'Clojure', 'Cuda'];
const SMALL = ['OCaml', 'Erlang', 'Nim', 'Crystal', 'Assembly', 'PowerShell', 'Groovy', 'F#', 'Elm', 'Gleam', 'Vim Script', 'Emacs Lisp', 'Racket', 'Solidity', 'Nix'];
const PAGES = Number(process.env.SEED_PAGES ?? 5);
const LANGUAGES = [...BIG.map((l) => [l, PAGES]), ...MID.map((l) => [l, 2]), ...SMALL.map((l) => [l, 1])];
const AI_TOPICS = ['llm', 'machine-learning', 'deep-learning', 'ai-agents', 'generative-ai', 'large-language-models'];
const AI_RE = /(^|-)(ai|llm|llms|gpt|ml|machine-learning|deep-learning|neural|transformer|transformers|agent|agents|rag|diffusion|generative-ai|langchain|pytorch|tensorflow|nlp)($|-)/;

const repos = new Map();
const tags = new Map(); // full_name -> Set of reasons
function add(items, reason) {
  for (const r of items) {
    if (r.fork) continue;
    repos.set(r.full_name, r);
    if (!tags.has(r.full_name)) tags.set(r.full_name, new Set());
    tags.get(r.full_name).add(reason);
  }
}

console.log('Seeding languages…');
for (const [lang, pages] of LANGUAGES) {
  add(await search(`language:"${lang}" stars:>${pages > 1 ? 300 : 100}`, pages), `lang:${lang}`);
  console.log(`  ${lang}: ${repos.size} repos so far`);
}
console.log('Seeding the AI Galaxy…');
for (const topic of AI_TOPICS) add(await search(`topic:${topic} stars:>300`, 2), 'ai');
console.log('Seeding the Rising Galaxy…');
const since = new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10);
const nurseryItems = await search(`created:>${since} stars:>200`, 5);
add(nurseryItems, 'nursery');

// Everyone who starred this project's repo gets a world in the Commitverse.
const JOIN_REPO = process.env.JOIN_REPO ?? process.env.GITHUB_REPOSITORY ?? 'krapcys1-maker/commitverse';
const stargazers = [];
try {
  for (let page = 1; page <= 10; page++) {
    const batch = await api(`/repos/${JOIN_REPO}/stargazers?per_page=100&page=${page}`);
    stargazers.push(...batch);
    if (batch.length < 100) break;
  }
} catch (err) {
  console.log(`  no stargazers (${err.message})`);
}
const joinedLogins = new Set(stargazers.map((u) => u.login));
const known = new Set([...repos.values()].map((r) => r.owner.login));
const newcomers = stargazers.filter((u) => !known.has(u.login)).slice(0, Number(process.env.JOIN_MAX ?? 400));
console.log(`Joining: ${stargazers.length} stargazers of ${JOIN_REPO}, ${newcomers.length} new worlds`);
const bare = []; // stargazers without public repos still get a (barren) world
for (const u of newcomers) {
  const own = (await api(`/users/${u.login}/repos?per_page=100&type=owner&sort=pushed`).catch(() => [])).filter((r) => !r.fork);
  if (own.length) add(own, 'joined');
  else bare.push(u);
}

// ---- aggregate accounts (worlds)
const accounts = new Map();
for (const r of repos.values()) {
  const o = r.owner;
  const a = accounts.get(o.login) ?? { l: o.login, i: o.id, t: o.type === 'Organization' ? 'O' : 'U', s: 0, n: 0, langs: {}, ai: 0, pushed: 0, archived: 0, top: [] };
  const stars = r.stargazers_count;
  a.s += stars;
  a.n++;
  if (r.language) a.langs[r.language] = (a.langs[r.language] ?? 0) + stars;
  const topicText = [...(r.topics ?? []), r.name.toLowerCase()].join(' ');
  if (tags.get(r.full_name).has('ai') || (r.topics ?? []).some((t) => AI_RE.test(t)) || AI_RE.test(r.name.toLowerCase())) a.ai += stars;
  a.pushed = Math.max(a.pushed, Date.parse(r.pushed_at) / 1000);
  if (r.archived) a.archived += stars;
  a.top.push([r.name, stars]);
  accounts.set(o.login, a);
}

const now = Date.now() / 1000;
const list = [...accounts.values()].map((a) => {
  const lang = Object.entries(a.langs).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'Other';
  const top = a.top.sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n]) => n);
  const world = { l: a.l, i: a.i, t: a.t, s: a.s, n: a.n, lang, ai: +(a.ai / Math.max(a.s, 1)).toFixed(2), pushed: Math.round(a.pushed), arch: +(a.archived / Math.max(a.s, 1)).toFixed(2), top };
  if (joinedLogins.has(a.l)) world.joined = 1;
  return world;
});
for (const u of bare) list.push({ l: u.login, i: u.id, t: u.type === 'Organization' ? 'O' : 'U', s: 0, n: 0, lang: 'Other', ai: 0, pushed: Math.round(now), arch: 0, top: [], joined: 1 });

// ---- sectors (see docs/LORE.md): data rules, in priority order
const orgsByStars = list.filter((a) => a.t === 'O').sort((x, y) => y.s - x.s);
const titans = new Set(orgsByStars.slice(0, 24).filter((a) => a.ai < 0.5).map((a) => a.l));
const idCut = list.map((a) => a.i).sort((x, y) => x - y)[Math.floor(list.length * 0.08)];
// AI labs belong to the AI Nebula even when their repos aren't tagged as AI (docs/LORE.md).
const AI_ORGS = new Set(['anthropics', 'openai', 'huggingface', 'pytorch', 'ollama', 'google-deepmind', 'deepseek-ai', 'meta-llama', 'mistralai', 'langchain-ai', 'ggml-org', 'qwenlm', 'lm-sys', 'vllm-project', 'unslothai']);
for (const a of list) {
  if (AI_ORGS.has(a.l.toLowerCase())) a.sector = 'ai';
  else if (a.joined && a.s < 2000) a.sector = 'arm'; // a newcomer starts in its language's galaxy
  else if (a.arch > 0.8 || now - a.pushed > 2 * 365 * 86400) a.sector = 'silent';
  else if (a.ai >= 0.5 && a.s >= 2000) a.sector = 'ai';
  else if (titans.has(a.l)) a.sector = 'titan';
  else if (a.i <= idCut && a.s >= 5000) a.sector = 'ancient';
  else a.sector = 'arm';
}

const nursery = nurseryItems
  .filter((r) => !r.fork)
  .map((r) => ({ r: r.full_name, s: r.stargazers_count, c: Math.round(Date.parse(r.created_at) / 1000), lang: r.language ?? 'Other', ai: AI_RE.test([...(r.topics ?? []), r.name.toLowerCase()].join(' ')) ? 1 : 0 }))
  .sort((x, y) => y.s - x.s)
  .slice(0, 400);

// Account ages: GitHub user IDs are sequential, so a few real creation dates date every world (cosmos.js).
const galaxyFile = path.join(OUT, 'galaxy.json');
const prev = fs.existsSync(galaxyFile) ? JSON.parse(fs.readFileSync(galaxyFile, 'utf8')) : null;
const byId = [...list].sort((x, y) => x.i - y.i);
const anchors = new Map((prev?.ages ?? []).map(([i, t]) => [i, t]));
for (let k = 0; k <= 15; k++) {
  const a = byId[Math.round((k / 15) * (byId.length - 1))];
  if ([...anchors.keys()].some((i) => Math.abs(i - a.i) < a.i * 0.02)) continue;
  try {
    anchors.set(a.i, Math.round(Date.parse((await api(`/users/${a.l}`)).created_at) / 1000));
  } catch {}
}
const ages = [...anchors].sort((x, y) => x[0] - y[0]);

fs.mkdirSync(path.join(OUT, 'planets'), { recursive: true });
const galaxy = { version: 1, generatedAt: new Date().toISOString(), joinRepo: JOIN_REPO, accounts: list.sort((x, y) => y.s - x.s), nursery, ages };
fs.writeFileSync(galaxyFile, JSON.stringify(galaxy));
const counts = list.reduce((m, a) => ((m[a.sector] = (m[a.sector] ?? 0) + 1), m), {});
const galaxies = list.reduce((m, a) => ((m[galaxyOf(a)] = (m[galaxyOf(a)] ?? 0) + 1), m), {});
console.log(`Galaxy: ${list.length} worlds from ${repos.size} repos, ${nursery.length} protostars`, counts);
console.log('  by galaxy', galaxies);

// ---- planets: full profile + all public repos for showcase worlds
const SHOWCASE = (process.env.PLANETS ?? 'karpathy,torvalds,sindresorhus,tj,antirez,yyx990803,gaearon,mitchellh,simonw,ggerganov,rich-harris,dhh').split(',');
for (const login of SHOWCASE) {
  const user = await api(`/users/${login}`);
  const all = [];
  for (let page = 1; page <= 15; page++) {
    const batch = await api(`/users/${login}/repos?per_page=100&type=owner&sort=pushed&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  const planet = {
    login: user.login,
    id: user.id,
    type: user.type,
    name: user.name,
    bio: user.bio,
    avatar: user.avatar_url,
    followers: user.followers,
    created: Math.round(Date.parse(user.created_at) / 1000),
    repos: all
      .filter((r) => !r.fork)
      .map((r) => ({
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
      }))
      .sort((x, y) => y.s - x.s),
    forks: all.filter((r) => r.fork).length,
  };
  fs.writeFileSync(path.join(OUT, 'planets', `${user.login.toLowerCase()}.json`), JSON.stringify(planet));
  console.log(`Planet ${user.login}: ${planet.repos.length} repos, ${planet.repos.reduce((s, r) => s + r.s, 0)} stars`);
}

// Showcase worlds know their full totals: let the galaxy agree with the planet view.
patchGalaxyWithPlanets();

// What moved since the last chart, now that every total is final (migrations.mjs).
const log = logMoves(prev, JSON.parse(fs.readFileSync(galaxyFile, 'utf8')));
console.log(`${log.events.length} events in the migration log`);

function patchGalaxyWithPlanets() {
  const AI = /(^|-)(ai|llm|llms|gpt|ml|machine-learning|deep-learning|neural|transformer|transformers|agent|agents|rag|diffusion|generative-ai|langchain|pytorch|tensorflow|nlp)($|-)/;
  const file = path.join(OUT, 'galaxy.json');
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const idCut = g.accounts.map((a) => a.i).sort((x, y) => x - y)[Math.floor(g.accounts.length * 0.08)];
  const now = Date.now() / 1000;
  for (const f of fs.readdirSync(path.join(OUT, 'planets'))) {
    const p = JSON.parse(fs.readFileSync(path.join(OUT, 'planets', f), 'utf8'));
    const stars = p.repos.reduce((sum, r) => sum + r.s, 0);
    let a = g.accounts.find((x) => x.l.toLowerCase() === p.login.toLowerCase());
    if (!a) {
      // a showcase world the seed missed: derive it with the same sector rules
      const langs = {};
      let ai = 0;
      let archived = 0;
      let pushed = 0;
      for (const r of p.repos) {
        if (r.lang) langs[r.lang] = (langs[r.lang] ?? 0) + r.s;
        if ((r.topics ?? []).some((t) => AI.test(t)) || AI.test(r.n.toLowerCase())) ai += r.s;
        if (r.a) archived += r.s;
        pushed = Math.max(pushed, r.p);
      }
      a = { l: p.login, i: p.id, t: p.type === 'Organization' ? 'O' : 'U', s: 0, n: 0, lang: Object.entries(langs).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'Other', ai: +(ai / Math.max(stars, 1)).toFixed(2), pushed, arch: +(archived / Math.max(stars, 1)).toFixed(2), top: [] };
      a.sector = a.arch > 0.8 || now - a.pushed > 2 * 365 * 86400 ? 'silent' : a.ai >= 0.5 && stars >= 2000 ? 'ai' : a.i <= idCut && stars >= 5000 ? 'ancient' : 'arm';
      g.accounts.push(a);
      console.log(`  added ${p.login} to the galaxy (${a.sector})`);
    }
    a.s = Math.max(a.s, stars);
    a.n = Math.max(a.n, p.repos.length);
    a.top = p.repos.slice(0, 3).map((r) => r.n);
  }
  g.accounts.sort((x, y) => y.s - x.s);
  fs.writeFileSync(file, JSON.stringify(g));
}
