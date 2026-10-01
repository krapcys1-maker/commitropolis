import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { City } from './city.js';
import { Timelapse } from './timelapse.js';
import { Atmosphere } from './atmosphere.js';
import { FinishShader } from './materials.js';
import { CodeReader } from './reader.js';
import { search } from './search.js';
import { fetchCity } from './config.js';
import { CityEvents } from './cityEvents.js';

const $ = (id) => document.getElementById(id);
const W = () => Math.max(1, innerWidth);
const H = () => Math.max(1, innerHeight);
const params = new URLSearchParams(location.search);
const captureMode = params.has('capture'); // deterministic, externally stepped rendering for video export

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: captureMode });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W(), H());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('app').appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(W(), H());
labelRenderer.domElement.className = 'label-layer';
$('app').appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, W() / H(), 0.3, 8000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.35;

// Shared shader uniforms: time for animation, and the floor band lit by the code view.
const uniforms = {
  uTime: { value: 0 },
  uFocus: { value: -1 },
  uBand: { value: new THREE.Vector2() },
  uCamPos: { value: new THREE.Vector3() },
  uFocusPos: { value: new THREE.Vector3() },
  uTunnel: { value: 0 },
};
const atmosphere = new Atmosphere(renderer, scene, uniforms);

// HDR + MSAA target so bloom sees true highlights and edges stay clean.
const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.75, 0.5, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass(FinishShader);
composer.addPass(finish);
composer.setSize(W(), H());

function resize() {
  camera.aspect = W() / H();
  if (reader.open) camera.setViewOffset(innerWidth, innerHeight, innerWidth * 0.22, 0, innerWidth, innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
  labelRenderer.setSize(W(), H());
  composer.setSize(W(), H());
}
addEventListener('resize', resize);

// ---------- state ----------
let data = null;
let city = null;
let timelapse = null;
let selected = -1;
let flight = null;
let elevator = null; // camera ride along a building's facade while its code is open
let events = null; // rockets and asteroid impacts in the timelapse
let shake = null;
let captionUntil = 0; // on the frame clock, so captions behave the same live and in a frame-by-frame capture

function showCaption(text) {
  const el = $('caption');
  el.textContent = text;
  el.classList.add('show');
  captionUntil = time + 2.6;
}

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
  // a city mapped by the service isn't in the shipped index: list it anyway
  if (!index.some((e) => e.slug === slug)) select.insertAdjacentHTML('afterbegin', `<option value="${slug}">${slug.replace('-', '/')}</option>`);
  select.value = slug;
  await load(slug, params.get('focus'));
}

async function load(slug, focus) {
  $('loading').hidden = false;
  exitBuilding();
  data = await fetchCity(slug);
  if (city) {
    scene.remove(city.group);
    city.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material && o.material !== city.material) o.material.dispose();
      o.element?.remove();
    });
    city.material.dispose();
  }
  city = new City(data, uniforms);
  scene.add(city.group);
  timelapse = new Timelapse(city);
  timelapse.onCommit = showCommit;
  events = new CityEvents(city, { caption: showCaption, shake: (amp, dur) => (shake = { amp, dur, t: dur }) });
  timelapse.onApply = (i, c) => events.onCommit(i, c);
  timelapse.onSeek = (t) => events.reset(t);
  selected = -1;
  $('info').hidden = true;

  const size = data.size;
  atmosphere.fitCity(size, scene);
  camera.far = size * 14;
  camera.updateProjectionMatrix();
  camera.position.set(size * 0.66, size * 0.3, size * 0.8);
  controls.target.set(0, size * 0.02, 0);
  controls.maxDistance = size * 3;
  controls.autoRotate = !focus && !captureMode;

  $('timeline').value = 1000;
  $('play').textContent = '▶';
  showCommit(data.commits.at(-1));
  $('loading').hidden = true;
  if (focus) flyTo(focus);
  else if (params.has('arrive')) arrive(size);
}

// Coming down from orbit: start high in the sky and descend onto the city as the clouds clear.
function arrive(size) {
  controls.autoRotate = false;
  const toPos = camera.position.clone();
  const toTarget = controls.target.clone();
  camera.position.set(size * 0.12, size * 2.6, size * 0.3);
  controls.target.set(0, 0, 0);
  flight = { t: 0, dur: 3.4, fromPos: camera.position.clone(), toPos, fromTarget: controls.target.clone(), toTarget, hop: 0 };
  const veil = $('arrival');
  if (veil) setTimeout(() => veil.classList.add('clear'), 80);
  params.delete('arrive');
  setUrl({ arrive: null });
}

