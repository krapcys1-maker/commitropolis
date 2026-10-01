import * as THREE from 'three';
import { hashString, rng, langColor } from './lore.js';

// The galaxies themselves (who lives where) are in galaxies.js, which has no three.js in it, so the
// README card (src/card.js) and the seed can use the same rules in Node.
export { MEGASTAR, GALAXIES, GALAXY, familyOf, galaxyOf, galaxyOfRepos } from './galaxies.js';
import { MEGASTAR, GALAXIES, GALAXY, familyOf, galaxyOf } from './galaxies.js';

// ---------------------------------------------------------------- data

let cosmos = null;
export function loadCosmos() {
  cosmos ??= (async () => {
    const json = (r) => ((r.headers.get('content-type') ?? '').includes('json') ? r.json() : {});
    const [data, events, moves] = await Promise.all([
      fetch('universe/galaxy.json').then((r) => r.json()),
      fetch('universe/events.json').then(json).catch(() => ({})),
      fetch('universe/migrations.json').then(json).catch(() => ({})),
    ]);
    const accounts = data.accounts.map((a) => ({ ...a }));
    const byLogin = new Map(accounts.map((a) => [a.l.toLowerCase(), a]));
    // a protostar that grew into a megastar has left the Rising Galaxy for the Titans, with its world
    const rising = [];
    const promoted = [];
    for (const p of data.nursery) {
      if (p.s < MEGASTAR) {
        rising.push(p);
        continue;
      }
      const [owner, name] = p.r.split('/');
      let a = byLogin.get(owner.toLowerCase());
      if (!a) {
        a = { l: owner, i: 0, t: '', s: p.s, n: 1, lang: p.lang ?? 'Other', ai: p.ai ?? 0, pushed: p.c, arch: 0, top: [name], sector: 'arm', born: 1970 + p.c / 31557600 };
        accounts.push(a);
        byLogin.set(owner.toLowerCase(), a);
      }
      a.s = Math.max(a.s, p.s);
      a.promoted = { repo: p.r, stars: p.s, born: p.c };
      promoted.push(a);
    }
    const members = Object.fromEntries(GALAXIES.map((g) => [g.id, []]));
    for (const a of accounts) members[(a.g = galaxyOf(a))].push(a);
    for (const list of Object.values(members)) list.sort((x, y) => y.s - x.s);
    promoted.sort((x, y) => y.promoted.stars - x.promoted.stars);
    // what moved, as logged by the daily seed (tools/universe/seed.mjs): migrations, newcomers, ignitions
    const name = (id) => GALAXY[id]?.name ?? id;
    const logged = (moves.events ?? [])
      .slice()
      .reverse()
      .map((m) =>
        m.type === 'ignition'
          ? { ...m, title: `${m.repo} ignited`, detail: `${m.s.toLocaleString('en-US')} ★: it left the Rising Galaxy for the Titans`, target: { planet: m.login } }
          : m.type === 'joined'
            ? { ...m, title: `@${m.login} joined the Commitverse`, detail: `a new world in ${name(m.to)}`, target: { planet: m.login } }
            : { ...m, title: `@${m.login} migrated`, detail: `from ${name(m.from)} to ${name(m.to)}`, target: { planet: m.login } }
      );
    const ignited = new Set(logged.filter((m) => m.type === 'ignition').map((m) => m.repo));
    const news = [
      ...logged,
      // megastars the log hasn't seen ignite yet (the first run, or before the log existed)
      ...promoted.filter((a) => !ignited.has(a.promoted.repo)).map((a) => ({ type: 'ignition', t: Date.parse(data.generatedAt) / 1000, title: `${a.promoted.repo} ignited`, detail: `${a.promoted.stars.toLocaleString('en-US')} ★: it left the Rising Galaxy for the Titans`, target: { planet: a.l } })),
      ...(events.events ?? []),
    ];
    // recent journeys between galaxies, drawn as comets in the cluster (universeView.js)
    const month = Date.now() / 1000 - 45 * 86400;
    // the brightest moves first: ignitions, then big worlds changing galaxy (small moves stay in the news)
    const journeys = [
      ...logged.filter((m) => m.from && m.to && m.from !== m.to && m.t > month && (m.type === 'ignition' || m.s >= 20000)).map((m) => ({ from: m.from, to: m.to, label: m.repo ?? `@${m.login}`, stars: m.s, login: m.login, ignition: m.type === 'ignition' })),
      ...promoted.filter((a) => !ignited.has(a.promoted.repo)).map((a) => ({ from: 'rising', to: 'titan', label: a.promoted.repo, stars: a.promoted.stars, login: a.l, ignition: true })),
    ]
      .sort((x, y) => (y.ignition - x.ignition) || y.stars - x.stars)
      .slice(0, 12);
    const joined = accounts.filter((a) => a.joined);
    return { data, accounts, byLogin, members, rising, promoted, joined, journeys, news, generatedAt: data.generatedAt };
  })();
  return cosmos;
}

