import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky, radialTexture } from './sky.js';
import { GALAXIES, loadCosmos, universeLayout, sampleDust, dustColor, knotsOf, placeMembers, yearOfId, gauss } from './cosmos.js';
import { hashString, rng, langColor, levelOf } from './lore.js';
import { declutter } from './declutter.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
// from high above the cluster, so its ring of galaxies spreads across the screen
const HOME = new THREE.Vector3(5200, 19500, 15500);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const POINT_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  uniform float uTime;
  uniform float uScale;
  uniform float uGlow;
  varying vec3 vColor;
  void main() {
    vColor = aColor * (0.85 + 0.15 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 60.0)) * uGlow;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 48.0);
    gl_Position = projectionMatrix * mv;
  }`;
const POINT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * (exp(-d * 16.0) * 2.0 + exp(-d * 3.0) * 0.3), 1.0);
  }`;

// The top of the zoom: the Commitverse as a cluster of galaxies around git. Every galaxy is a kind of
// code (cosmos.js); rising projects that become megastars fly across from the Rising Galaxy to the
// Titans as comets.
export class UniverseView {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.sky = new Sky(this.scene, { brightness: 0.16 });
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 600 } };
    this.flying = null;
    this.hovered = null;
  }

  async enter(route = {}) {
    const cosmos = (this.cosmos = await loadCosmos());
    if (!this.built) this.#build(cosmos);
    const { camera, controls, ui } = this.ctx;
    camera.near = 2;
    camera.far = 90000;
    camera.updateProjectionMatrix();
    controls.enabled = true;
    controls.minDistance = 1400;
    controls.maxDistance = 42000;
    controls.zoomToCursor = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.12;
    controls.target.set(0, 0, 0);
    camera.position.copy(HOME);
    this.flying = null;
    const from = route.fromGalaxy && this.byId[route.fromGalaxy];
    if (from) {
      // we zoomed out of this galaxy: start right in front of it and pull back to the whole cluster
      const at = from.group.position.clone();
      const start = at.clone().add(new THREE.Vector3(from.R * 0.5, from.R * 0.9, from.R * 1.5));
      camera.position.copy(start);
      controls.target.copy(at);
      controls.autoRotate = false;
      this.flying = { t: 0, dur: 3.2, fromPos: start, toPos: HOME.clone(), fromTarget: at, toTarget: new THREE.Vector3(), fadeIn: 'dark' };
    }
    ui.card(this.#cardHtml());
    this.#wireCard();
    ui.hint('Every galaxy is a kind of code · drag to turn the cluster · zoom into a galaxy to enter it');
  }

  get ownsFade() {
    return !!this.flying;
  }

  #build(cosmos) {
    this.built = true;
    const layout = universeLayout();
    const counts = Object.fromEntries(GALAXIES.map((g) => [g.id, g.id === 'rising' ? cosmos.rising.length : cosmos.members[g.id].length]));
    const most = Math.max(...Object.values(counts));
    const glowTex = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.18, 'rgba(255,255,255,0.45)'],
      [0.5, 'rgba(255,255,255,0.07)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.galaxies = GALAXIES.map((spec) => {
      const count = counts[spec.id];
      const R = spec.id === 'titan' ? 1800 : 800 + 900 * Math.sqrt(count / most);
      const outer = new THREE.Group();
      outer.position.copy(layout[spec.id].pos);
      outer.rotation.copy(layout[spec.id].tilt);
      const spin = new THREE.Group();
      outer.add(spin);
      const rand = rng(hashString(`${spec.id}:cloud`));
      const knots = spec.shape === 'irregular' ? knotsOf(spec, R) : null;
      const members = spec.id === 'rising' ? cosmos.rising.map((p) => ({ l: p.r, s: p.s, lang: p.lang, born: 1970 + p.c / 31557600 })) : cosmos.members[spec.id];
      const at = placeMembers(members, spec, R, (a) => a.born ?? yearOfId(cosmos.data.ages, a.i));
      const dust = Math.round(2600 + 6400 * Math.sqrt(count / most));
      const n = dust + members.length;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const size = new Float32Array(n);
      const phase = new Float32Array(n);
      const c = new THREE.Color();
      for (let i = 0; i < dust; i++) {
        const s = sampleDust(spec, rand, R, knots);
        pos.set([s.x, s.y, s.z], i * 3);
        dustColor(spec, s.arm, s.f, rand, c).multiplyScalar(0.16 + rand() * 0.34 + (s.arm === -1 ? 0.25 : 0));
        col.set([c.r, c.g, c.b], i * 3);
        size[i] = 12 + rand() * 24;
        phase[i] = rand();
      }
      // the member worlds: brighter, a little bigger by their stars
      members.forEach((a, k) => {
        const i = dust + k;
        pos.set([at[k].x, at[k].y, at[k].z], i * 3);
        c.set(langColor(a.lang)).lerp(new THREE.Color(spec.color), 0.3).lerp(new THREE.Color('#ffffff'), 0.4).multiplyScalar(1.3);
        col.set([c.r, c.g, c.b], i * 3);
        size[i] = 30 + Math.log10(1 + a.s) * 11;
        phase[i] = rand();
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      const glow = { value: 1 };
      const points = new THREE.Points(
        geo,
        new THREE.ShaderMaterial({ uniforms: { uTime: this.uniforms.uTime, uScale: this.uniforms.uScale, uGlow: glow }, vertexShader: POINT_VERTEX, fragmentShader: POINT_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      spin.add(points);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(spec.color).lerp(new THREE.Color('#fff0d0'), 0.5).multiplyScalar(spec.id === 'archive' ? 0.5 : 1.1), blending: THREE.AdditiveBlending, depthWrite: false }));
      core.scale.setScalar(R * (spec.shape === 'elliptical' ? 1.6 : 1.0));
      spin.add(core);
      const el = document.createElement('button');
      el.className = 'galaxy-label';
      el.style.setProperty('--c', spec.color);
      el.innerHTML = `${spec.name}<small>${fmt(count)} ${spec.id === 'rising' ? 'protostars' : 'worlds'}</small>`;
      el.onclick = () => this.enterGalaxy(spec.id);
      el.onmouseenter = () => this.#hover(spec.id);
      el.onmouseleave = () => this.#hover(null);
      const label = new CSS2DObject(el);
      label.position.set(0, R * 0.55, 0);
      outer.add(label);
      this.scene.add(outer);
      return { spec, group: outer, spin, R, count, glow, label, members, speed: (0.012 + rand() * 0.02) * (rand() < 0.5 ? -1 : 1) };
    });
    this.byId = Object.fromEntries(this.galaxies.map((g) => [g.spec.id, g]));
    this.#buildGit();
    this.#buildMigrations(cosmos);
    this.#buildWeb();
    this.#buildDistant();
  }

  // The cosmic web: faint filaments of gas from every galaxy in to the Titans and across to its
  // nearest neighbour, so the cluster reads as one structure rather than islands.
  #buildWeb() {
    const rand = rng(hashString('cosmic web'));
    const pairs = [];
    const seen = new Set();
    for (const g of this.galaxies) {
      if (g.spec.id !== 'titan') pairs.push([g, this.byId.titan]);
      let near = null;
      let best = Infinity;
      for (const h of this.galaxies) {
        if (h === g || h.spec.id === 'titan') continue;
        const d = h.group.position.distanceTo(g.group.position);
        if (d < best) {
          best = d;
          near = h;
        }
      }
      const key = [g.spec.id, near?.spec.id].sort().join();
      if (near && g.spec.id !== 'titan' && !seen.has(key)) {
        seen.add(key);
        pairs.push([g, near]);
      }
    }
    const per = 700;
    const n = pairs.length * per;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    const c = new THREE.Color();
    pairs.forEach(([a, b], k) => {
      const A = a.group.position;
      const B = b.group.position;
      const mid = A.clone().lerp(B, 0.5).add(new THREE.Vector3(gauss(rand) * 700, gauss(rand) * 500, gauss(rand) * 700));
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
      const ca = new THREE.Color(a.spec.color);
      const cb = new THREE.Color(b.spec.color);
      for (let i = 0; i < per; i++) {
        const t = 0.08 + rand() * 0.84; // not inside the galaxies themselves
        const p = curve.getPoint(t);
        const width = 260 * (0.45 + Math.sin(Math.PI * t));
        const j = (k * per + i) * 3;
        pos.set([p.x + gauss(rand) * width, p.y + gauss(rand) * width * 0.6, p.z + gauss(rand) * width], j);
        c.copy(ca).lerp(cb, t).lerp(new THREE.Color('#9fb3ff'), 0.5).multiplyScalar(0.06 + rand() * 0.08);
        col.set([c.r, c.g, c.b], j);
        size[k * per + i] = 30 + rand() * 60;
        phase[k * per + i] = rand();
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const web = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ uniforms: { uTime: this.uniforms.uTime, uScale: this.uniforms.uScale, uGlow: { value: 1 } }, vertexShader: POINT_VERTEX, fragmentShader: POINT_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.scene.add(web);
  }

  // Other clusters, far beyond this one: the Commitverse is not the only thing out there.
  #buildDistant() {
    const rand = rng(hashString('distant galaxies'));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(255,240,220,0.55)');
    grad.addColorStop(0.5, 'rgba(200,210,255,0.12)');
    grad.addColorStop(1, 'rgba(200,210,255,0)');
    g.fillStyle = grad;
    g.save();
    g.translate(64, 64);
    g.scale(1, 0.38); // seen at an angle: an ellipse
    g.translate(-64, -64);
    g.fillRect(0, 0, 128, 128);
    g.restore();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tints = ['#ffe2b8', '#cfd9ff', '#ffd0e8', '#d8ffe9', '#fff4d6'];
    for (let i = 0; i < 160; i++) {
      const dir = new THREE.Vector3(gauss(rand), gauss(rand) * 0.6, gauss(rand)).normalize();
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(tints[i % tints.length]), transparent: true, opacity: 0.18 + rand() * 0.4, depthWrite: false, blending: THREE.AdditiveBlending, rotation: rand() * Math.PI }));
      sp.position.copy(dir.multiplyScalar(48000 + rand() * 30000));
      sp.scale.setScalar(700 + Math.pow(rand(), 2) * 2600);
      this.scene.add(sp);
    }
  }

  // git at the heart of the cluster: everything here is built with it
  #buildGit() {
    const group = new THREE.Group();
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(40, 180, 128, 2),
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.uniforms.uTime },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vP;
          void main() {
            float r = length(vP);
            float a = atan(vP.y, vP.x);
            float t = clamp((r - 40.0) / 140.0, 0.0, 1.0);
            float streaks = 0.6 + 0.4 * sin(a * 7.0 + r * 0.12 - uTime * 1.4);
            vec3 hot = mix(vec3(1.6, 1.35, 1.1), vec3(1.4, 0.45, 0.12), t);
            gl_FragColor = vec4(hot * streaks * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.5, 1.0, t)) * 1.6, 1.0);
          }`,
      })
    );
    disk.rotation.x = -Math.PI / 2 + 0.3;
    group.add(disk, new THREE.Mesh(new THREE.SphereGeometry(34, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    const el = document.createElement('div');
    el.className = 'nova-label git-label';
    el.textContent = 'git · the singularity';
    const label = new CSS2DObject(el);
    label.position.set(0, -420, 0);
    group.add(label);
    this.git = group;
    this.scene.add(group);
  }

  // A world that changes galaxy crosses the cluster as a comet: a protostar that grew past 100,000
  // stars flies from the Rising Galaxy to the Titans; the daily seed logs every other move.
  #buildMigrations(cosmos) {
    const tex = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.2, 'rgba(255,220,240,0.7)'],
      [1, 'rgba(255,120,190,0)'],
    ]);
    this.comets = cosmos.journeys.slice(0, 8).map((j, k) => {
      const from = this.byId[j.from]?.group.position ?? this.byId.rising.group.position;
      const to = this.byId[j.to]?.group.position ?? this.byId.titan.group.position;
      const rand = rng(hashString(`${j.label}:comet`));
      const start = from.clone().add(new THREE.Vector3(gauss(rand) * 260, gauss(rand) * 130, gauss(rand) * 260));
      const end = to.clone().add(new THREE.Vector3(gauss(rand) * 420, gauss(rand) * 200, gauss(rand) * 420));
      const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(gauss(rand) * 600, 1300 + rand() * 1100, gauss(rand) * 600));
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2.4, 1.6, 2.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      head.scale.setScalar(260);
      const n = 60;
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const tc = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const f = 1 - i / n;
        tc.set([2.2 * f, 1.3 * f * f, 1.9 * f], i * 3);
      }
      trailGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const el = document.createElement('button');
      el.className = 'comet-label';
      el.innerHTML = `✦ ${j.label}<small>${fmt(j.stars ?? 0)} ★ → ${(this.byId[j.to]?.spec.name ?? '').replace(/^The /, 'the ')}</small>`;
      el.onclick = () => this.ctx.go({ planet: j.login });
      const label = new CSS2DObject(el);
      label.center.set(-0.08, 1.2);
      head.add(label);
      this.scene.add(head, trail);
      return { curve, head, trail, label, n, phase: k / Math.max(1, Math.min(8, cosmos.journeys.length)), period: 16 + rand() * 4 };
    });
  }

  #updateMigrations(time) {
    for (const c of this.comets ?? []) {
      // each comet flies for part of its period, so only a few cross the cluster at once
      const u = ((time / c.period + c.phase) % 1) / 0.42;
      const t = ease(Math.min(1, u));
      const show = u > 1 ? 0 : Math.min(1, u * 8, (1 - u) * 6);
      c.head.visible = c.trail.visible = show > 0;
      c.head.position.copy(c.curve.getPoint(t));
      c.head.material.opacity = show;
      c.trail.material.opacity = show;
      c.label.element.style.opacity = show;
      const p = c.trail.geometry.attributes.position;
      for (let i = 0; i < c.n; i++) {
        const q = c.curve.getPoint(Math.max(0, t - i * 0.006));
        p.setXYZ(i, q.x, q.y, q.z);
      }
      p.needsUpdate = true;
    }
  }

  #cardHtml() {
    const cos = this.cosmos;
    const galaxies = this.galaxies
      .map((g) => `<li data-galaxy="${g.spec.id}"><span class="dot" style="background:${g.spec.color}"></span><span class="cname">${g.spec.name.replace(/^The /, '')}</span><span class="tier">${g.spec.id === 'rising' ? 'protostars' : 'worlds'}</span><span class="stars">${fmt(g.count)}</span></li>`)
      .join('');
    const migrations = cos.journeys
      .slice(0, 8)
      .map((j) => `<li data-login="${j.login}"><span class="dot" style="background:${this.byId[j.to]?.spec.color ?? '#ff6f9f'}"></span><span class="cname">${j.label}</span><span class="tier">→ ${(this.byId[j.to]?.spec.name ?? '').replace(/^The /, '')}</span></li>`)
      .join('');
    const joined = cos.joined
      .slice(-8)
      .reverse()
      .map((a) => `<button class="chip world" data-login="${a.l}">@${a.l}</button>`)
      .join('');
    const joinRepo = cos.data.joinRepo ?? 'krapcys1-maker/commitverse';
    const showcase = ['karpathy', 'sindresorhus', 'torvalds', 'tj', 'antirez', 'ggerganov', 'simonw', 'mitchellh'].map((l) => `<button class="chip world" data-login="${l}">@${l}</button>`).join('');
    const icon = { supernova: '✷', launch: '🚀', impact: '☄', ignition: '✦', migration: '↗', joined: '⭐' };
    const news = cos.news
      .slice(0, 9)
      .map((e, k) => `<li data-news="${k}"><span class="ni">${icon[e.type] ?? '•'}</span><span><b>${e.title}</b><small>${e.detail}${e.type === 'ignition' ? '' : ` · ${new Date(e.t * 1000).toISOString().slice(0, 10)}`}</small></span></li>`)
      .join('');
    const worlds = cos.accounts.length;
    return `
      <div class="world-name">The Commitverse</div>
      <p class="level-text">${GALAXIES.length} galaxies, ${fmt(worlds)} worlds and ${fmt(cos.rising.length)} protostars, charted from GitHub. Every star is a real account and every galaxy a kind of code. As projects grow they migrate: past ${fmt(100000)} ★ a rising project joins the Titans.</p>
      <form id="home-form" class="home-form">
        <input id="home-login" type="text" placeholder="your GitHub login" autocomplete="off" spellcheck="false" aria-label="GitHub login" />
        <button class="primary" type="submit">🚀 Fly me home</button>
      </form>
      <p class="note">The autopilot takes you from here to your world: into your galaxy, your star system, your planet. Or search <b>@anyone</b>, or <b>owner/repo</b> to land in any city.</p>
      <p><button id="surprise" class="chip world">🎲 Take me to a random world</button></p>
      <h4>Galaxies <small>zoom in or click</small></h4>
      <ul class="cities">${galaxies}</ul>
      ${migrations ? `<h4>Migrations <small>worlds on the move</small></h4><ul class="cities">${migrations}</ul>` : ''}
      <h4>Join the Commitverse</h4>
      <p class="note">⭐ <a href="https://github.com/${joinRepo}" target="_blank" rel="noopener">Star the repository</a> and your world appears in its galaxy at the next daily update.${joined ? '' : ' Be the first.'}</p>
      ${joined ? `<div class="chips">${joined}</div>` : ''}
      <h4>Visit a showcase world</h4>
      <div class="chips">${showcase}</div>
      <h4>Galactic news</h4>
      <ul class="news">${news}</ul>`;
  }

  #wireCard() {
    const card = this.ctx.ui.cardEl;
    card.querySelectorAll('[data-galaxy]').forEach((el) => {
      el.onclick = () => this.enterGalaxy(el.dataset.galaxy);
      el.onmouseenter = () => this.#hover(el.dataset.galaxy);
      el.onmouseleave = () => this.#hover(null);
    });
    card.querySelectorAll('[data-login]').forEach((el) => (el.onclick = () => this.ctx.go({ planet: el.dataset.login })));
    card.querySelector('#home-form').onsubmit = (e) => {
      e.preventDefault();
      const login = card.querySelector('#home-login').value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').split('/')[0];
      if (login) this.ctx.flyHome(login);
    };
    // anywhere in the charted universe, a little more often somewhere bright
    card.querySelector('#surprise').onclick = () => {
      const all = this.cosmos.accounts;
      const a = all[Math.floor(Math.pow(Math.random(), 1.6) * all.length)];
      this.ctx.go({ planet: a.l });
    };
    card.querySelectorAll('[data-news]').forEach((el) => {
      const e = this.cosmos.news[Number(el.dataset.news)];
      el.onclick = () => {
        if (e.target?.city) location.href = `city.html?repo=${encodeURIComponent(e.target.city)}&from=${encodeURIComponent(e.target.from)}`;
        else if (e.target?.planet) this.ctx.go({ planet: e.target.planet });
      };
    });
  }

  #hover(id) {
    this.hovered = id;
    for (const g of this.galaxies) {
      g.glow.value = id && g.spec.id === id ? 1.7 : 1;
      g.label.element.classList.toggle('on', g.spec.id === id);
    }
  }

  // the galaxy under the pointer: within its outline on screen
  #galaxyAt(event) {
    const cam = this.ctx.camera;
    let best = null;
    let bestD = Infinity;
    for (const g of this.galaxies) {
      const p = g.group.position.clone().project(cam);
      if (p.z > 1) continue;
      const sx = (p.x * 0.5 + 0.5) * innerWidth;
      const sy = (-p.y * 0.5 + 0.5) * innerHeight;
      const dist = cam.position.distanceTo(g.group.position);
      const radius = Math.max(40, (g.R / dist) * (innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360));
      const d = Math.hypot(sx - event.clientX, sy - event.clientY) / radius;
      if (d < 1.1 && d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return best;
  }

  zoomTarget(dir, event) {
    if (this.flying || dir === 'out') return null;
    const g = this.#galaxyAt(event);
    return g ? { label: `Into ${g.spec.name}`, go: () => this.enterGalaxy(g.spec.id) } : null;
  }

  enterGalaxy(id) {
    const g = this.byId[id];
    if (!g || this.flying) return;
    const { camera, controls } = this.ctx;
    const at = g.group.position.clone();
    const dir = camera.position.clone().sub(at).normalize();
    this.flying = { t: 0, dur: 1.9, fromPos: camera.position.clone(), toPos: at.clone().addScaledVector(dir, g.R * 1.1), fromTarget: controls.target.clone(), toTarget: at, then: () => this.ctx.go({ galaxy: id, fromUniverse: true }) };
    controls.autoRotate = false;
  }

  pointerMove(event) {
    if (this.flying) return;
    const g = this.#galaxyAt(event);
    if ((g?.spec.id ?? null) !== this.hovered) this.#hover(g?.spec.id ?? null);
    const tip = this.ctx.ui.tooltipEl;
    if (!g) {
      tip.hidden = true;
      return;
    }
    const top = g.members.slice(0, 3).map((a) => (g.spec.id === 'rising' ? a.l : `@${a.l}`)).join(', ');
    tip.innerHTML = `<b>${g.spec.name}</b><br>${fmt(g.count)} ${g.spec.id === 'rising' ? 'protostars' : 'worlds'}<br><span class="desc">${top}</span><br><em>Click or zoom in to enter</em>`;
    tip.style.left = `${Math.min(event.clientX + 16, innerWidth - 320)}px`;
    tip.style.top = `${event.clientY + 16}px`;
    tip.hidden = false;
  }

  click(ray, event) {
    const g = this.#galaxyAt(event);
    if (g) {
      this.ctx.ui.tooltipEl.hidden = true;
      this.enterGalaxy(g.spec.id);
    }
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    // points keep their size in the picture whatever the field of view (a vertical film widens it)
    this.uniforms.uScale.value = (innerHeight * 0.9 * 0.41421356) / Math.tan((this.ctx.camera.fov * Math.PI) / 360);
    for (const g of this.galaxies ?? []) g.spin.rotation.y += dt * g.speed;
    if (this.git) this.git.rotation.y += dt * 0.2;
    this.#updateMigrations(time);
    this.sky.update(this.ctx.camera, new THREE.Vector3(0, 1, 0));
    const f = this.flying;
    if (f) {
      const { camera, controls, ui } = this.ctx;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = ease(f.t);
      camera.position.lerpVectors(f.fromPos, f.toPos, e);
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      camera.lookAt(controls.target);
      if (f.then) ui.fade(Math.max(0, (f.t - 0.68) / 0.32), 'dark');
      else if (f.fadeIn) ui.fade(Math.max(0, 1 - (f.t * f.dur) / 0.4), 'dark');
      if (f.t >= 1) {
        this.flying = null;
        if (f.then) f.then();
        else controls.autoRotate = true;
      }
    }
    const d = this.ctx.camera.position.length();
    for (const g of this.galaxies ?? []) g.label.element.style.opacity = Math.min(1, d / 9000);
    // the biggest galaxies keep their names when two line up; comets give way to both
    this.labelOrder ??= [...this.galaxies].sort((a, b) => (b.spec.id === 'titan') - (a.spec.id === 'titan') || b.count - a.count).map((g) => ({ label: g.label, wanted: true }));
    declutter([...this.labelOrder, ...(this.comets ?? []).map((c) => ({ label: c.label, wanted: c.head.visible }))], this.ctx.camera, 4);
  }
}
