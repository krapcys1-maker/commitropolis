import { levelOf, langColor, worldStyle, hashString, rng } from './universe/lore.js';
import { GALAXY, galaxyOfRepos } from './universe/galaxies.js';

// "My world in the Commitverse": an animated SVG card for a GitHub profile README. The planet wears
// its main language's climate and atmosphere; its level of civilisation adds a moon, rockets, an
// orbital ring; its night side glows with one light per city. Pure string building, so the same code
// runs in the browser (the share panel) and in Node (card/card.mjs, the GitHub Action).

export const SITE = 'https://krapcys1-maker.github.io/commitverse/';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// What the card needs, from a user (or org) and their public repositories in the shape the universe
// uses: { n: name, s: stars, lang, p: last push (unix), a: archived, topics }.
export function worldOf(user, repos) {
  const own = repos.filter((r) => !r.fork);
  const stars = own.reduce((s, r) => s + r.s, 0);
  const langs = {};
  for (const r of own) if (r.lang) langs[r.lang] = (langs[r.lang] ?? 0) + r.s;
  const languages = Object.entries(langs).sort((x, y) => y[1] - x[1]);
  return {
    login: user.login,
    name: user.name,
    type: user.type,
    followers: user.followers ?? 0,
    stars,
    cities: own.length,
    level: levelOf(stars),
    galaxy: GALAXY[galaxyOfRepos(own)],
    languages: languages.map(([l]) => l),
    top: [...own].sort((x, y) => y.s - x.s).slice(0, 3).map((r) => r.n),
    lastPush: Math.max(0, ...own.map((r) => r.p ?? 0)),
  };
}