export async function accountOf(login) {
  return (await loadCosmos()).byLogin.get(login.toLowerCase()) ?? null;
}

// Which galaxy a login lives in. An account we haven't charted joins the Titans if it's that bright,
// otherwise the family of its main language.
export async function galaxyIdOf(login, lang, stars = 0) {
  const a = await accountOf(login);
  if (a) return a.g;
  return stars >= MEGASTAR ? 'titan' : familyOf(lang);
}

// Account creation year from its ID, interpolated between real anchors (galaxy.json ages).
export function yearOfId(ages, id) {
  ages ??= [[1, 1192857859], [225000000, 1754483107]];
  let k = 1;
  while (k < ages.length - 1 && ages[k][0] < id) k++;
  const [i0, t0] = ages[k - 1];
  const [i1, t1] = ages[k];
  const t = t0 + ((id - i0) / (i1 - i0)) * (t1 - t0);
  return Math.min(2026.8, 1970 + t / 31557600);
}

// ---------------------------------------------------------------- shapes

export const gauss = (rand) => {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};
export const armAngle = (arm, r, R, arms, pitch = 2.1) => (arm / arms) * Math.PI * 2 + pitch * Math.log(Math.max(r, R * 0.02) / (R * 0.08));

// the star-forming knots of an irregular galaxy, fixed per galaxy
export function knotsOf(spec, R) {
  const rand = rng(hashString(`${spec.id}:knots`));
  return Array.from({ length: spec.knots ?? 8 }, () => {
    const a = rand() * Math.PI * 2;
    const r = R * (0.15 + rand() * 0.6);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.75, s: R * (0.07 + rand() * 0.1) };
  });
}

// One point of a galaxy's dust: where it is, which arm, and how far out (0..1).
export function sampleDust(spec, rand, R, knots) {
  if (spec.shape === 'elliptical') {
    const r = Math.min(R, Math.abs(gauss(rand)) * R * 0.36);
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    return { x: Math.sin(ph) * Math.cos(th) * r, y: Math.cos(ph) * r * 0.58, z: Math.sin(ph) * Math.sin(th) * r * 0.85, arm: 0, f: r / R };
  }
  if (spec.shape === 'irregular') {
    if (rand() < 0.62) {
      const k = knots[Math.floor(rand() * knots.length)];
      const x = k.x + gauss(rand) * k.s;
      const z = k.z + gauss(rand) * k.s;
      return { x, y: gauss(rand) * k.s * 0.35, z, arm: 1, f: Math.hypot(x, z) / R };
    }
    const r = Math.abs(gauss(rand)) * R * 0.42;
    const a = rand() * Math.PI * 2;
    return { x: Math.cos(a) * r * 1.2, y: gauss(rand) * R * 0.04, z: Math.sin(a) * r * 0.8, arm: 0, f: r / R };
  }
  const arms = spec.arms ?? 4;
  if (rand() < 0.16) {
    const r = Math.abs(gauss(rand)) * R * 0.12;
    const a = rand() * Math.PI * 2;
    return { x: Math.cos(a) * r, y: gauss(rand) * R * 0.035 * Math.max(0, 1 - r / (R * 0.4)), z: Math.sin(a) * r, arm: -1, f: r / R };
  }
  if (spec.shape === 'barred' && rand() < 0.18) {
    const u = (rand() * 2 - 1) * R * 0.3;
    return { x: u, y: gauss(rand) * R * 0.01, z: gauss(rand) * R * 0.035, arm: -1, f: Math.abs(u) / R };
  }
  const arm = Math.floor(rand() * arms);
  const r = R * (0.08 + Math.pow(rand(), 0.7) * 0.92);
  const a = armAngle(arm, r, R, arms, spec.pitch) + gauss(rand) * 0.22 * (1.1 - (r / R) * 0.4);
  const spread = gauss(rand) * R * 0.025;
  return { x: Math.cos(a) * r + spread, y: gauss(rand) * R * 0.012, z: Math.sin(a) * r + spread, arm, f: r / R };
}

