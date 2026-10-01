#!/usr/bin/env node
// The migration log of the Commitverse: what moved between two charts of the universe. Worlds that
// changed galaxy, newcomers who joined by starring the repo, protostars that ignited into megastars
// (src/universe/cosmos.js decides the galaxies). seed.mjs calls this after every reseed; by hand:
//
//   node tools/universe/migrations.mjs <previous galaxy.json> [current galaxy.json]
import fs from 'node:fs';
import { galaxyOf, MEGASTAR } from '../../src/universe/cosmos.js';

export const LOG_FILE = 'public/universe/migrations.json';

export function logMoves(prev, next, file = LOG_FILE, t = Math.round(Date.now() / 1000)) {
  const log = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { events: [] };
  if (prev) {
    const was = new Map(prev.accounts.map((a) => [a.l.toLowerCase(), galaxyOf(a)]));
    for (const a of next.accounts) {
      const before = was.get(a.l.toLowerCase());
      const after = galaxyOf(a);
      if (before && before !== after) log.events.push({ type: 'migration', t, login: a.l, from: before, to: after, s: a.s });
      else if (!before && a.joined) log.events.push({ type: 'joined', t, login: a.l, to: after, s: a.s });
    }
    const wasStars = new Map(prev.nursery.map((p) => [p.r, p.s]));
    for (const p of next.nursery) {
      if (p.s >= MEGASTAR && (wasStars.get(p.r) ?? 0) < MEGASTAR) log.events.push({ type: 'ignition', t, repo: p.r, login: p.r.split('/')[0], from: 'rising', to: 'titan', s: p.s });
    }
  }
  log.events = log.events.slice(-400);
  log.generatedAt = new Date(t * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(log));
  return log;
}

if (process.argv[1]?.endsWith('migrations.mjs')) {
  const [prevFile, nextFile = 'public/universe/galaxy.json'] = process.argv.slice(2);
  if (!prevFile) {
    console.error('usage: node tools/universe/migrations.mjs <previous galaxy.json> [current galaxy.json]');
    process.exit(1);
  }
  const log = logMoves(JSON.parse(fs.readFileSync(prevFile, 'utf8')), JSON.parse(fs.readFileSync(nextFile, 'utf8')));
  console.log(`${log.events.length} events in ${LOG_FILE}`);
}