export function worldCard(w, { width = 720, height = 250 } = {}) {
  const rand = rng(hashString(`${w.login}:card`));
  const main = w.languages[0] ?? 'Other';
  const style = worldStyle(main);
  const atmo = langColor(main);
  const lv = w.level.level;
  const R = 78;
  const cx = 150;
  const cy = 125;
  const seed = Math.floor(hashString(w.login) * 999);
  const active = Date.now() / 1000 - w.lastPush < 30 * 86400;

  // the sky: seeded stars, some of them twinkling
  const stars = Array.from({ length: 70 }, (_, i) => {
    const x = rand() * width;
    const y = rand() * height;
    const r = 0.4 + rand() * 1.1;
    const tw = rand() < 0.35 ? ` class="tw" style="animation-delay:${(rand() * 4).toFixed(2)}s"` : '';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.25 + rand() * 0.6).toFixed(2)}"${tw}/>`;
  }).join('');

  // city lights on the night side: one per city, up to 36, more for the busiest worlds
  const lights = Array.from({ length: Math.min(36, Math.max(2, w.cities)) }, () => {
    const a = (-0.25 + rand() * 1.3) * Math.PI; // the dark limb, bottom right
    const d = Math.sqrt(rand()) * R * 0.92;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const night = (x - cx) * 0.75 + (y - cy) * 0.66; // only where the shade falls
    if (night < R * 0.18) return '';
    const r = 1 + rand() * 1.9;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#ffd38a" class="city" style="animation-delay:${(rand() * 3).toFixed(2)}s"/>`;
  }).join('');

  // the ring of a spacefaring world (two for a galactic one), its far half behind the planet
  const ring = (rx, ry, opacity) => ({
    back: `<path d="M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}" fill="none" stroke="#e9dfc6" stroke-width="3" opacity="${opacity * 0.55}" transform="rotate(-14 ${cx} ${cy})"/>`,
    front: `<path d="M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}" fill="none" stroke="#f3ead2" stroke-width="3" opacity="${opacity}" transform="rotate(-14 ${cx} ${cy})"/>`,
  });
  const rings = [lv >= 5 ? ring(R * 1.62, R * 0.36, 0.85) : null, lv >= 7 ? ring(R * 1.9, R * 0.44, 0.5) : null].filter(Boolean);

  const moon =
    lv >= 3
      ? `<g><circle r="7" fill="#c9ccd6"/><circle r="7" fill="url(#moonShade)"/><animateMotion dur="16s" repeatCount="indefinite" path="M ${R * 1.45} 0 A ${R * 1.45} ${R * 0.55} 0 1 1 ${-R * 1.45} 0 A ${R * 1.45} ${R * 0.55} 0 1 1 ${R * 1.45} 0" /></g>`
      : '';
  const satellites =
    lv >= 2
      ? [0, 1, 2]
          .slice(0, Math.min(3, lv - 1))
          .map((k) => `<circle r="1.6" fill="#bfe8ff"><animateMotion dur="${6 + k * 2.3}s" begin="-${k * 1.7}s" repeatCount="indefinite" path="M ${R * 1.15} 0 A ${R * 1.15} ${R * (0.3 + k * 0.12)} 0 1 1 ${-R * 1.15} 0 A ${R * 1.15} ${R * (0.3 + k * 0.12)} 0 1 1 ${R * 1.15} 0" /></circle>`)
          .join('')
      : '';
  const rocket =
    lv >= 4
      ? `<g class="rocket"><path d="M0 -6 L2.6 2 L-2.6 2 Z" fill="#fff"/><circle cy="4.5" r="2.4" fill="#ffb054" opacity=".9"/></g>`
      : '';

  const galaxy = w.galaxy ?? GALAXY.scripting;
  const progress = Math.max(0.02, Math.min(1, w.level.progress ?? 1));
  const name = clip(w.name && w.name !== w.login ? w.name : `@${w.login}`, 26);
  const sub = w.name && w.name !== w.login ? `@${w.login}` : w.type === 'Organization' ? 'an organisation' : '';
  // the words, top to bottom
  let y = 44;
  const line = (gap, svg) => {
    y += gap;
    return svg(y);
  };
  const text = [
    `<text x="292" y="${y}" class="tag" fill="${galaxy.color}">COMMITVERSE · ${esc(galaxy.name.replace(/^The /, '').toUpperCase())}</text>`,
    line(40, (y) => `<text x="292" y="${y}" class="name">${esc(name)}</text>`),
    sub ? line(20, (y) => `<text x="292" y="${y}" class="small">${esc(sub)}</text>`) : '',
    line(26, (y) => `<text x="292" y="${y}" class="level">Level ${lv} · ${esc(w.level.name)}</text>`),
    line(9, (y) => `<rect x="292" y="${y}" width="390" height="5" rx="2.5" fill="#ffffff" fill-opacity=".1"/><rect x="292" y="${y}" width="${(390 * progress).toFixed(1)}" height="5" rx="2.5" fill="url(#bar)"/>`),
    line(24, (y) => `<text x="292" y="${y}" class="stat">${fmt(w.stars)} ★  ·  ${fmt(w.cities)} ${w.cities === 1 ? 'city' : 'cities'}  ·  ${fmt(w.followers)} followers</text>`),
    w.languages.length ? line(22, (y) => w.languages.slice(0, 3).map((l, i) => `<circle cx="${296 + i * 112}" cy="${y - 4}" r="4" fill="${langColor(l)}"/><text x="${305 + i * 112}" y="${y}" class="small">${esc(clip(l, 13))}</text>`).join('')) : '',
    w.top.length ? line(22, (y) => `<text x="292" y="${y}" class="small">${esc(clip(w.top.join(' · '), 52))}</text>`) : '',
    `<text x="292" y="228" class="link">Explore this world in the Commitverse  →</text>`,
  ].join('\n');
  const sans ="'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif";
  const mono = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