// The colour of a dust grain: the galaxy's light, by arm for galaxies of several languages.
export function dustColor(spec, arm, f, rand, out = new THREE.Color()) {
  const base = spec.langs && arm >= 0 ? langColor(spec.langs[arm % spec.langs.length]) : spec.color;
  out.set(base);
  if (arm === -1 || (spec.shape === 'elliptical' && f < 0.15)) out.lerp(new THREE.Color('#ffe2b0'), 0.6);
  else out.lerp(new THREE.Color('#dfe8ff'), 0.4 + rand() * 0.3);
  return out;
}

// Where each member world sits in its galaxy: older worlds nearer the core on spirals (the galaxy grew
// outward with GitHub), the brightest at the heart of an elliptical. Deterministic per account.
export function placeMembers(accounts, spec, R, yearOf) {
  const langs = spec.langs ?? [];
  const knots = spec.shape === 'irregular' ? knotsOf(spec, R) : null;
  return accounts.map((a, k) => {
    const rand = rng(hashString(`${spec.id}:${a.l}`));
    if (spec.shape === 'elliptical') {
      // the brightest near the heart, but not on top of each other: their beacons must stay readable
      const rank = accounts.length > 1 ? k / (accounts.length - 1) : 0;
      const r = R * (0.2 + Math.pow(rank, 0.75) * 0.62);
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      return new THREE.Vector3(Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r * 0.5, Math.sin(ph) * Math.sin(th) * r * 0.85);
    }
    if (knots) {
      const kn = knots[Math.floor(rand() * knots.length)];
      return new THREE.Vector3(kn.x + gauss(rand) * kn.s * 0.8, gauss(rand) * kn.s * 0.3, kn.z + gauss(rand) * kn.s * 0.8);
    }
    const arms = spec.arms ?? 4;
    const age = Math.min(1, Math.max(0, (yearOf(a) - 2007.6) / 19));
    const r = R * (0.1 + Math.pow(age, 0.85) * 0.82);
    const li = langs.indexOf(a.lang);
    const arm = li >= 0 ? li % arms : Math.floor(rand() * arms);
    const ang = armAngle(arm, r, R, arms, spec.pitch) + gauss(rand) * 0.1;
    return new THREE.Vector3(Math.cos(ang) * r + gauss(rand) * 12, gauss(rand) * 8, Math.sin(ang) * r + gauss(rand) * 12);
  });
}

// Where the galaxies hang in the Commitverse: the Titans at the centre around git, the rest on a
// loose ring, the Rising Galaxy close by (its stars migrate in), the Silent Galaxy far out.
export function universeLayout() {
  const out = {};
  let k = 0;
  for (const g of GALAXIES) {
    const rand = rng(hashString(`${g.id}:place`));
    let pos;
    if (g.id === 'titan') pos = new THREE.Vector3(0, 0, 0);
    else if (g.id === 'rising') pos = new THREE.Vector3(-1750, 1300, 3850); // in a gap of the ring, near the Titans
    else if (g.id === 'archive') pos = new THREE.Vector3(-9800, -1600, -6000);
    else {
      const a = k++ * 2.39996 + 0.6;
      const r = 5600 + rand() * 2600;
      pos = new THREE.Vector3(Math.cos(a) * r, (rand() - 0.5) * 3000, Math.sin(a) * r);
    }
    // mostly face-on, so their arms show from the usual viewpoint above the cluster
    out[g.id] = { pos, tilt: new THREE.Euler((rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.6) };
  }
  out.titan.tilt = new THREE.Euler(0.35, 0, 0.15);
  return out;
}
