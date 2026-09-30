import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { City } from './city.js';
import { Timelapse } from './timelapse.js';
import { search } from './search.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const captureMode = params.has('capture'); // deterministic, externally stepped rendering for video export

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: captureMode });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x05070d, 0.002);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 8000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0x9bb8ff, 0x1a1020, 0.8));
const sun = new THREE.DirectionalLight(0xffe2c0, 1.25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.35, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- state ----------
let data = null;
let city = null;
let timelapse = null;
let selected = -1;
let flight = null;

const fmtDate = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const fmtNum = (n) => Math.round(n).toLocaleString('en-US');

function setUrl(changes) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(changes)) v == null ? url.searchParams.delete(k) : url.searchParams.set(k, v);
  history.replaceState(null, '', url);
}

// ---------- loading ----------
async function loadIndex() {
  const index = await fetch('data/index.json').then((r) => r.json()).catch(() => []);
  const select = $('repo-select');
  select.innerHTML = index.map((e) => `<option value="${e.slug}">${e.name}</option>`).join('');
  select.onchange = () => {
    setUrl({ repo: select.value, focus: null });
    load(select.value);
  };
  const slug = params.get('repo') || index[0]?.slug;
  if (!slug) {
    $('loading').textContent = 'No city data yet. Run: npm run ingest -- <github-url>';
    return;
  }
  select.value = slug;
  await load(slug, params.get('focus'));
}

async function load(slug, focus) {
  $('loading').hidden = false;
  data = await fetch(`data/${slug}.json`).then((r) => r.json());
  if (city) {
    scene.remove(city.group);
    city.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
  city = new City(data);
  scene.add(city.group);
  timelapse = new Timelapse(city);
  timelapse.onCommit = showCommit;
  selected = -1;
  $('info').hidden = true;

  const size = data.size;
  ground.scale.set(size * 6, size * 6, 1);
  scene.fog.density = 0.3 / size;
  sun.position.set(size * 0.5, size * 0.9, size * 0.3);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -size * 0.8;
  sc.right = sc.top = size * 0.8;
  sc.near = 1;
  sc.far = size * 3;
  sc.updateProjectionMatrix();
  camera.far = size * 12;
  camera.updateProjectionMatrix();
  camera.position.set(size * 0.8, size * 0.75, size * 1.0);
  controls.target.set(0, 0, 0);
  controls.maxDistance = size * 3;

  $('timeline').value = 1000;
  $('play').textContent = '▶';
  showCommit(data.commits.at(-1));
  $('loading').hidden = true;
  if (focus) flyTo(focus);
}

// ---------- camera flights ----------
function flyTo(path) {
  const b = city.boundsOf(path);
  if (!b) return;
  const target = new THREE.Vector3(b.center.x, b.center.y, b.center.z);
  const dist = Math.max(b.radius * 3.2, 16);
  const dir = camera.position.clone().sub(controls.target).normalize();
  dir.y = Math.max(dir.y, 0.5);
  dir.normalize();
  const toPos = target.clone().addScaledVector(dir, dist);
  const hop = camera.position.distanceTo(toPos) * 0.25; // arc up, like a flight rather than a zoom
  $('tooltip').hidden = true;
  flight = { t: 0, dur: 1.8, fromPos: camera.position.clone(), toPos, fromTarget: controls.target.clone(), toTarget: target, hop };
  if (b.index >= 0) select(b.index);
  setUrl({ focus: path });
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function updateFlight(dt) {
  if (!flight) return;
  flight.t = Math.min(1, flight.t + dt / flight.dur);
  const e = ease(flight.t);
  camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
  camera.position.y += Math.sin(Math.PI * e) * flight.hop;
  controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
  if (flight.t >= 1) flight = null;
}
controls.addEventListener('start', () => (flight = null));

// ---------- selection & info ----------
function select(i) {
  if (selected >= 0 && !timelapse.active) city.heat[selected] = city.baseHeat[selected];
  selected = i;
  const f = data.files[i];
  const link = f.alive && data.repo.url ? `<a href="${data.repo.url}/blob/${data.repo.head}/${f.p}" target="_blank" rel="noopener">Open on GitHub ↗</a>` : '';
  $('info-body').innerHTML = `
    <h3>${f.p}</h3>
    <p><span class="badge">${f.alive ? 'standing' : 'demolished'}</span></p>
    <dl>
      <dt>Lines now</dt><dd>${fmtNum(f.loc)}</dd>
      <dt>Peak lines</dt><dd>${fmtNum(f.peak)}</dd>
      <dt>Commits</dt><dd>${fmtNum(f.c)}</dd>
      <dt>First commit</dt><dd>${f.first ? fmtDate(f.first) : '—'}</dd>
      <dt>Last commit</dt><dd>${f.last ? fmtDate(f.last) : '—'}</dd>
    </dl>
    ${link}`;
  $('info').hidden = false;
}
$('info-close').onclick = () => {
  if (selected >= 0 && !timelapse.active) city.heat[selected] = city.baseHeat[selected];
  selected = -1;
  $('info').hidden = true;
  setUrl({ focus: null });
};

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverPending = false;
let downAt = null;

function pick(e) {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(city.buildings, false)[0]?.instanceId ?? -1;
}

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!city || hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const i = pick(e);
    const tip = $('tooltip');
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    const f = data.files[i];
    tip.innerHTML = `<b>${f.p}</b><br>${fmtNum(timelapse.active ? city.loc[i] : f.loc)} lines · ${f.c} commits${f.alive ? '' : ' · demolished'}`;
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 300)}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.hidden = false;
  });
});
renderer.domElement.addEventListener('pointerleave', () => ($('tooltip').hidden = true));
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const i = pick(e);
  if (i >= 0) flyTo(data.files[i].p);
});

