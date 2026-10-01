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
import { SystemView } from './systemView.js';
import { OrgView } from './orgView.js';
import { LEVELS, SECTORS, PROLOGUE } from './lore.js';
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

const camera = new THREE.PerspectiveCamera(45, W() / H(), 0.5, 20000);
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
  fade(amount) {
    $('fade').style.opacity = amount;
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

const ctx = { renderer, camera, controls, ui, composer };
const views = { galaxy: new GalaxyView(ctx), planet: new PlanetView(ctx) };
views.system = new SystemView(ctx, views.galaxy);
views.org = new OrgView(ctx, views.galaxy);
let current = null;

// CSS2D labels live in one shared layer: hide the old scene's when another scene takes the screen
// (the renderer only updates labels of the scene it draws, so they'd stay frozen in place).
let shownScene = null;
function show(scene) {
  if (shownScene && shownScene !== scene) shownScene.traverse((o) => o.isCSS2DObject && (o.element.style.display = 'none'));
  shownScene = scene;
  renderPass.scene = scene;
}

async function go(route, { push = true } = {}) {
  ui.loading(route.planet ? `Approaching @${route.planet}…` : route.system ? 'Entering the system…' : 'Charting the galaxy…');
  ui.card('');
  $('tooltip').hidden = true;
  try {
    if (route.planet || route.system) {
      await views.galaxy.load();
      const login = route.planet ?? route.system;
      if (views.galaxy.account(login)?.t === 'O') route = { system: login };
    }
    if (route.planet) {
      const planet = await views.planet.enter(route.planet);
      if (planet.redirect === 'org') return go({ system: planet.login }, { push });
      current = views.planet;
      const sector = views.galaxy.sectorOf(route.planet);
      ui.crumbs([{ label: 'Commitverse', href: './' }, { label: SECTORS[sector]?.name ?? 'The Language Arms', href: `./?sector=${sector}` }, { label: 'System', href: `./?system=${encodeURIComponent(planet.data.login)}` }, { label: `@${planet.data.login}` }]);
      document.title = `@${planet.data.login} · Commitverse`;
    } else if (route.system && (views.galaxy.account(route.system)?.t === 'O' || (await fetch(`universe/orgs/${route.system.toLowerCase()}.json`).then((r) => (r.headers.get('content-type') ?? '').includes('json')).catch(() => false)))) {
      const org = await views.org.enter(route.system);
      current = views.org;
      ui.crumbs([{ label: 'Commitverse', href: './' }, { label: org.sector.name, href: `./?sector=${views.galaxy.sectorOf(route.system)}` }, { label: `★ @${views.org.data.login}` }]);
      document.title = `★ @${views.org.data.login} · Commitverse`;
    } else if (route.system) {
      const home = views.planet.data?.login?.toLowerCase() === route.system.toLowerCase() ? views.planet : null;
      const fallback = home ? { l: home.data.login, s: home.planet?.stars ?? 0, lang: home.planet?.mainLanguage ?? 'Other', sector: 'arm', top: [] } : { l: route.system, s: 0, lang: 'Other', sector: 'arm', top: [] };
      await views.galaxy.load();
      const sys = await views.system.enter(route.system, fallback);
      current = views.system;
      ui.crumbs([{ label: 'Commitverse', href: './' }, { label: sys.sector.name, href: `./?sector=${sys.home.sector}` }, { label: `System ${sys.catalog}` }]);
      document.title = `System ${sys.catalog} · Commitverse`;
    } else {
      await views.galaxy.enter(route);
      current = views.galaxy;
      ui.crumbs([{ label: 'Commitverse' }]);
      document.title = 'Commitverse';
    }
    show(current.scene);
    const url = route.planet ? `?planet=${encodeURIComponent(route.planet)}` : route.system ? `?system=${encodeURIComponent(route.system)}` : route.sector ? `?sector=${route.sector}` : './';
    if (push) history.pushState(route, '', url);
  } catch (err) {
    ui.toast(err.message);
    if (!current) await go({}, { push: false });
  } finally {
    ui.loading('');
    ui.fade(0);
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

$('search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const login = e.target.value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').split('/')[0];
  if (login) go({ planet: login });
  e.target.blur();
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
    <h3>Sectors of the galaxy</h3>
    <dl>${Object.values(SECTORS).map((s) => `<dt style="color:${s.color}">${s.name}</dt><dd>${s.text}</dd>`).join('')}</dl>
    <h3>Reading a world</h3>
    <ul>
      <li><b>A planet is a person</b>; each of their repositories is a city on its continents.</li>
      <li><b>City lights at night</b> glow where work happened recently.</li>
      <li><b>Atmosphere colour</b> is the world's main language.</li>
      <li>Land in a city to walk its history: files are buildings, folders are districts, and a building's floors are its lines of code.</li>
    </ul>
    <p class="credit">Night sky: NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020. Gaia DR2: ESA/Gaia/DPAC.</p>`;
  $('codex').hidden = false;
  $('codex').querySelector('.close').onclick = () => ($('codex').hidden = true);
}
$('codex-btn').onclick = openCodex;

async function prologue() {
  if (params.has('planet') || params.has('skip') || sessionStorage.getItem('prologue')) return;
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
    if ((await Promise.race([sleep(2300).then(() => 'next'), skip.then(() => 'skip')])) === 'skip') break;
  }
  el.classList.add('out');
  setTimeout(() => (el.hidden = true), 1200);
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let time = 0;
function stepFrame(dt) {
  time += dt;
  finish.uniforms.uTime.value = time;
  current?.update(dt, time);
  if (!current?.landing && !current?.flying) controls.update();
  composer.render();
  labelRenderer.render(current?.scene ?? renderPass.scene, camera);
}
function frame() {
  const now = performance.now();
  stepFrame(Math.min((now - last) / 1000, 0.1));
  last = now;
  requestAnimationFrame(frame);
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
await go(params.get('planet') ? { planet: params.get('planet') } : params.get('system') ? { system: params.get('system') } : { sector: params.get('sector') }, { push: false });
if (!params.has('capture')) frame();
await intro;
}
