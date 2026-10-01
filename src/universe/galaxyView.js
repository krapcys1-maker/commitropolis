import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky, radialTexture } from './sky.js';
import { SECTORS, langColor, hashString, rng, levelOf } from './lore.js';

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
  uniform float uTime;
  uniform float uScale;
  uniform float uHover;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vColor = aColor;
    vTwinkle = 0.8 + 0.2 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 60.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float boost = float(gl_VertexID) == uHover ? 2.2 : 1.0;
    gl_PointSize = clamp(aSize * boost * uScale / -mv.z, 1.0, 96.0);
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

export class GalaxyView {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.sky = new Sky(this.scene, { brightness: 0.22 });
    this.disk = new THREE.Group();
    this.scene.add(this.disk);
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uHover: { value: -1 } };
    this.hovered = -1;
    this.built = false;
  }

  async load() {
    this.dataPromise ??= fetch('universe/galaxy.json').then((r) => r.json());
    this.data = await this.dataPromise;
    this.byLogin ??= new Map(this.data.accounts.map((a, i) => [a.l.toLowerCase(), i]));
    this.worldPos ??= placeWorlds(this.data.accounts);
    this.newsPromise ??= fetch('universe/events.json')
      .then((r) => ((r.headers.get('content-type') ?? '').includes('json') ? r.json() : { events: [] }))
      .catch(() => ({ events: [] }));
    this.news = (await this.newsPromise).events;
    return this.data;
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
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.18;
    const focus = route.sector && this.sectorCenters[route.sector];
    if (focus) {
      controls.target.copy(focus);
      camera.position.copy(focus).add(new THREE.Vector3(0, RG * 0.35, RG * 0.45));
    } else {
      controls.target.set(0, 0, 0);
      camera.position.set(RG * 0.35, RG * 1.5, RG * 1.95);
    }
    this.flying = null;
    ui.card(this.#cardHtml(route.sector));
    this.#wireCard();
    ui.hint('Drag to rotate · scroll to zoom · click a star to visit its world');
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
    const rand = rng(0.4242);
    const n = 120000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
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
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.dust = new THREE.Points(geo, starMaterial({ uTime: this.uniforms.uTime, uScale: this.uniforms.uScale, uHover: { value: -1 } }));
    this.disk.add(this.dust);

    // haze: soft sprites along the arms and inside the named nebulae
    const tex = radialTexture([
      [0, 'rgba(255,255,255,0.55)'],
      [0.4, 'rgba(255,255,255,0.16)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const haze = new THREE.Group();
    const addPuff = (x, y, z, s, color, opacity) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(x, y, z);
      sp.scale.setScalar(s);
      haze.add(sp);
    };
    for (let i = 0; i < 900; i++) {
      const arm = i % ARMS;
      const r = RG * (0.1 + Math.pow(rand(), 0.8) * 0.85);
      const a = armAngle(arm, r) + gauss(rand) * 0.12;
      addPuff(Math.cos(a) * r, gauss(rand) * 6, Math.sin(a) * r, 60 + rand() * 140, new THREE.Color(langColor(ARM_LANGS[arm])).lerp(new THREE.Color('#9fb3ff'), 0.5), 0.018 + rand() * 0.025);
    }
    addPuff(0, 0, 0, RG * 0.5, new THREE.Color('#ffc07a'), 0.28);
    for (const key of ['ai', 'nursery']) {
      const reg = REGIONS[key];
      const cx = Math.cos(reg.angle) * RG * reg.r;
      const cz = Math.sin(reg.angle) * RG * reg.r;
      for (let i = 0; i < 70; i++) {
        addPuff(cx + gauss(rand) * RG * reg.spread, gauss(rand) * 10, cz + gauss(rand) * RG * reg.spread, 90 + rand() * 200, new THREE.Color(reg.color), 0.04 + rand() * 0.05);
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
    const c = new THREE.Color();
    accounts.forEach((a, i) => {
      const rand = rng(hashString(`${a.l}:look`));
      const p = this.worldPos[i];
      pos.set([p.x, p.y, p.z], i * 3);
      const sector = SECTORS[a.sector];
      c.set(a.sector === 'arm' ? langColor(a.lang) : sector.color).lerp(new THREE.Color('#ffffff'), 0.35);
      col.set([c.r * 1.25, c.g * 1.25, c.b * 1.25], i * 3);
      size[i] = 5 + Math.log10(1 + a.s) * 5;
      phase[i] = rand();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
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
    this.protoPos = [];
    list.forEach((p, i) => {
      const rand = rng(hashString(p.r));
      const x = Math.cos(reg.angle) * RG * reg.r + gauss(rand) * RG * reg.spread * 0.8;
      const z = Math.sin(reg.angle) * RG * reg.r + gauss(rand) * RG * reg.spread * 0.8;
      const y = gauss(rand) * 10;
      pos.set([x, y, z], i * 3);
      this.protoPos.push(new THREE.Vector3(x, y, z));
      col.set([2.4, 1.2, 1.7], i * 3);
      size[i] = 6 + Math.log10(1 + p.s) * 5;
      phase[i] = rand();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.protostars = new THREE.Points(geo, starMaterial({ uTime: this.uniforms.uTime, uScale: this.uniforms.uScale, uHover: { value: -1 } }));
    this.disk.add(this.protostars);
  }

  // git: a black hole at the centre with a hot accretion disk.
  #buildSingularity() {
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

  #newsHtml() {
    const icon = { supernova: '✷', launch: '🚀', impact: '☄' };
    const pick = [...this.news.filter((e) => e.type === 'supernova').slice(0, 3), ...this.news.filter((e) => e.type !== 'supernova').slice(0, 7)].sort((a, b) => b.t - a.t);
    return pick
      .map((e, k) => `<li data-news="${this.news.indexOf(e)}"><span class="ni">${icon[e.type]}</span><span><b>${e.title}</b><small>${e.detail} · ${new Date(e.t * 1000).toISOString().slice(0, 10)}</small></span></li>`)
      .join('');
  }

  #wireCard() {
    this.ctx.ui.cardEl.querySelectorAll('[data-login]').forEach((el) => {
      el.onclick = () => this.visit(el.dataset.login);
    });
    this.ctx.ui.cardEl.querySelectorAll('[data-news]').forEach((el) => {
      const e = this.news[Number(el.dataset.news)];
      el.onclick = () => {
        if (e.target.city) location.href = `city.html?repo=${encodeURIComponent(e.target.city)}&from=${encodeURIComponent(e.target.from)}`;
        else this.visit(e.target.planet);
      };
    });
  }

  // Fly into a star, then hand over to the planet view.
  visit(login) {
    const { camera, controls } = this.ctx;
    const idx = this.data.accounts.findIndex((a) => a.l.toLowerCase() === login.toLowerCase());
    const at = idx >= 0 ? this.worldPos[idx].clone().applyMatrix4(this.disk.matrixWorld) : controls.target.clone();
    const dir = camera.position.clone().sub(at).normalize();
    this.flying = { t: 0, dur: 1.6, fromPos: camera.position.clone(), toPos: at.clone().addScaledVector(dir, 6), fromTarget: controls.target.clone(), toTarget: at, then: () => this.ctx.go({ planet: login }) };
    controls.autoRotate = false;
  }

  #pick(event) {
    const cam = this.ctx.camera;
    const v = new THREE.Vector3();
    let best = -1;
    let bestD = 14;
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
      tip.innerHTML = `<b>@${a.l}</b> · ${SECTORS[a.sector].name}<br>${fmt(a.s)} ★ · Level ${lv.level} ${lv.name}<br><span class="desc">${a.lang} · ${a.top.join(', ')}</span><br><em>Click to visit this world</em>`;
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
    this.uniforms.uScale.value = innerHeight * 0.9;
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
      if (f.t >= 1) {
        const then = f.then;
        this.flying = null;
        then?.();
      }
    }
    const camDist = this.ctx.camera.position.distanceTo(this.ctx.controls.target);
    for (const label of this.labels) label.element.style.opacity = Math.min(1, camDist / 500);
  }
}