<title id="title">${esc(`@${w.login}: a Level ${lv} ${w.level.name} world in ${galaxy.name}, the Commitverse`)}</title>
<style>
  .tw { animation: tw 3.6s ease-in-out infinite; }
  .city { animation: city 2.8s ease-in-out infinite; }
  @keyframes tw { 0%, 100% { opacity: .2 } 50% { opacity: 1 } }
  @keyframes city { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
  .rocket { animation: launch 7s ease-in infinite; transform-origin: 0 0; }
  @keyframes launch { 0% { transform: translate(${cx + R * 0.36}px, ${cy - R * 0.84}px); opacity: 0 } 6% { opacity: 1 } 45% { transform: translate(${cx + R * 0.9}px, ${cy - R * 2.1}px); opacity: 0 } 100% { opacity: 0 } }
  .aurora { animation: aurora 5s ease-in-out infinite; }
  @keyframes aurora { 0%, 100% { opacity: .35 } 50% { opacity: .85 } }
  text { font-family: ${sans}; }
  .tag { font-size: 11px; letter-spacing: 3px; font-weight: 700; }
  .name { font-size: 28px; font-weight: 700; fill: #f4f6ff; }
  .level { font-size: 15px; font-weight: 600; fill: #ffcf87; }
  .stat { font-family: ${mono}; font-size: 13px; fill: #dfe6ff; }
  .small { font-family: ${mono}; font-size: 12px; fill: #9aa4c4; }
  .link { font-size: 11.5px; fill: #7fd4ff; letter-spacing: .3px; }
</style>
<defs>
  <radialGradient id="bg" cx="22%" cy="50%" r="85%"><stop offset="0" stop-color="#101a3c"/><stop offset=".55" stop-color="#070b1d"/><stop offset="1" stop-color="#04050c"/></radialGradient>
  <radialGradient id="ocean" cx="34%" cy="32%" r="80%"><stop offset="0" stop-color="${style.ocean[1]}"/><stop offset="1" stop-color="${style.ocean[0]}"/></radialGradient>
  <radialGradient id="shade" cx="28%" cy="26%" r="92%"><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset=".58" stop-color="#02030a" stop-opacity=".62"/><stop offset=".78" stop-color="#02030a" stop-opacity=".93"/><stop offset="1" stop-color="#02030a" stop-opacity=".98"/></radialGradient>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset=".72" stop-color="${atmo}" stop-opacity="0"/><stop offset=".8" stop-color="${atmo}" stop-opacity=".55"/><stop offset="1" stop-color="${atmo}" stop-opacity="0"/></radialGradient>
  <radialGradient id="moonShade" cx="30%" cy="30%" r="80%"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".8"/></radialGradient>
  <linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="#ffcf87"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient>
  <clipPath id="disc"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
  <filter id="land" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.021" numOctaves="4" seed="${seed}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${(8.5).toFixed(1)} 0 0 0 ${(-4.15 - style.sea * 4).toFixed(2)}" result="mask"/>
    <feFlood flood-color="${style.land[1]}" result="low"/>
    <feComposite in="low" in2="mask" operator="in" result="lowland"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${(10).toFixed(1)} 0 0 0 ${(-5.6 - style.sea * 4).toFixed(2)}" result="mask2"/>
    <feFlood flood-color="${style.land[2]}" result="high"/>
    <feComposite in="high" in2="mask2" operator="in" result="highland"/>
    <feMerge><feMergeNode in="lowland"/><feMergeNode in="highland"/></feMerge>
  </filter>
  <filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="0.8"/></filter>
</defs>
<rect width="${width}" height="${height}" rx="14" fill="url(#bg)"/>
<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="13.5" fill="none" stroke="${galaxy.color}" stroke-opacity=".35"/>
${stars}
<circle cx="${cx}" cy="${cy}" r="${R * 1.28}" fill="url(#glow)"/>
${rings.map((r) => r.back).join('')}
<g clip-path="url(#disc)">
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#ocean)"/>
  <rect x="${cx - R}" y="${cy - R}" width="${R * 2}" height="${R * 2}" filter="url(#land)" opacity=".95"/>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#shade)"/>
  <g filter="url(#soft)">${lights}</g>
  ${active ? `<ellipse class="aurora" cx="${cx}" cy="${cy - R * 0.93}" rx="${R * 0.42}" ry="${R * 0.09}" fill="none" stroke="#5dffb0" stroke-width="3" filter="url(#soft)"/>` : ''}
</g>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${atmo}" stroke-opacity=".7" stroke-width="2" filter="url(#blur)"/>
${rings.map((r) => r.front).join('')}
<g transform="translate(${cx} ${cy})">${satellites}${moon}</g>
${rocket}
${text}
</svg>
`;
}
