import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky, radialTexture } from './sky.js';
import { SECTORS, langColor, hashString, rng, levelOf } from './lore.js';
import { GALAXY, loadCosmos, yearOfId, knotsOf, sampleDust, dustColor, placeMembers, armAngle as armAngleOf } from './cosmos.js';

const RG = 1000; // galaxy radius
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ARM_LANGS = ['JavaScript', 'Python', 'TypeScript', 'Rust', 'Go', 'Java', 'C++', 'C'];
const ARMS = ARM_LANGS.length;
const PITCH = 2.1;

// Fixed regions of the galaxy (docs/LORE.md): angle in radians, distance as a fraction of RG.
const REGIONS = {
  ai: { angle: 0.75, r: 0.52, spread: 0.11, color: '#b77bff' },
  nursery: { angle: 3.55, r: 0.66, spread: 0.08, color: '#ff6f9f' },
  titan: { ring: 0.24 },
  silent: { ring: 0.95 },
};

const gauss = (rand) => {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};
const armAngle = (arm, r) => (arm / ARMS) * Math.PI * 2 + PITCH * Math.log(r / (RG * 0.08));


// Where each named world sits, by the rules in docs/LORE.md. Deterministic per account.
function placeWorlds(accounts) {
  const ids = accounts.map((a) => a.i).sort((a, b) => a - b);
  const rankOf = (id) => {
    let lo = 0;
    let hi = ids.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] < id) lo = mid + 1;
      else hi = mid;
    }
    return lo / ids.length;
  };
  return accounts.map((a) => {
    const rand = rng(hashString(a.l));
    let x, z;
    const reg = REGIONS[a.sector];
    if (a.sector === 'ai' || a.sector === 'nursery') {
      x = Math.cos(reg.angle) * RG * reg.r + gauss(rand) * RG * reg.spread;
      z = Math.sin(reg.angle) * RG * reg.r + gauss(rand) * RG * reg.spread;
    } else if (a.sector === 'titan' || a.sector === 'silent') {
      const r = RG * (reg.ring + gauss(rand) * 0.02);
      const ang = rand() * Math.PI * 2;
      x = Math.cos(ang) * r;
      z = Math.sin(ang) * r;
    } else {
      // older accounts closer to the core: the galaxy grew outward, like GitHub
      const r = RG * (0.1 + Math.pow(rankOf(a.i), 0.85) * 0.82);
      const arm = ARM_LANGS.includes(a.lang) ? ARM_LANGS.indexOf(a.lang) : Math.floor(rand() * ARMS);
      const ang = armAngle(arm, r) + gauss(rand) * 0.1;
      x = Math.cos(ang) * r + gauss(rand) * 12;
      z = Math.sin(ang) * r + gauss(rand) * 12;
    }
    return new THREE.Vector3(x, gauss(rand) * 8, z);
  });
}

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  attribute float aBorn;
  uniform float uTime;
  uniform float uScale;
  uniform float uHover;
  uniform float uYear;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    // a star exists from the year its account (or its region of the disk) was born, with a brief flare
    float born = smoothstep(aBorn, aBorn + 0.35, uYear);
    if (born <= 0.0) {
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float flare = 1.0 + 2.5 * born * (1.0 - born) * 4.0;
    vColor = aColor * flare;
    vTwinkle = 0.8 + 0.2 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 60.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float boost = float(gl_VertexID) == uHover ? 2.2 : 1.0;
    gl_PointSize = clamp(aSize * boost * born * flare * uScale / -mv.z, 1.0, 110.0);
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float core = exp(-d * 18.0);
    float halo = exp(-d * 3.2) * 0.35;
    gl_FragColor = vec4(vColor * (core * 2.2 + halo) * vTwinkle, 1.0);
  }`;

function starMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// One galaxy of the Commitverse (cosmos.js): its dust, its member worlds, its protostars. The spec
// 'all' is every world in a single galaxy with the old sectors, as in the film.
export class GalaxyView {
  constructor(ctx, spec = GALAXY.all) {
    this.ctx = ctx;
    this.spec = spec;
    this.scene = new THREE.Scene();
    this.sky = new Sky(this.scene, { brightness: 0.22 });
    this.disk = new THREE.Group();
    this.scene.add(this.disk);
    this.year = { value: 3000 }; // the galaxy as of this year (3000 = today, everything visible)
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uHover: { value: -1 }, uYear: this.year };
    this.hovered = -1;
    this.built = false;
  }

  get legacy() {
    return this.spec.id === 'all';
  }

  async load() {
    const cosmos = (this.cosmos = await loadCosmos());
    if (!this.data) {
      const accounts = this.legacy ? cosmos.data.accounts : cosmos.members[this.spec.id];
      const nursery = this.legacy ? cosmos.data.nursery : this.spec.id === 'rising' ? cosmos.rising : [];
      this.data = { ...cosmos.data, accounts, nursery };
      this.byLogin = new Map(accounts.map((a, i) => [a.l.toLowerCase(), i]));
      this.knots = this.spec.shape === 'irregular' ? knotsOf(this.spec, RG) : null;
      this.worldPos = this.legacy ? placeWorlds(accounts) : placeMembers(accounts, this.spec, RG, (a) => this.yearOf(a));
    }
    this.news = cosmos.news;
    return this.data;
  }

  yearOf(a) {
    return a.born ?? this.yearOfId(a.i);
  }

  account(login) {
    const i = this.byLogin?.get(login.toLowerCase());
    return i === undefined ? null : this.data.accounts[i];
  }

  // The worlds nearest to this one in the galaxy: its star system. Unknown worlds join their language arm.
  neighboursOf(login, n, fallback) {
    const i = this.byLogin.get(login.toLowerCase());
    const home = i !== undefined ? this.data.accounts[i] : fallback;
    const at = i !== undefined ? this.worldPos[i] : null;
    const others = this.data.accounts
      .map((a, j) => [a, j])
      .filter(([a, j]) => j !== i && (at || a.lang === home.lang))
      .map(([a, j]) => [a, at ? this.worldPos[j].distanceTo(at) : hashString(a.l + home.l)])
      .sort((x, y) => x[1] - y[1])
      .slice(0, n - 1)
      .map(([a]) => a);
    return [home, ...others];
  }

  // Account creation year from its ID, interpolated between real anchors (galaxy.json ages).
  yearOfId(id) {
    return yearOfId(this.data.ages, id);
  }

  // The galaxy as of a given year (the film); 3000 = today.
  setYear(year) {
    this.year.value = year;
    for (const p of this.puffs ?? []) {
      const on = p.ignite ? THREE.MathUtils.smoothstep(year, p.ignite[0], p.ignite[1]) : THREE.MathUtils.smoothstep(year, p.born, p.born + 0.6);
      p.sp.material.opacity = p.opacity * (p.ignite ? on * 1.8 : on);
      p.sp.visible = on > 0.001;
    }
  }

  sectorOf(login) {
    return this.account(login)?.sector ?? 'arm';
  }

  async enter(route = {}) {
    await this.load();
    if (!this.built) this.#build();
    const { camera, controls, ui } = this.ctx;
    camera.near = 1;
    camera.far = 30000;
    camera.updateProjectionMatrix();
    controls.enabled = true;
    controls.minDistance = 60;
    controls.maxDistance = RG * 3.2;
    controls.zoomToCursor = true; // dive into whichever part of the galaxy you point at
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.18;
    const focus = this.legacy && route.sector && this.sectorCenters[route.sector];
    if (focus) {
      controls.target.copy(focus);
      camera.position.copy(focus).add(new THREE.Vector3(0, RG * 0.35, RG * 0.45));
    } else {
      controls.target.set(0, 0, 0);
      camera.position.set(RG * 0.35, RG * 1.5, RG * 1.95);
    }
    this.flying = null;
    const from = route.fromStar ? this.byLogin.get(route.fromStar.toLowerCase()) : undefined;
    if (from !== undefined) {
      // we zoomed out of this star's system: start beside the star and pull back into its region
      this.disk.updateMatrixWorld(true);
      const at = this.worldPos[from].clone().applyMatrix4(this.disk.matrixWorld);
      const outward = at.clone().setY(0).normalize();
      const start = at.clone().addScaledVector(outward, 22).add(new THREE.Vector3(0, 9, 0));
      camera.position.copy(start);
      controls.target.copy(at);
      controls.autoRotate = false;
      this.flying = { t: 0, dur: 2.8, fromPos: start, toPos: at.clone().addScaledVector(outward, RG * 0.42).add(new THREE.Vector3(0, RG * 0.32, 0)), fromTarget: at, toTarget: at.clone(), then: null, fadeIn: 'dark' };
    } else if (route.fromUniverse) {
      // arriving from the cluster: the whole galaxy rushes in out of the distance
      const home = camera.position.clone();
      camera.position.multiplyScalar(3.4);
      controls.autoRotate = false;
      this.flying = { t: 0, dur: 2.6, fromPos: camera.position.clone(), toPos: home, fromTarget: new THREE.Vector3(), toTarget: new THREE.Vector3(), then: null, fadeIn: 'dark' };
    }
    ui.card(this.#cardHtml(route.sector));
    this.#wireCard();
    ui.hint('Drag to rotate · zoom toward any star and keep going to enter its system · click a star to visit its world');
  }

  get ownsFade() {
    return !!this.flying?.fadeIn;
  }

  zoomTarget(dir, event) {
    if (this.flying) return null;
    if (dir === 'out') {
      if (this.ctx.controls.target.length() > 40) return { label: `The whole of ${this.spec.name.replace(/^The /, 'the ')}`, go: () => this.overview() };
      return this.legacy ? null : { label: 'Out to the Commitverse: every galaxy', go: () => this.zoomOut() };
    }
    let { index, kind } = this.#pick(event, 90);
    if (index < 0) ({ index, kind } = this.#nearest(this.ctx.controls.target, 220));
    if (index < 0) return null;
    const login = kind === 'world' ? this.data.accounts[index].l : this.data.nursery[index].r.split('/')[0];
    return { label: `Into @${login}'s star system`, go: () => this.visit(login, 'system') };
  }

  // The star nearest a point in space: zoomed all the way in, you enter whatever you're looking at
  // (zooming toward the cursor can carry the camera past the star that was under it).
  #nearest(at, radius) {
    const v = new THREE.Vector3();
    let best = -1;
    let bestD = radius;
    let kind = null;
    const test = (list, k) =>
      list.forEach((p, i) => {
        const d = v.copy(p).applyMatrix4(this.disk.matrixWorld).distanceTo(at);
        if (d < bestD) {
          bestD = d;
          best = i;
          kind = k;
        }
      });
    test(this.worldPos, 'world');
    test(this.protoPos ?? [], 'proto');
    return { index: best, kind };
  }

  // back out to the whole galaxy, centred on the singularity
  overview() {
    const { camera, controls } = this.ctx;
    this.flying = { t: 0, dur: 2.4, fromPos: camera.position.clone(), toPos: new THREE.Vector3(RG * 0.35, RG * 1.5, RG * 1.95), fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(), then: null };
    controls.autoRotate = false;
    if (!this.legacy) history.replaceState({ galaxy: this.spec.id }, '', `?galaxy=${this.spec.id}`);
  }

  zoomOut() {
    this.ctx.leave(() => this.ctx.go({ fromGalaxy: this.spec.id }));
  }

  #build() {
    this.built = true;
    this.#buildDust();
    this.#buildWorlds();
    this.#buildNursery();
    this.#buildSingularity();
    this.#buildLabels();
    this.#buildSupernovae();
  }

  // The fastest-rising protostars flare up one after another: supernovae (tools/universe/events.mjs).
  #buildSupernovae() {
    if (!this.data.nursery.length) return;
    const tex = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.12, 'rgba(255,220,240,0.9)'],
      [0.35, 'rgba(255,120,180,0.25)'],
      [1, 'rgba(255,80,160,0)'],
    ]);
    const ringTex = radialTexture([
      [0, 'rgba(255,255,255,0)'],
      [0.82, 'rgba(255,255,255,0)'],
      [0.9, 'rgba(255,190,230,0.8)'],
      [1, 'rgba(255,190,230,0)'],
    ]);
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2.6, 1.6, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.shell = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(2, 1.3, 1.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    const el = document.createElement('div');
    el.className = 'nova-label';
    this.novaLabel = new CSS2DObject(el);
    this.disk.add(this.flare, this.shell, this.novaLabel);
    this.novae = this.news
      .filter((e) => e.type === 'supernova')
      .map((e) => ({ e, i: this.data.nursery.findIndex((p) => p.r === e.repo) }))
      .filter((n) => n.i >= 0)
      .slice(0, 8);
  }

  #updateSupernovae(time) {
    if (!this.novae?.length) return;
    // the protostars are this year's: before they're born (the film), there's nothing to explode
    const on = this.year.value > 2025.6;
    this.flare.visible = this.shell.visible = this.novaLabel.visible = on;
    if (!on) return;
    const period = 5;
    const k = Math.floor(time / period) % this.novae.length;
    const phase = (time % period) / period;
    const nova = this.novae[k];
    const at = this.protoPos[nova.i];
    this.flare.position.copy(at);
    this.shell.position.copy(at);
    this.novaLabel.position.copy(at).add(new THREE.Vector3(0, 18, 0));
    const burst = Math.exp(-phase * 6);
    this.flare.material.opacity = Math.min(1, burst * 1.4);
    this.flare.scale.setScalar(20 + burst * 90);
    this.shell.material.opacity = Math.max(0, 0.8 - phase);
    this.shell.scale.setScalar(20 + phase * 160);
    this.novaLabel.element.textContent = phase < 0.75 ? `✷ ${nova.e.repo}` : '';
    this.novaLabel.element.style.opacity = phase < 0.75 ? 1 : 0;
  }

  // ~120k unnamed stars: bulge + 8 language arms + nebula haze for the named regions.
  #buildDust() {
    if (!this.legacy) return this.#buildSpecDust();
    const rand = rng(0.4242);
    const n = 120000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    const born = new Float32Array(n);
    const c = new THREE.Color();
    const core = new THREE.Color('#ffd7a0');
    for (let i = 0; i < n; i++) {
      let x, y, z;
      if (i < n * 0.18) {
        // bulge
        const r = Math.abs(gauss(rand)) * RG * 0.12;
        const a = rand() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        y = gauss(rand) * RG * 0.035 * (1 - r / (RG * 0.4));
        c.copy(core).multiplyScalar(0.18 + rand() * 0.3);
      } else {
        const arm = Math.floor(rand() * ARMS);
        const r = RG * (0.08 + Math.pow(rand(), 0.7) * 0.92);
        const a = armAngle(arm, r) + gauss(rand) * 0.22 * (1.1 - r / RG * 0.4);
        const spread = gauss(rand) * RG * 0.025;
        x = Math.cos(a) * r + spread;
        z = Math.sin(a) * r + spread;
        y = gauss(rand) * RG * 0.012;
        c.set(langColor(ARM_LANGS[arm])).lerp(new THREE.Color('#dfe8ff'), 0.45 + rand() * 0.3).multiplyScalar(0.08 + rand() * 0.22);
      }
      pos.set([x, y, z], i * 3);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 1.5 + rand() * 3.5;
      phase[i] = rand();
      born[i] = 2007.6 + Math.pow(Math.hypot(x, z) / RG, 1.15) * 18.6 + rand() * 0.4; // the disk grows outward
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
    this.dust = new THREE.Points(geo, starMaterial({ uTime: this.uniforms.uTime, uScale: this.uniforms.uScale, uHover: { value: -1 }, uYear: this.year }));
    this.disk.add(this.dust);

    // haze: soft sprites along the arms and inside the named nebulae
    const tex = radialTexture([
      [0, 'rgba(255,255,255,0.55)'],
      [0.4, 'rgba(255,255,255,0.16)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const haze = new THREE.Group();
    this.puffs = [];
    const addPuff = (x, y, z, s, color, opacity, born = 2007.6 + Math.pow(Math.hypot(x, z) / RG, 1.15) * 18.6, ignite = null) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(x, y, z);
      sp.scale.setScalar(s);
      haze.add(sp);
      this.puffs.push({ sp, opacity, born, ignite });
    };
    for (let i = 0; i < 900; i++) {
      const arm = i % ARMS;
      const r = RG * (0.1 + Math.pow(rand(), 0.8) * 0.85);
      const a = armAngle(arm, r) + gauss(rand) * 0.12;
      addPuff(Math.cos(a) * r, gauss(rand) * 6, Math.sin(a) * r, 60 + rand() * 140, new THREE.Color(langColor(ARM_LANGS[arm])).lerp(new THREE.Color('#9fb3ff'), 0.5), 0.018 + rand() * 0.025);
    }
    addPuff(0, 0, 0, RG * 0.5, new THREE.Color('#ffc07a'), 0.28, 2007.5);
    for (const key of ['ai', 'nursery']) {
      const reg = REGIONS[key];
      const cx = Math.cos(reg.angle) * RG * reg.r;
      const cz = Math.sin(reg.angle) * RG * reg.r;
      for (let i = 0; i < 70; i++) {
        // the AI Nebula ignites with the LLM wave (2022-2025); the Nursery holds this year's protostars
        addPuff(cx + gauss(rand) * RG * reg.spread, gauss(rand) * 10, cz + gauss(rand) * RG * reg.spread, 90 + rand() * 200, new THREE.Color(reg.color), 0.04 + rand() * 0.05, 0, key === 'ai' ? [2022.6, 2024.8] : [2025.2, 2026.2]);
      }
    }
    // dark dust lanes on the inner edge of each arm, for contrast
    const dark = new THREE.Group();
    for (let i = 0; i < 520; i++) {
      const arm = i % ARMS;
      const r = RG * (0.12 + Math.pow(rand(), 0.8) * 0.8);
      const a = armAngle(arm, r) - 0.16 + gauss(rand) * 0.05;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.18 + rand() * 0.2, depthWrite: false }));
      sp.position.set(Math.cos(a) * r, 2, Math.sin(a) * r);
      sp.scale.setScalar(40 + rand() * 90);
      dark.add(sp);
    }
    this.disk.add(haze, dark);
  }

  // Named worlds: one star per account, placed by placeWorlds() (docs/LORE.md).
  #buildWorlds() {
    const accounts = this.data.accounts;
    const n = accounts.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    const born = new Float32Array(n);
    const c = new THREE.Color();
    accounts.forEach((a, i) => {
      born[i] = this.yearOf(a);
      const rand = rng(hashString(`${a.l}:look`));
      const p = this.worldPos[i];
      pos.set([p.x, p.y, p.z], i * 3);
      const sector = SECTORS[a.sector] ?? SECTORS.arm;
      if (this.legacy) c.set(a.sector === 'arm' ? langColor(a.lang) : sector.color);
      else c.set(langColor(a.lang)).lerp(new THREE.Color(this.spec.color), this.spec.langs ? 0.15 : 0.45);
      c.lerp(new THREE.Color('#ffffff'), 0.35);
      col.set([c.r * 1.25, c.g * 1.25, c.b * 1.25], i * 3);
      size[i] = 5 + Math.log10(1 + a.s) * 5;
      phase[i] = rand();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
    this.worlds = new THREE.Points(geo, starMaterial(this.uniforms));
    this.disk.add(this.worlds);
  }

  #buildNursery() {
    const reg = REGIONS.nursery;
    const list = this.data.nursery;
    const pos = new Float32Array(list.length * 3);
    const col = new Float32Array(list.length * 3);
    const size = new Float32Array(list.length);
    const phase = new Float32Array(list.length);
    const born = new Float32Array(list.length);
    this.protoPos = [];
    list.forEach((p, i) => {
      const rand = rng(hashString(p.r));
      // in the Rising Galaxy, protostars crowd its star-forming knots
      const knot = this.knots?.[Math.floor(rand() * this.knots.length)];
      const x = knot ? knot.x + gauss(rand) * knot.s * 0.7 : Math.cos(reg.angle) * RG * reg.r + gauss(rand) * RG * reg.spread * 0.8;
      const z = knot ? knot.z + gauss(rand) * knot.s * 0.7 : Math.sin(reg.angle) * RG * reg.r + gauss(rand) * RG * reg.spread * 0.8;
      const y = gauss(rand) * (knot ? knot.s * 0.25 : 10);
      pos.set([x, y, z], i * 3);
      this.protoPos.push(new THREE.Vector3(x, y, z));
      col.set([2.4, 1.2, 1.7], i * 3);
      size[i] = 6 + Math.log10(1 + p.s) * 5;
      phase[i] = rand();
      born[i] = 1970 + p.c / 31557600;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
    this.protostars = new THREE.Points(geo, starMaterial({ uTime: this.uniforms.uTime, uScale: this.uniforms.uScale, uHover: { value: -1 }, uYear: this.year }));
    this.disk.add(this.protostars);
  }

  // git: a black hole at the centre with a hot accretion disk.
  #buildSingularity() {
    if (!this.legacy) return this.#buildCore();
    const group = new THREE.Group();
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(14, 64, 256, 4),
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.uniforms.uTime },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() {
            vP = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vP;
          void main() {
            float r = length(vP);
            float a = atan(vP.y, vP.x);
            float t = clamp((r - 14.0) / 50.0, 0.0, 1.0);
            float streaks = 0.6 + 0.4 * sin(a * 7.0 + r * 0.35 - uTime * 1.6) * sin(a * 3.0 - r * 0.2 + uTime * 0.7);
            vec3 hot = mix(vec3(1.6, 1.35, 1.1), vec3(1.4, 0.45, 0.12), t);
            float fade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 1.0, t));
            gl_FragColor = vec4(hot * streaks * fade * 2.0, 1.0);
          }`,
      })
    );
    disk.rotation.x = -Math.PI / 2 + 0.28;
    const hole = new THREE.Mesh(new THREE.SphereGeometry(12, 48, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture([
          [0, 'rgba(0,0,0,0)'],
          [0.16, 'rgba(0,0,0,0)'],
          [0.2, 'rgba(255,200,140,0.9)'],
          [0.45, 'rgba(255,140,60,0.18)'],
          [1, 'rgba(255,120,40,0)'],
        ]),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: new THREE.Color(2, 1.6, 1.2),
      })
    );
    glow.scale.setScalar(150);
    group.add(glow, disk, hole);
    this.disk.add(group);
    this.singularity = group;
  }

  #buildLabels() {
    if (!this.legacy) return this.#buildBeacons();
    this.sectorCenters = {
      singularity: new THREE.Vector3(0, 0, 0),
      ancient: new THREE.Vector3(RG * 0.14, 0, -RG * 0.13),
      titan: new THREE.Vector3(-RG * 0.26, 0, RG * 0.1),
      ai: new THREE.Vector3(Math.cos(REGIONS.ai.angle) * RG * REGIONS.ai.r, 0, Math.sin(REGIONS.ai.angle) * RG * REGIONS.ai.r),
      nursery: new THREE.Vector3(Math.cos(REGIONS.nursery.angle) * RG * REGIONS.nursery.r, 0, Math.sin(REGIONS.nursery.angle) * RG * REGIONS.nursery.r),
      arm: new THREE.Vector3(Math.cos(armAngle(1, RG * 0.6)) * RG * 0.6, 0, Math.sin(armAngle(1, RG * 0.6)) * RG * 0.6),
      silent: new THREE.Vector3(0, 0, -RG * 0.95),
      frontier: new THREE.Vector3(RG * 0.9, 0, RG * 0.5),
    };
    this.labels = [];
    for (const [key, at] of Object.entries(this.sectorCenters)) {
      const s = SECTORS[key];
      const el = document.createElement('button');
      el.className = 'sector-label';
      el.style.setProperty('--c', s.color);
      el.textContent = key === 'singularity' ? 'git · The Singularity' : s.name;
      el.onclick = () => this.focusSector(key);
      const label = new CSS2DObject(el);
      label.position.copy(at).add(new THREE.Vector3(0, key === 'singularity' ? 40 : 30, 0));
      this.disk.add(label);
      this.labels.push(label);
    }
  }

  focusSector(key) {
    const { camera, controls, ui } = this.ctx;
    const at = this.sectorCenters[key].clone().applyMatrix4(this.disk.matrixWorld);
    this.flying = { t: 0, dur: 2.2, fromPos: camera.position.clone(), toPos: at.clone().add(new THREE.Vector3(0, RG * 0.28, RG * 0.36)), fromTarget: controls.target.clone(), toTarget: at, then: null };
    controls.autoRotate = false;
    ui.card(this.#cardHtml(key));
    this.#wireCard();
    history.replaceState({ sector: key }, '', `?sector=${key}`);
  }

  #cardHtml(sectorKey) {
    if (!this.legacy) return this.#specCardHtml();
    const accounts = this.data.accounts;
    const inSector = sectorKey && sectorKey !== 'singularity' ? accounts.filter((a) => a.sector === sectorKey) : accounts;
    const s = sectorKey ? SECTORS[sectorKey] : null;
    const worlds = inSector
      .slice(0, 12)
      .map((a) => `<li data-login="${a.l}"><span class="dot" style="background:${a.sector === 'arm' ? langColor(a.lang) : SECTORS[a.sector].color}"></span><span class="cname">@${a.l}</span><span class="tier">${levelOf(a.s).name}</span><span class="stars">${fmt(a.s)} ★</span></li>`)
      .join('');
    const protos = this.data.nursery
      .slice(0, 6)
      .map((p) => `<li data-login="${p.r.split('/')[0]}"><span class="dot" style="background:#ff6f9f"></span><span class="cname">${p.r}</span><span class="stars">${fmt(p.s)} ★</span></li>`)
      .join('');
    const showcase = ['karpathy', 'sindresorhus', 'torvalds', 'tj', 'antirez', 'ggerganov', 'simonw', 'mitchellh']
      .map((l) => `<button class="chip world" data-login="${l}">@${l}</button>`)
      .join('');
    return `
      <div class="world-name">${s ? s.name : 'The Commitverse'}</div>
      <p class="level-text">${s ? s.text : `${fmt(accounts.length)} charted worlds and ${this.data.nursery.length} protostars, seeded from the most-starred repositories in ${23} languages. Every star is a real GitHub account.`}</p>
      ${sectorKey === 'singularity' ? '<p class="bio">In 2005 a single commit set off a singularity. Everything on this map is built with it.</p>' : ''}
      <h4>Visit a showcase world</h4>
      <div class="chips">${showcase}</div>
      <h4>${s ? 'Brightest worlds here' : 'Brightest worlds'}</h4>
      <ul class="cities">${worlds}</ul>
      ${!sectorKey || sectorKey === 'nursery' ? `<h4>Rising in the Stellar Nursery</h4><ul class="cities">${protos}</ul>` : ''}
      ${!sectorKey ? `<h4>Galactic news</h4><ul class="news">${this.#newsHtml()}</ul>` : ''}`;
  }

  #newsHtml(keep = () => true) {
    const icon = { supernova: '✷', launch: '🚀', impact: '☄', ignition: '✦', migration: '↗', joined: '⭐' };
    const news = this.news.filter(keep);
    const pick = [...news.filter((e) => e.type === 'ignition').slice(0, 3), ...news.filter((e) => e.type === 'supernova').slice(0, 3), ...news.filter((e) => e.type !== 'supernova' && e.type !== 'ignition').slice(0, 6)].sort((a, b) => b.t - a.t);
    return pick
      .map((e, k) => `<li data-news="${this.news.indexOf(e)}"><span class="ni">${icon[e.type]}</span><span><b>${e.title}</b><small>${e.detail} · ${new Date(e.t * 1000).toISOString().slice(0, 10)}</small></span></li>`)
      .join('');
  }

  #wireCard() {
    this.ctx.ui.cardEl.querySelectorAll('[data-login]').forEach((el) => {
      el.onclick = () => this.visit(el.dataset.login);
    });
    const out = this.ctx.ui.cardEl.querySelector('#to-universe');
    if (out) out.onclick = () => this.zoomOut();
    this.ctx.ui.cardEl.querySelectorAll('[data-news]').forEach((el) => {
      const e = this.news[Number(el.dataset.news)];
      el.onclick = () => {
        if (e.target.city) location.href = `city.html?repo=${encodeURIComponent(e.target.city)}&from=${encodeURIComponent(e.target.from)}`;
        else this.visit(e.target.planet);
      };
    });
  }

  // Fly into a star, then hand over to the planet view.
  visit(login, to = 'planet') {
    const { camera, controls } = this.ctx;
    const idx = this.data.accounts.findIndex((a) => a.l.toLowerCase() === login.toLowerCase());
    const at = idx >= 0 ? this.worldPos[idx].clone().applyMatrix4(this.disk.matrixWorld) : controls.target.clone();
    const dir = camera.position.clone().sub(at).normalize();
    this.flying = { t: 0, dur: 1.6, fromPos: camera.position.clone(), toPos: at.clone().addScaledVector(dir, 6), fromTarget: controls.target.clone(), toTarget: at, then: () => this.ctx.go(to === 'system' ? { system: login } : { planet: login }) };
    controls.autoRotate = false;
  }

  // Dust, haze and dark lanes in the galaxy's own shape and light (cosmos.js).
  #buildSpecDust() {
    const spec = this.spec;
    const rand = rng(hashString(`${spec.id}:dust`));
    const n = spec.shape === 'elliptical' ? 70000 : 90000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    const born = new Float32Array(n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = sampleDust(spec, rand, RG, this.knots);
      pos.set([s.x, s.y, s.z], i * 3);
      dustColor(spec, s.arm, s.f, rand, c).multiplyScalar(0.08 + rand() * 0.22 + (s.arm === -1 ? 0.12 : 0));
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 1.5 + rand() * 3.5;
      phase[i] = rand();
      born[i] = 2007.6 + Math.pow(Math.min(1, s.f), 1.15) * 18.6 + rand() * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
    this.dust = new THREE.Points(geo, starMaterial({ uTime: this.uniforms.uTime, uScale: this.uniforms.uScale, uHover: { value: -1 }, uYear: this.year }));
    this.disk.add(this.dust);

    const tex = radialTexture([
      [0, 'rgba(255,255,255,0.55)'],
      [0.4, 'rgba(255,255,255,0.16)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const haze = new THREE.Group();
    this.puffs = [];
    const addPuff = (x, y, z, s, color, opacity, at = 2007.6 + Math.pow(Math.min(1, Math.hypot(x, z) / RG), 1.15) * 18.6) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(x, y, z);
      sp.scale.setScalar(s);
      haze.add(sp);
      this.puffs.push({ sp, opacity, born: at, ignite: null });
    };
    for (let i = 0; i < 520; i++) {
      const s = sampleDust(spec, rand, RG, this.knots);
      if (s.arm === -1 && rand() < 0.7) continue;
      addPuff(s.x, s.y, s.z, 60 + rand() * 150, dustColor(spec, s.arm, s.f, rand, new THREE.Color()).lerp(new THREE.Color('#9fb3ff'), 0.4), 0.018 + rand() * 0.026);
    }
    addPuff(0, 0, 0, RG * (spec.shape === 'elliptical' ? 0.85 : 0.5), new THREE.Color(spec.color).lerp(new THREE.Color('#ffc07a'), 0.5), spec.shape === 'elliptical' ? 0.32 : 0.26, 2007.5);
    for (const k of this.knots ?? []) {
      for (let i = 0; i < 22; i++) addPuff(k.x + gauss(rand) * k.s, gauss(rand) * 8, k.z + gauss(rand) * k.s, 70 + rand() * 160, new THREE.Color(rand() < 0.7 ? '#ff6f9f' : '#7fb8ff'), 0.05 + rand() * 0.05);
    }
    this.disk.add(haze);
    if (spec.shape === 'spiral' || spec.shape === 'barred') {
      // dark dust lanes along the inner edge of each arm, for contrast
      const dark = new THREE.Group();
      const arms = spec.arms ?? 4;
      for (let i = 0; i < 420; i++) {
        const arm = i % arms;
        const r = RG * (0.12 + Math.pow(rand(), 0.8) * 0.8);
        const a = armAngleOf(arm, r, RG, arms, spec.pitch) - 0.16 + gauss(rand) * 0.05;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.18 + rand() * 0.2, depthWrite: false }));
        sp.position.set(Math.cos(a) * r, 2, Math.sin(a) * r);
        sp.scale.setScalar(40 + rand() * 90);
        dark.add(sp);
      }
      this.disk.add(dark);
    }
  }

  // The bright heart of a galaxy (git itself sits at the centre of the whole cluster).
  #buildCore() {
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture([
          [0, 'rgba(255,255,255,1)'],
          [0.14, 'rgba(255,244,226,0.65)'],
          [0.45, 'rgba(255,214,170,0.12)'],
          [1, 'rgba(255,190,130,0)'],
        ]),
        color: new THREE.Color(this.spec.color).lerp(new THREE.Color('#fff1d6'), 0.6).multiplyScalar(1.5),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.scale.setScalar(this.spec.shape === 'elliptical' ? 340 : 230);
    this.singularity = new THREE.Group();
    this.singularity.add(glow);
    this.disk.add(this.singularity);
  }

  // Beacons on the brightest worlds, and a name on each arm of a galaxy of several languages.
  #buildBeacons() {
    this.sectorCenters = {};
    this.labels = [];
    const add = (html, at, className, onclick, color) => {
      const el = document.createElement('button');
      el.className = className;
      if (color) el.style.setProperty('--c', color);
      el.innerHTML = html;
      el.onclick = onclick;
      const label = new CSS2DObject(el);
      label.position.copy(at);
      this.disk.add(label);
      this.labels.push(label);
    };
    this.data.accounts.slice(0, 7).forEach((a, i) => add(`@${a.l}<small>${fmt(a.s)} ★</small>`, this.worldPos[i].clone().add(new THREE.Vector3(0, 16, 0)), 'world-label beacon', () => this.visit(a.l)));
    const langs = this.spec.langs ?? [];
    const arms = this.spec.arms ?? 4;
    if (langs.length > 1) {
      for (let k = 0; k < Math.min(arms, langs.length); k++) {
        const r = RG * 0.7;
        const a = armAngleOf(k, r, RG, arms, this.spec.pitch);
        add(`${langs[k]}`, new THREE.Vector3(Math.cos(a) * r, 30, Math.sin(a) * r), 'sector-label', null, langColor(langs[k]));
      }
    }
  }

  #specCardHtml() {
    const s = this.spec;
    const acc = this.data.accounts;
    const li = (a) => `<li data-login="${a.l}"><span class="dot" style="background:${langColor(a.lang)}"></span><span class="cname">@${a.l}</span><span class="tier">${levelOf(a.s).name}</span><span class="stars">${fmt(a.s)} ★</span></li>`;
    const proto = (p) => `<li data-login="${p.r.split('/')[0]}"><span class="dot" style="background:#ff6f9f"></span><span class="cname">${p.r}</span><span class="stars">${fmt(p.s)} ★</span></li>`;
    const logins = new Set([...acc.map((a) => a.l.toLowerCase()), ...this.data.nursery.map((p) => p.r.split('/')[0].toLowerCase())]);
    const mine = (e) => logins.has(String(e.target?.planet ?? e.target?.from ?? e.repo?.split('/')[0] ?? '').toLowerCase());
    const news = this.#newsHtml(mine);
    const total = acc.reduce((n, a) => n + a.s, 0) + this.data.nursery.reduce((n, p) => n + p.s, 0);
    const promoted = s.id === 'titan' ? this.cosmos.promoted : [];
    return `
      <div class="world-name" style="color:${s.color}">${s.name}</div>
      <p class="level-text">${s.text}</p>
      <div class="stats">
        <div><b>${fmt(s.id === 'rising' ? this.data.nursery.length : acc.length)}</b><span>${s.id === 'rising' ? 'protostars' : 'worlds'}</span></div>
        ${s.id === 'rising' ? `<div><b>${new Set(this.data.nursery.map((p) => p.lang)).size}</b><span>languages</span></div>` : `<div><b>${fmt(acc.filter((a) => a.t === 'O').length)}</b><span>organisations</span></div>`}
        <div><b>${total >= 1e6 ? `${(total / 1e6).toFixed(1)}M` : fmt(total)}</b><span>stars</span></div>
      </div>
      ${promoted.length ? `<h4>Ignited this year <small>arrived from the Rising Galaxy</small></h4><ul class="cities">${promoted.map((a) => `<li data-login="${a.l}"><span class="dot" style="background:#ff6f9f"></span><span class="cname">${a.promoted.repo}</span><span class="stars">${fmt(a.promoted.stars)} ★</span></li>`).join('')}</ul>` : ''}
      ${s.id === 'rising' ? `<h4>Climbing fastest</h4><ul class="cities">${this.data.nursery.slice(0, 12).map(proto).join('')}</ul><p class="note">At ${fmt(100000)} ★ a protostar ignites and migrates to the Titan Galaxy.</p>` : ''}
      ${acc.length ? `<h4>Brightest worlds</h4><ul class="cities">${acc.slice(0, 14).map(li).join('')}</ul>` : ''}
      ${news ? `<h4>News from this galaxy</h4><ul class="news">${news}</ul>` : ''}
      <p><button id="to-universe" class="chip world">↥ Out to the Commitverse</button></p>`;
  }

  #pick(event, radius = 14) {
    const cam = this.ctx.camera;
    const v = new THREE.Vector3();
    let best = -1;
    let bestD = radius;
    let kind = null;
    const test = (list, k) => {
      list.forEach((p, i) => {
        v.copy(p).applyMatrix4(this.disk.matrixWorld).project(cam);
        if (v.z > 1) return;
        const sx = (v.x * 0.5 + 0.5) * innerWidth;
        const sy = (-v.y * 0.5 + 0.5) * innerHeight;
        const d = Math.hypot(sx - event.clientX, sy - event.clientY);
        if (d < bestD) {
          bestD = d;
          best = i;
          kind = k;
        }
      });
    };
    test(this.worldPos, 'world');
    test(this.protoPos, 'proto');
    return { index: best, kind };
  }

  pointerMove(event) {
    if (this.flying) return;
    const { index, kind } = this.#pick(event);
    this.uniforms.uHover.value = kind === 'world' ? index : -1;
    const tip = this.ctx.ui.tooltipEl;
    if (index < 0) {
      tip.hidden = true;
      return;
    }
    if (kind === 'world') {
      const a = this.data.accounts[index];
      const lv = levelOf(a.s);
      tip.innerHTML = `<b>@${a.l}</b> · ${this.legacy ? (SECTORS[a.sector] ?? SECTORS.arm).name : this.spec.name}${a.promoted ? ' · ignited this year' : ''}<br>${fmt(a.s)} ★ · Level ${lv.level} ${lv.name}<br><span class="desc">${a.lang} · ${a.top.join(', ')}</span><br><em>Click to visit this world</em>`;
    } else {
      const p = this.data.nursery[index];
      tip.innerHTML = `<b>${p.r}</b> · protostar<br>${fmt(p.s)} ★ · born ${new Date(p.c * 1000).toISOString().slice(0, 10)}<br><span class="desc">${p.lang}</span><br><em>Click to visit its world</em>`;
    }
    tip.style.left = `${Math.min(event.clientX + 16, innerWidth - 320)}px`;
    tip.style.top = `${event.clientY + 16}px`;
    tip.hidden = false;
  }

  click(ray, event) {
    if (this.flying) return;
    const { index, kind } = this.#pick(event);
    if (index < 0) return;
    this.ctx.ui.tooltipEl.hidden = true;
    const login = kind === 'world' ? this.data.accounts[index].l : this.data.nursery[index].r.split('/')[0];
    this.visit(login);
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    // points keep their size in the picture whatever the field of view (a vertical film widens it)
    this.uniforms.uScale.value = (innerHeight * 0.9 * 0.41421356) / Math.tan((this.ctx.camera.fov * Math.PI) / 360);
    this.disk.rotation.y += dt * 0.004;
    this.singularity.rotation.y += dt * 0.25;
    this.#updateSupernovae(time);
    this.sky.update(this.ctx.camera, new THREE.Vector3(0, 1, 0));
    const f = this.flying;
    if (f) {
      const { camera, controls, ui } = this.ctx;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
      camera.position.lerpVectors(f.fromPos, f.toPos, e);
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      camera.lookAt(controls.target);
      if (f.then) ui.fade(Math.max(0, (f.t - 0.7) / 0.3));
      else if (f.fadeIn) ui.fade(Math.max(0, 1 - (f.t * f.dur) / 0.35), f.fadeIn);
      if (f.t >= 1) {
        if (!f.then) controls.autoRotate = true;
        const then = f.then;
        this.flying = null;
        then?.();
      }
    }
    const camDist = this.ctx.camera.position.distanceTo(this.ctx.controls.target);
    for (const label of this.labels) label.element.style.opacity = Math.min(1, camDist / 500);
  }
}