// ---------- search ----------
const input = $('search');
const results = $('results');
let hits = [];
let active = 0;

function renderResults() {
  results.hidden = !hits.length;
  results.innerHTML = hits
    .map((h, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}"><span class="kind">${h.kind === 'district' ? 'folder' : 'file'}</span>${h.path}</li>`)
    .join('');
}
input.addEventListener('input', () => {
  hits = data ? search(data, input.value) : [];
  active = 0;
  renderResults();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') active = Math.min(active + 1, hits.length - 1);
  else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
  else if (e.key === 'Enter' && hits[active]) choose(hits[active]);
  else if (e.key === 'Escape') input.blur();
  else return;
  e.preventDefault();
  renderResults();
});
results.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) choose(hits[Number(li.dataset.i)]);
});
input.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 100));
input.addEventListener('focus', () => renderResults());

function choose(hit) {
  results.hidden = true;
  input.blur();
  flyTo(hit.path);
}

// ---------- timelapse controls ----------
function showCommit(c) {
  if (!c) return;
  const author = data.authors[c.a] ?? '';
  $('commit-date').textContent = timelapse?.active ? fmtDate(c.t) : `HEAD · ${fmtDate(c.t)}`;
  $('commit-msg').textContent = `${c.s} — ${author}`;
}

$('play').onclick = () => {
  if (timelapse.playing) timelapse.pause();
  else timelapse.play();
  $('play').textContent = timelapse.playing ? '❚❚' : '▶';
};
$('timeline').addEventListener('input', (e) => {
  timelapse.pause();
  $('play').textContent = '▶';
  const v = Number(e.target.value) / 1000;
  if (v >= 1) timelapse.finish();
  else timelapse.seek(v);
});

addEventListener('keydown', (e) => {
  if (e.target === input) return;
  if (e.key === '/') {
    e.preventDefault();
    input.focus();
  } else if (e.key === ' ') {
    e.preventDefault();
    $('play').click();
  }
});

// ---------- frame loop ----------
const clock = new THREE.Clock();
let time = 0;

function stepFrame(dt) {
  time += dt;
  if (timelapse) {
    const wasPlaying = timelapse.playing;
    timelapse.step(dt);
    if (timelapse.playing) $('timeline').value = Math.round(timelapse.progress * 1000);
    if (wasPlaying && !timelapse.playing) {
      $('play').textContent = '▶';
      $('timeline').value = 1000;
    }
  }
  if (city && selected >= 0 && !timelapse.active) {
    city.heat[selected] = city.baseHeat[selected] + 1.3 + Math.sin(time * 4) * 0.5;
    city.heatAttr.needsUpdate = true;
  }
  updateFlight(dt);
  controls.update();
  composer.render();
}

function loop() {
  stepFrame(Math.min(clock.getDelta(), 0.1));
  requestAnimationFrame(loop);
}

// Hooks for scripted capture (Playwright): step with a fixed dt, grab the canvas, repeat.
window.commitropolis = {
  get city() { return city; },
  get timelapse() { return timelapse; },
  camera,
  controls,
  flyTo,
  stepFrame,
};

await loadIndex();
if (!captureMode) loop();
