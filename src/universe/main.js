import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FinishShader } from '../materials.js';
import { PlanetView } from './planetView.js';
import { GalaxyView } from './galaxyView.js';
import { UniverseView } from './universeView.js';
import { SystemView } from './systemView.js';
import { OrgView } from './orgView.js';
import { LEVELS, PROLOGUE } from './lore.js';
import { GALAXY, GALAXIES, accountOf, galaxyIdOf, galaxyOfRepos } from './cosmos.js';
import { loadPlanet } from './planetView.js';
import { ScaleHud, watchZoom } from '../scale.js';
import { Sound } from '../sound.js';
import { catalogOf } from './systemView.js';
import './ui.css';

const $ = (id) => document.getElementById(id);
const W = () => Math.max(1, innerWidth);
const H = () => Math.max(1, innerHeight);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W(), H());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('app').appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(W(), H());
labelRenderer.domElement.className = 'label-layer';
$('app').appendChild(labelRenderer.domElement);
// labels sit above the canvas: let the wheel over them still zoom (and change scale)
labelRenderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    renderer.domElement.dispatchEvent(new WheelEvent('wheel', e));
  },
  { passive: false }
);

// On a phone held upright, keep the width of view a landscape screen has, instead of a keyhole.
const fovFor = (aspect) => (aspect >= 1 ? 45 : Math.min(80, (2 * Math.atan(Math.tan((22.5 * Math.PI) / 180) / aspect) * 180) / Math.PI));
const camera = new THREE.PerspectiveCamera(fovFor(W() / H()), W() / H(), 0.5, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
const renderPass = new RenderPass(new THREE.Scene(), camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.85, 0.55, 1.05);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass(FinishShader);
composer.addPass(finish);
composer.setSize(W(), H());

addEventListener('resize', () => {
  camera.aspect = W() / H();
  if (!params.has('director')) camera.fov = fovFor(camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
  labelRenderer.setSize(W(), H());
  composer.setSize(W(), H());
});

// ---------------------------------------------------------------- UI helpers

let toastTimer = 0;
const ui = {
  cardEl: $('card'),
  tooltipEl: $('tooltip'),
  card(html) {
    this.cardEl.innerHTML = html;
    this.cardEl.hidden = !html;
  },
  hint(text) {
    $('hint').textContent = text;
  },
  crumbs(items) {
    $('crumbs').innerHTML = items
      .map((c, i) => (c.href && i < items.length - 1 ? `<a href="${c.href}">${c.label}</a>` : `<span>${c.label}</span>`))
      .join('<i>›</i>');
  },
  toast(html) {
    const el = $('toast');
    el.innerHTML = html;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 5200);
  },
  // a white-out (clouds, the light of a star) or, between scales, a dip to black
  fade(amount, tone = 'light') {
    const el = $('fade');
    el.style.opacity = amount;
    el.classList.toggle('dark', tone === 'dark');
  },
  loading(text) {
    $('loading').hidden = !text;
    if (text) $('loading').textContent = text;
  },
  // progress of a city survey by the mapping service
  survey(repo, step, position) {
    const el = $('survey');
    if (!repo) {
      el.hidden = true;
      return;
    }
    const steps = [
      ['clone', 'Cloning the repository'],
      ['scan', 'Measuring every file'],
      ['history', 'Reading the whole history'],
      ['layout', 'Laying out districts'],
      ['write', 'Raising the buildings'],
    ];
    const order = ['queued', ...steps.map((s) => s[0]), 'done'];
    const at = order.indexOf(step);
    el.innerHTML = `<div class="survey-title">Surveying <b>${repo}</b></div>
      ${step === 'queued' && position ? `<div class="survey-note">In the queue: #${position}</div>` : ''}
      <ol>${steps.map(([key, label], k) => `<li class="${at > k + 1 ? 'ok' : at === k + 1 ? 'now' : ''}">${label}</li>`).join('')}</ol>
      ${step === 'done' ? '<div class="survey-note">Mapped. Landing…</div>' : ''}`;
    el.hidden = false;
  },
};

const scale = new ScaleHud();
const sound = new Sound();
if (!params.has('director')) sound.attach($('sound-btn'));
const ctx = { renderer, camera, controls, ui, composer, scale, time: 0 };
const views = { universe: new UniverseView(ctx), planet: new PlanetView(ctx) };
// one view per galaxy, built on first visit; 'all' is every world in one galaxy, as in the film
const galaxyViews = {};
const galaxyView = (id) => (galaxyViews[id] ??= new GalaxyView(ctx, GALAXY[id] ?? GALAXY.all));
views.galaxy = galaxyView('all');
ctx.galaxyFor = async (login, lang, stars) => {
  const g = galaxyView(await galaxyIdOf(login, lang, stars));
  await g.load();
  return g;
};
views.system = new SystemView(ctx);
views.org = new OrgView(ctx);
let current = null;
// links from before the galaxies split up: the old sectors of the one galaxy
const SECTOR_GALAXY = { titan: 'titan', ai: 'ai', nursery: 'rising', silent: 'archive' };
const isOrg = async (login) =>
  (await accountOf(login))?.t === 'O' || (await fetch(`universe/orgs/${login.toLowerCase()}.json`).then((r) => (r.headers.get('content-type') ?? '').includes('json')).catch(() => false));

// Leaving a scale: keep pulling back while the view dips to black, then hand over to the next one.
let leaving = null;
function leave(then) {
  if (leaving) return;
  sound.whoosh(true);
  scale.reset();
  controls.autoRotate = false;
  leaving = { t: 0, then, offset: camera.position.clone().sub(controls.target) };
}
ctx.leave = leave;
function updateLeaving(dt) {
  leaving.t += dt;
  const k = Math.min(1, leaving.t / 0.4);
  camera.position.copy(controls.target).addScaledVector(leaving.offset, 1 + 0.6 * k * k);
  camera.lookAt(controls.target);
  ui.fade(k, 'dark');
  if (k < 1) return;
  const { then } = leaving;
  leaving = null;
  then();
}

// The autopilot: from the whole cluster down to one world, scale by scale, by itself.
// It waits for each flight to land, pauses a beat, then takes the next hop.
let autopilot = null;
async function flyHome(login) {
  ui.hint(`Autopilot: charting @${login}…`);
  let gid;
  let lang = 'Other';
  let stars = 0;
  const known = await accountOf(login);
  if (known) {
    gid = known.g;
    login = known.l;
  } else {
    try {
      const d = await loadPlanet(login);
      login = d.login;
      gid = galaxyOfRepos(d.repos);
      const langs = {};
      for (const r of d.repos) if (r.lang) langs[r.lang] = (langs[r.lang] ?? 0) + r.s;
      lang = Object.entries(langs).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'Other';
      stars = d.repos.reduce((n, r) => n + r.s, 0);
    } catch (err) {
      ui.toast(err.message);
      return;
    }
  }
  autopilot = { login, gid, lang, stars, stage: 'universe', wait: 0.4 };
  history.replaceState({}, '', `?home=${encodeURIComponent(login)}`);
  if (current !== views.universe) await go({}, { push: false });
}
ctx.flyHome = flyHome;

function updateAutopilot(dt) {
  const a = autopilot;
  if (!a || leaving || current?.flying || current?.landing || current?.ascending || !$('loading').hidden) return;
  a.wait -= dt;
  if (a.wait > 0) return;
  const name = GALAXY[a.gid]?.name ?? 'its galaxy';
  if (a.stage === 'universe' && current === views.universe) {
    ui.hint(`Autopilot: @${a.login} lives in ${name}`);
    sound.whoosh(false);
    views.universe.enterGalaxy(a.gid);
    a.stage = 'galaxy';
    a.wait = 0.9;
  } else if (a.stage === 'galaxy' && current instanceof GalaxyView) {
    ui.hint(`Autopilot: into the star system of @${a.login}`);
    current.visit(a.login, 'system');
    a.stage = 'system';
    a.wait = 1.1;
  } else if (a.stage === 'system' && current === views.system) {
    ui.hint(`Autopilot: @${a.login}, your world`);
    views.system.visit(a.home ?? a.login);
    a.stage = 'world';
  } else if ((a.stage === 'system' && current === views.org) || (a.stage === 'world' && current === views.planet)) {
    autopilot = null;
    sound.chime();
    ui.toast(`Welcome home, <b>@${a.login}</b>. Share your world from the card, or zoom into one of your cities.`);
  }
}

// The rungs of the scale ladder for the view on screen (src/scale.js).
function ladder() {
  const v = current;
  const universe = (gid) => ({ label: 'Commitverse', go: () => leave(() => go({ fromGalaxy: gid })) });
  if (v === views.universe) {
    scale.set('universe', { universe: { label: `${GALAXIES.length} galaxies` }, galaxy: { label: 'zoom into a galaxy' } });
  } else if (v instanceof GalaxyView) {
    scale.set('galaxy', { universe: v.legacy ? null : universe(v.spec.id), galaxy: { label: v.spec.name }, system: { label: 'zoom into any star' } });
  } else if (v === views.system) {
    const login = v.home.l;
    scale.set('system', {
      universe: universe(v.galaxyId),
      galaxy: { label: GALAXY[v.galaxyId].name, go: () => v.zoomOut() },
      system: { label: `System ${v.catalog}` },
      world: { label: `@${login}`, go: () => v.visit(login) },
    });
  } else if (v === views.org) {
    scale.set('system', {
      universe: universe(v.galaxyId),
      galaxy: { label: GALAXY[v.galaxyId].name, go: () => v.zoomOut() },
      system: { label: `★ @${v.data.login}` },
      city: { label: `${v.structures[0]?.repo.n ?? 'its structures'}…`, go: () => v.land(0) },
    });
  } else if (v === views.planet) {
    const login = v.data.login;
    const gid = v.galaxyId ?? 'scripting';
    scale.set('world', {
      universe: universe(gid),
      galaxy: { label: GALAXY[gid].name, go: () => leave(() => go({ galaxy: gid, fromStar: login })) },
      system: { label: `System ${catalogOf(login)}`, go: () => v.zoomOut() },
      world: { label: `@${login}` },
      city: { label: 'zoom into a city' },
    });
  }
}

// CSS2D labels live in one shared layer: hide the old scene's when another scene takes the screen
// (the renderer only updates labels of the scene it draws, so they'd stay frozen in place).
let shownScene = null;
function show(scene) {
  if (shownScene && shownScene !== scene) shownScene.traverse((o) => o.isCSS2DObject && (o.element.style.display = 'none'));
  shownScene = scene;
  renderPass.scene = scene;
}

async function go(route, { push = true } = {}) {
  if (route.sector && !route.galaxy) route = SECTOR_GALAXY[route.sector] ? { galaxy: SECTOR_GALAXY[route.sector] } : {};
  ui.loading(route.planet ? `Approaching @${route.planet}…` : route.system ? 'Entering the system…' : route.galaxy ? 'Charting the galaxy…' : 'Charting the Commitverse…');
  ui.card('');
  $('tooltip').hidden = true;
  try {
    if (route.planet || route.system) {
      const login = route.planet ?? route.system;
      if ((await accountOf(login))?.t === 'O') route = { system: login, fromCity: route.ascend ?? route.fromCity };
    }
    if (route.planet) {
      const planet = await views.planet.enter(route.planet, { ascend: route.ascend });
      if (planet.redirect === 'org') return go({ system: planet.login, fromCity: route.ascend }, { push });
      current = views.planet;
      const galaxy = GALAXY[(views.planet.galaxyId = await galaxyIdOf(planet.data.login, planet.mainLanguage, planet.stars))];
      ui.crumbs([{ label: 'Commitverse', href: './' }, { label: galaxy.name, href: `./?galaxy=${galaxy.id}` }, { label: 'System', href: `./?system=${encodeURIComponent(planet.data.login)}` }, { label: `@${planet.data.login}` }]);
      document.title = `@${planet.data.login} · Commitverse`;
    } else if (route.system && (await isOrg(route.system))) {
      const org = await views.org.enter(route.system, { fromCity: route.fromCity });
      current = views.org;
      ui.crumbs([{ label: 'Commitverse', href: './' }, { label: org.galaxy.name, href: `./?galaxy=${org.galaxy.id}` }, { label: `★ @${views.org.data.login}` }]);
      document.title = `★ @${views.org.data.login} · Commitverse`;
    } else if (route.system) {
      const home = views.planet.data?.login?.toLowerCase() === route.system.toLowerCase() ? views.planet : null;
      const pilot = autopilot?.login.toLowerCase() === route.system.toLowerCase() ? autopilot : null;
      const fallback = home ? { l: home.data.login, s: home.planet?.stars ?? 0, lang: home.planet?.mainLanguage ?? 'Other', sector: 'arm', top: [] } : { l: route.system, s: pilot?.stars ?? 0, lang: pilot?.lang ?? 'Other', sector: 'arm', top: [] };
      const sys = await views.system.enter(route.system, fallback, { fromWorld: route.fromWorld });
      current = views.system;
      ui.crumbs([{ label: 'Commitverse', href: './' }, { label: sys.galaxy.name, href: `./?galaxy=${sys.galaxy.id}` }, { label: `System ${sys.catalog}` }]);
      document.title = `System ${sys.catalog} · Commitverse`;
    } else if (route.galaxy) {
      const g = galaxyView(route.galaxy);
      await g.enter(route);
      current = g;
      ui.crumbs([{ label: 'Commitverse', href: './' }, { label: g.spec.name }]);
      document.title = `${g.spec.name} · Commitverse`;
    } else {
      await views.universe.enter(route);
      current = views.universe;
      ui.crumbs([{ label: 'Commitverse' }]);
      document.title = 'Commitverse';
    }
    show(current.scene);
    ladder();
    // the time machine belongs to the galaxies
    $('time').hidden = !(current instanceof GalaxyView) || params.has('director');
    for (const g of Object.values(galaxyViews)) if (g !== current) g.resetTime?.();
    sound.mood(current === views.universe ? 'universe' : current instanceof GalaxyView ? 'galaxy' : current === views.planet ? 'planet' : 'system');
    if (route.fromUniverse || route.fromStar || route.fromWorld) sound.whoosh(false);
    // only where we are goes into history, not how we got here
    const state = route.planet ? { planet: route.planet } : route.system ? { system: route.system } : route.galaxy ? { galaxy: route.galaxy } : {};
    const url = route.planet ? `?planet=${encodeURIComponent(route.planet)}` : route.system ? `?system=${encodeURIComponent(route.system)}` : route.galaxy ? `?galaxy=${route.galaxy}` : './';
    if (push) history.pushState(state, '', url);
    else if (route.ascend) history.replaceState(state, '', url);
  } catch (err) {
    ui.toast(err.message);
    if (!current) await go({}, { push: false });
  } finally {
    ui.loading('');
    if (!current?.ownsFade) ui.fade(0);
  }
}
addEventListener('popstate', (e) => go(e.state ?? {}, { push: false }));
ctx.go = go;

// ---------------------------------------------------------------- input

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
const rayFrom = (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray;
};
renderer.domElement.addEventListener('pointermove', (e) => current?.pointerMove?.(e, rayFrom(e)));
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  current?.click?.(rayFrom(e), e);
});
controls.addEventListener('start', () => (controls.autoRotate = false));

// Zooming past the limit of a scale carries you to the next one (src/scale.js).
const busy = () => !!(leaving || current?.flying || current?.landing || current?.ascending || !$('codex').hidden);
watchZoom(
  renderer.domElement,
  controls,
  camera,
  (dir, amount, e) => {
    const target = current?.zoomTarget?.(dir, e, rayFrom(e));
    if (target && scale.press(dir, amount, target.label)) target.go();
  },
  { enabled: () => !busy() }
);

$('search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const [login, repo] = e.target.value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').split(/[/\s]+/);
  e.target.blur();
  if (login && repo) location.href = `city.html?repo=${encodeURIComponent(`${login}/${repo}`)}&from=${encodeURIComponent(login)}&arrive=1`;
  else if (login) go({ planet: login });
});

// ---------------------------------------------------------------- codex & prologue

function openCodex() {
  $('codex').innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <h2>The Galactic Codex</h2>
    <p class="lede">Every myth here is a measurement: everything you see is computed from public git and GitHub data.</p>
    <h3>Levels of civilisation</h3>
    <p>Stars are energy. A world develops with the total stars across its repositories.</p>
    <table>${LEVELS.map((l) => `<tr><td>${l.level}</td><td><b>${l.name}</b></td><td>${l.min.toLocaleString('en-US')}+ ★</td><td>${l.text}</td></tr>`).join('')}</table>
    <h3>The galaxies</h3>
    <p>Every world belongs to one galaxy. The giants come first, then AI, then the silent, then the family of the world's main language.</p>
    <dl>${GALAXIES.map((g) => `<dt style="color:${g.color}">${g.name}</dt><dd>${g.text}</dd>`).join('')}</dl>
    <h3>Migrations</h3>
    <p>The universe is reseeded from GitHub every day. A protostar that passes 100,000 ★ <b>ignites</b> and crosses to the Titans as a comet; worlds whose numbers change migrate too. Star the project's repository and your own world joins at the next update.</p>
    <h3>Travelling</h3>
    <ul>
      <li><b>One zoom from the cluster to a line of code</b>: universe → galaxy → star system → world → city → building. Zoom past the limit of a scale and keep going to reach the next one.</li>
      <li>Search <b>@anyone</b> to fly to their world, or <b>owner/repo</b> to land in any city.</li>
    </ul>
    <h3>Reading a world</h3>
    <ul>
      <li><b>A planet is a person</b>; each of their repositories is a city on its continents.</li>
      <li><b>City lights at night</b> glow where work happened recently.</li>
      <li><b>Atmosphere colour</b> is the world's main language.</li>
      <li>Land in a city to walk its history: files are buildings, folders are districts, and a building's floors are its lines of code. A city whose history hasn't been surveyed yet is raised live from GitHub: its lit windows are the files the last 100 commits touched.</li>
    </ul>
    <p class="credit">Night sky: NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020. Gaia DR2: ESA/Gaia/DPAC.</p>`;
  $('codex').hidden = false;
  $('codex').querySelector('.close').onclick = () => ($('codex').hidden = true);
}
$('codex-btn').onclick = openCodex;

// The star button shows how many have joined (one API request per visit, cached for the session).
(async () => {
  const key = 'commitverse:stars';
  let n = null;
  try {
    n = sessionStorage.getItem(key);
  } catch {}
  if (n === null) {
    const res = await fetch('https://api.github.com/repos/krapcys1-maker/commitverse').catch(() => null);
    if (res?.ok) n = String((await res.json()).stargazers_count);
    try {
      if (n !== null) sessionStorage.setItem(key, n);
    } catch {}
  }
  if (n !== null) $('star-btn').querySelector('b').textContent = Number(n).toLocaleString('en-US');
})();

async function prologue() {
  // the prologue opens the universe; a link to a particular place goes straight there
  if (['planet', 'system', 'galaxy', 'sector', 'skip', 'home'].some((k) => params.has(k)) || sessionStorage.getItem('prologue')) return;
  try {
    sessionStorage.setItem('prologue', '1');
  } catch {}
  const el = $('prologue');
  el.hidden = false;
  const skip = new Promise((resolve) => (el.onclick = resolve));
  const sleep = (ms) => Promise.race([new Promise((r) => setTimeout(r, ms)), skip]);
  for (const line of PROLOGUE) {
    const p = document.createElement('p');
    p.textContent = line;
    el.querySelector('.lines').appendChild(p);
    setTimeout(() => p.classList.add('in'), 30);
    if ((await Promise.race([sleep(1700).then(() => 'next'), skip.then(() => 'skip')])) === 'skip') break;
  }
  el.classList.add('out');
  setTimeout(() => (el.hidden = true), 1200);
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let time = 0;
function stepFrame(dt) {
  time += dt;
  ctx.time = time;
  finish.uniforms.uTime.value = time;
  current?.update(dt, time);
  if (leaving) updateLeaving(dt);
  else if (!current?.landing && !current?.flying && !current?.ascending) controls.update();
  updateAutopilot(dt);
  finish.uniforms.uWarp.value = warpNow();
  composer.render();
  labelRenderer.render(current?.scene ?? renderPass.scene, camera);
}
function frame() {
  const now = performance.now();
  stepFrame(Math.min((now - last) / 1000, 0.1));
  last = now;
  requestAnimationFrame(frame);
}

// How hard space streaks past right now: leaving a scale, flying into something, arriving somewhere.
function warpNow() {
  const span = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  let w = leaving ? span(leaving.t, 0, 0.4) : 0;
  const f = current?.flying;
  if (f?.fadeIn) w = Math.max(w, 1 - span(f.t * f.dur, 0, 0.8));
  else if (f?.then) w = Math.max(w, span(f.t, 0.55, 1));
  if (current?.landing) w = Math.max(w, span(current.landing.t, 3.2, 4.6) * 0.55);
  if (current?.ascending) w = Math.max(w, (1 - span(current.ascending.t, 0, 1.6)) * 0.5);
  return w * 0.9;
}

// Hooks for scripted capture and tests: step the world with a fixed dt, switch views directly.
function setView(view) {
  current = view;
  show(view.scene);
}
window.commitverse = { ctx, views, go, stepFrame, setView, renderPass, get current() { return current; } };
if (params.has('director')) {
  // the film: no prologue overlay, no UI, the director drives every frame (tools/video/capture.mjs)
  document.body.classList.add('director');
  finish.uniforms.uGrainAnim.value = 0; // a static dither: moving grain only costs video bitrate
  finish.uniforms.uGrain.value = 0.014;
  const { Director } = await import('./director.js');
  window.director = new Director(window.commitverse);
  await window.director.prepare();
} else {
const intro = prologue();
await go(
  params.get('planet') ? { planet: params.get('planet'), ascend: params.get('ascend') } : params.get('system') ? { system: params.get('system') } : params.get('galaxy') ? { galaxy: params.get('galaxy') } : { sector: params.get('sector') },
  { push: false }
);
if (!params.has('capture')) frame();
if (params.get('home')) flyHome(params.get('home'));
await intro;
}