if (params.has('arrive')) $('arrival').classList.add('on');

// Back to the universe, if we came from a world.
const fromWorld = params.get('from');
if (fromWorld) {
  const back = $('orbit');
  back.hidden = false;
  back.href = `./?planet=${encodeURIComponent(fromWorld)}`;
  back.textContent = `↑ Orbit @${fromWorld}`;
}

// ---------- camera flights ----------
function flyTo(path) {
  const b = city.boundsOf(path);
  if (!b) return;
  exitBuilding();
  const target = new THREE.Vector3(b.center.x, b.center.y, b.center.z);
  const dist = Math.max(b.radius * 3.2, 16);
  const dir = camera.position.clone().sub(controls.target).normalize();
  dir.y = Math.max(dir.y, 0.45);
  dir.normalize();
  const toPos = target.clone().addScaledVector(dir, dist);
  const hop = camera.position.distanceTo(toPos) * 0.25; // arc up, like a flight rather than a zoom
  $('tooltip').hidden = true;
  controls.autoRotate = false;
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
controls.addEventListener('start', () => {
  flight = null;
  controls.autoRotate = false;
});

// ---------- entering a building: code + elevator ----------
const reader = new CodeReader($('reader'), {
  onRange: (first, last, total) => {
    if (!elevator) return;
    const [y0, y1] = city.bandOf(elevator.i, (first - 1) / total, last / total);
    uniforms.uBand.value.set(y0, y1);
    elevator.y = city.baseOf(elevator.i) + (y0 + y1) / 2;
    const floors = Math.max(1, Math.round(city.bandOf(elevator.i, 0, 1)[1] / 1.1));
    $('reader-floor').textContent = `Floor ${Math.max(1, Math.round((y0 + y1) / 2 / 1.1))} of ${floors} · lines ${first}–${last}`;
  },
  onClose: () => exitBuilding(),
});

function enterBuilding(i) {
  const f = data.files[i];
  if (!f.alive) return;
  if (timelapse.active) {
    timelapse.finish();
    $('play').textContent = '▶';
    $('timeline').value = 1000;
  }
  flight = null;
  controls.autoRotate = false;
  controls.enabled = false;
  const center = new THREE.Vector3(f.x + f.w / 2, 0, f.z + f.d / 2);
  const dir = camera.position.clone().sub(center).setY(0).normalize();
  if (dir.lengthSq() < 0.5) dir.set(1, 0, 1).normalize();
  // far enough to see ~20 floors around the lines being read
  elevator = { i, center, dir, dist: Math.max(f.w, f.d) * 1.2 + 24, y: city.baseOf(i) + 2 };
  uniforms.uFocus.value = i;
  uniforms.uTunnel.value = Math.max(f.w, f.d) * 0.7 + 6;
  uniforms.uBand.value.set(-1, -1);
  camera.setViewOffset(innerWidth, innerHeight, innerWidth * 0.22, 0, innerWidth, innerHeight);
  camera.updateProjectionMatrix();
  $('info').hidden = true;
  labelRenderer.domElement.hidden = true;
  return reader.show(data, f);
}

function exitBuilding() {
  if (!elevator) return;
  elevator = null;
  uniforms.uFocus.value = -1;
  controls.enabled = true;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  labelRenderer.domElement.hidden = false;
  reader.hide();
  if (selected >= 0) $('info').hidden = false;
}

function updateElevator(dt) {
  if (!elevator) return;
  const { center, dir, dist, y } = elevator;
  const k = Math.min(1, dt * 3);
  const wantPos = new THREE.Vector3(center.x + dir.x * dist, y + 3.5, center.z + dir.z * dist);
  const wantTarget = new THREE.Vector3(center.x, y, center.z);
  camera.position.lerp(wantPos, k);
  controls.target.lerp(wantTarget, k);
  camera.lookAt(controls.target);
  uniforms.uCamPos.value.copy(camera.position);
  uniforms.uFocusPos.value.copy(controls.target);
}

// ---------- selection & info ----------
function select(i) {
  if (selected >= 0 && !timelapse.active) city.setHeat(selected, city.baseHeat[selected]);
  selected = i;
  const f = data.files[i];
  const link = f.alive && data.repo.url ? `<a href="${data.repo.url}/blob/${data.repo.head}/${f.p}" target="_blank" rel="noopener">GitHub ↗</a>` : '';
  const enter = f.alive ? `<button id="enter" class="primary">Enter building ⏎</button>` : '';
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
    <div class="actions">${enter}${link}</div>`;
  $('info').hidden = false;
  if (f.alive) $('enter').onclick = () => enterBuilding(i);
}
$('info-close').onclick = () => {
  if (selected >= 0 && !timelapse.active) city.setHeat(selected, city.baseHeat[selected]);
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
  return city.buildingAt(raycaster.intersectObjects(city.pickables, false)[0]);
}

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!city || hoverPending || elevator) return;
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
  if (elevator || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const i = pick(e);
  if (i >= 0) flyTo(data.files[i].p);
});
renderer.domElement.addEventListener('dblclick', (e) => {
  const i = pick(e);
  if (i >= 0 && data.files[i].alive) enterBuilding(i);
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
  exitBuilding();
  if (timelapse.playing) timelapse.pause();
  else timelapse.play();
  $('play').textContent = timelapse.playing ? '❚❚' : '▶';
};
$('timeline').addEventListener('input', (e) => {
  exitBuilding();
  timelapse.pause();
  $('play').textContent = '▶';
  const v = Number(e.target.value) / 1000;
  if (v >= 1) timelapse.finish();
  else timelapse.seek(v);
});

addEventListener('keydown', (e) => {
  if (e.target === input) return;
  if (e.key === 'Escape' && elevator) exitBuilding();
  else if (e.key === 'Enter' && selected >= 0 && !elevator) enterBuilding(selected);
  else if (e.key === '/') {
    e.preventDefault();
    input.focus();
  } else if (e.key === ' ' && !elevator) {
    e.preventDefault();
    $('play').click();
  }
});

// ---------- frame loop ----------
let last = performance.now();
let time = 0;

function fadeLabels() {
  const size = data?.size ?? 1;
  for (const label of city?.labels.children ?? []) {
    const d = camera.position.distanceTo(label.position);
    label.element.style.opacity = Math.max(0, Math.min(1, (d - size * 0.12) / (size * 0.25)));
  }
}

function stepFrame(dt) {
  time += dt;
  uniforms.uTime.value = time;
  finish.uniforms.uTime.value = time;
  if (timelapse) {
    const wasPlaying = timelapse.playing;
    timelapse.step(dt);
    if (timelapse.playing) $('timeline').value = Math.round(timelapse.progress * 1000);
    if (wasPlaying && !timelapse.playing) {
      $('play').textContent = '▶';
      $('timeline').value = 1000;
    }
  }
  if (city) {
    city.tick(dt, time);
    if (selected >= 0 && !timelapse.active && !elevator) city.setHeat(selected, city.baseHeat[selected] + 0.9 + Math.sin(time * 4) * 0.4);
  }
  updateFlight(dt);
  if (elevator) updateElevator(dt);
  else controls.update();
  atmosphere.follow(camera);
  events?.update(dt);
  const jolt = new THREE.Vector3();
  if (shake) {
    shake.t -= dt;
    const a = shake.amp * Math.max(0, shake.t / shake.dur);
    jolt.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    if (shake.t <= 0) shake = null;
  }
  camera.position.add(jolt);
  composer.render();
  camera.position.sub(jolt);
  if (captionUntil && time > captionUntil) {
    $('caption').classList.remove('show');
    captionUntil = 0;
  }
  fadeLabels();
  labelRenderer.render(scene, camera);
}

function loop() {
  const now = performance.now();
  stepFrame(Math.min((now - last) / 1000, 0.1));
  last = now;
  requestAnimationFrame(loop);
}

// Hooks for scripted capture (Playwright): step with a fixed dt, grab the canvas, repeat.
window.commitropolis = {
  get city() { return city; },
  get timelapse() { return timelapse; },
  get data() { return data; },
  get flight() { return flight; },
  get events() { return events; },
  camera,
  controls,
  reader,
  flyTo,
  enterBuilding,
  exitBuilding,
  stepFrame,
};

await loadIndex();
if (params.has('director')) {
  // the film, part two (tools/video/capture.mjs): no HUD, the director drives every frame
  document.body.classList.add('director');
  finish.uniforms.uGrainAnim.value = 0; // a static dither: moving grain only costs video bitrate
  finish.uniforms.uGrain.value = 0.014;
  const { CityDirector } = await import('./cityDirector.js');
  window.director = new CityDirector(window.commitropolis);
  await window.director.prepare();
} else if (!captureMode) loop();
