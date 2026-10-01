#!/usr/bin/env node
// The galactic news: real events turned into phenomena (docs/LORE.md).
//   supernova  a protostar gaining stars faster than any other   (galaxy.json nursery)
//   launch     a release tag in a mapped city                     (public/data/*.json events.tags)
//   impact     a commit that deleted a huge part of a city        (public/data/*.json events.impacts)
//
//   node tools/universe/events.mjs      ->  public/universe/events.json
import fs from 'node:fs';
import path from 'node:path';

const DATA = 'public/data';
const OUT = 'public/universe/events.json';
const now = Date.now() / 1000;
const events = [];

const galaxy = JSON.parse(fs.readFileSync('public/universe/galaxy.json', 'utf8'));
const supernovae = galaxy.nursery
  .map((p) => ({ ...p, perDay: p.s / Math.max(1, (now - p.c) / 86400) }))
  .sort((a, b) => b.perDay - a.perDay)
  .slice(0, 12);
for (const p of supernovae) {
  events.push({
    type: 'supernova',
    t: p.c,
    repo: p.r,
    title: `Supernova: ${p.r}`,
    detail: `${Math.round(p.perDay).toLocaleString('en-US')} ★ a day since it was born (${p.s.toLocaleString('en-US')} ★ in total)`,
    target: { planet: p.r.split('/')[0] },
  });
}

for (const file of fs.readdirSync(DATA)) {
  if (!file.endsWith('.json') || file === 'index.json') continue;
  const city = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
  const slug = file.replace(/\.json$/, '');
  const repo = city.repo.name;
  const owner = repo.split('/')[0];
  const tags = city.events?.tags ?? [];
  const recent = tags.filter(([, t]) => now - t < 120 * 86400).slice(0, 3);
  for (const [name, t] of recent.length ? recent : tags.slice(0, 1)) {
    events.push({ type: 'launch', t, repo, slug, tag: name, title: `Launch: ${repo} ${name}`, detail: `A rocket lifts off from ${repo.split('/')[1]}`, target: { city: slug, from: owner } });
  }
  for (const imp of (city.events?.impacts ?? []).slice(0, 2)) {
    events.push({
      type: 'impact',
      t: imp.t,
      repo,
      slug,
      title: `Impact in ${repo}`,
      detail: `“${imp.s}” wiped out ${imp.deleted.toLocaleString('en-US')} lines`,
      target: { city: slug, from: owner },
    });
  }
}

events.sort((a, b) => b.t - a.t);
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), events }));
const by = events.reduce((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
console.log(`Wrote ${OUT}: ${events.length} events`, by);
