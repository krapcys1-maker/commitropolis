import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky, radialTexture } from './sky.js';
import { NOISE } from './glsl.js';
import { SECTORS, levelOf, langColor, hashString, cityTier, WORLD_STYLES } from './lore.js';
import { worldMaterial } from './systemView.js';
import { loadCityIndex } from './planetView.js';
import { apiBase, mapCity } from '../config.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const MAX_STRUCTURES = 12;

// An organisation is a star. Its repositories are megastructures in orbit (ring arcs, the flagship
// a full Dyson ring); its public members are worlds further out (docs/LORE.md).
export async function loadOrg(login) {
  const local = await fetch(`universe/orgs/${login.toLowerCase()}.json`);
  if (local.ok && (local.headers.get('content-type') ?? '').includes('json')) return local.json();
  const u = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`);
  if (!u.ok) throw new Error(u.status === 404 ? `No star called @${login}` : 'GitHub rate limit reached, try again in a minute');
  const org = await u.json();
  const r = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&type=owner&sort=pushed`);
  const repos = r.ok ? await r.json() : [];
  return {
    login: org.login,
    id: org.id,
    type: org.type,
    name: org.name,
    bio: org.bio,
    avatar: org.avatar_url,
    followers: org.followers,
    created: Math.round(Date.parse(org.created_at) / 1000),
    repos: repos
      .filter((x) => !x.fork)
      .map((x) => ({ n: x.name, s: x.stargazers_count, lang: x.language, p: Math.round(Date.parse(x.pushed_at) / 1000), a: x.archived ? 1 : 0, d: (x.description ?? '').slice(0, 140) }))
      .sort((a, b) => b.s - a.s),
    members: [],
    live: true,
  };
}

function starMaterial(color, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uColor: { value: color } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vDir = normalize(position);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vDir;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        float g = fbm(vDir * 5.0 + vec3(0.0, uTime * 0.04, 0.0), 5);
        float cells = 0.5 + 0.5 * snoise(vDir * 22.0 + uTime * 0.1);
        float mu = max(dot(vNormal, normalize(cameraPosition - vWorld)), 0.0);
        float limb = 0.45 + 0.55 * pow(mu, 0.5);
        vec3 hot = mix(uColor, vec3(1.0, 0.97, 0.9), 0.55);
        vec3 col = mix(uColor * 1.6, hot * 2.6, smoothstep(-0.3, 0.5, g)) * (0.85 + cells * 0.3);
        gl_FragColor = vec4(col * limb * 1.4, 1.0);
      }`,
  });
}

function structureMaterial(color, uniforms, flagship) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: uniforms.uTime, uColor: { value: color }, uHover: { value: 0 }, uFlagship: { value: flagship ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vLocal;
      void main() {
        vUv = uv;
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uHover;
      uniform float uFlagship;
      varying vec2 vUv;
      varying vec3 vLocal;
      void main() {
        float r = length(vLocal.xy);
        float ang = atan(vLocal.y, vLocal.x);
        float seg = fract(ang * 90.0 / 6.2831853);
        float rib = step(0.9, seg);
        float edge = step(abs(fract(r * 0.25) - 0.5), 0.06);
        float windows = step(0.35, fract(ang * 720.0 / 6.2831853)) * step(fract(r * 1.3), 0.5);
        float lit = step(0.74, fract(sin(floor(ang * 720.0 / 6.2831853) * 12.9898 + floor(r * 1.3) * 78.233) * 43758.5453));
        vec3 hull = vec3(0.035, 0.038, 0.048) + rib * 0.05;
        vec3 col = hull + uColor * edge * (0.9 + uHover * 1.6) + vec3(1.0, 0.78, 0.5) * windows * lit * (0.75 + uFlagship * 0.5);
        col += uColor * uHover * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export class OrgView {
  constructor(ctx, galaxy) {
    this.ctx = ctx;
    this.galaxy = galaxy;
    this.scene = new THREE.Scene();
    this.sky = new Sky(this.scene, { brightness: 0.4 });
    this.uniforms = { uTime: { value: 0 } };
    this.group = null;
    this.flying = null;
    this.hovered = -1;
  }

  async enter(login) {
    const { camera, controls, ui } = this.ctx;
    const [data, index] = await Promise.all([loadOrg(login), loadCityIndex(), this.galaxy.load()]);
    this.data = data;
    const account = this.galaxy.account(data.login);
    this.sectorKey = account?.sector ?? 'titan';
    const sector = SECTORS[this.sectorKey];
    this.stars = Math.max(data.repos.reduce((s, r) => s + r.s, 0), account?.s ?? 0);
    this.level = levelOf(this.stars);

    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose?.();
        o.element?.remove();
      });
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // the star
    const color = new THREE.Color(sector.color);
    const starRadius = 30 + Math.log10(1 + this.stars) * 5;
    const star = new THREE.Mesh(new THREE.SphereGeometry(starRadius, 96, 48), starMaterial(color, this.uniforms));
    const corona = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture([
          [0, 'rgba(255,255,255,0.9)'],
          [0.25, 'rgba(255,255,255,0.35)'],
          [0.55, 'rgba(255,255,255,0.06)'],
          [1, 'rgba(255,255,255,0)'],
        ]),
        color: color.clone().multiplyScalar(1.3),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    corona.scale.setScalar(starRadius * 5.2);
    this.group.add(corona, star);
    this.star = star;

    // megastructures
    const repos = data.repos.filter((r) => !r.a).slice(0, MAX_STRUCTURES);
    const maxStars = Math.max(1, ...repos.map((r) => r.s));
    this.structures = repos.map((repo, i) => {
      const rand = hashString(`${data.login}/${repo.n}`);
      const radius = starRadius + 70 + i * 24;
      const flagship = i === 0;
      const share = Math.log10(1 + repo.s) / Math.log10(1 + maxStars);
      const span = flagship ? Math.PI * 2 : 0.5 + share * 2.6;
      const width = 2.2 + share * 5;
      const geo = new THREE.RingGeometry(radius - width, radius + width, flagship ? 512 : 256, 2, rand * Math.PI * 2, span);
      const mesh = new THREE.Mesh(geo, structureMaterial(new THREE.Color(langColor(repo.lang)).lerp(color, 0.35), this.uniforms, flagship));
      const holder = new THREE.Group();
      holder.rotation.set(-Math.PI / 2 + (rand - 0.5) * 0.7, 0, (hashString(`${repo.n}:tilt`) - 0.5) * 0.5);
      holder.add(mesh);
      this.group.add(holder);
      const mid = rand * Math.PI * 2 + span / 2;
      const anchor = new THREE.Object3D();
      anchor.position.set(Math.cos(mid) * radius, Math.sin(mid) * radius, 0);
      mesh.add(anchor);
      const slug = `${data.login}-${repo.n}`.toLowerCase();
      const el = document.createElement('button');
      el.className = `world-label structure ${index.has(slug) ? 'mapped' : ''}`;
      el.innerHTML = `${repo.n}<small>${flagship ? 'Dyson ring · ' : ''}${fmt(repo.s)} ★</small>`;
      el.onclick = () => this.land(i);
      const label = new CSS2DObject(el);
      anchor.add(label);
      return { repo, mesh, holder, anchor, radius, slug: index.has(slug) ? slug : null, wantSlug: slug, spin: (0.02 + rand * 0.03) * (rand > 0.5 ? 1 : -1) };
    });

    // inhabitants: public members on outer orbits
    const outer = starRadius + 70 + repos.length * 24 + 90;
    const styleKeys = Object.keys(WORLD_STYLES);
    this.members = (data.members ?? []).slice(0, 10).map((m, i) => {
      const lang = styleKeys[Math.floor(hashString(m.l) * styleKeys.length)];
      const pseudo = { l: m.l, s: 1000, lang };
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 16), worldMaterial(pseudo, new THREE.Vector3()));
      const el = document.createElement('button');
      el.className = 'world-label';
      el.innerHTML = `@${m.l}<small>inhabitant</small>`;
      el.onclick = () => this.visitWorld(m.l);
      const label = new CSS2DObject(el);
      label.position.set(0, 16, 0);
      mesh.add(label);
      this.group.add(mesh);
      return { login: m.l, mesh, radius: outer + i * 34, phase: hashString(`${m.l}:o`) * Math.PI * 2, speed: 0.03 / Math.sqrt(1 + i * 0.3) };
    });

    camera.near = 0.5;
    camera.far = 30000;
    camera.updateProjectionMatrix();
    controls.enabled = true;
    controls.minDistance = starRadius * 1.6;
    controls.maxDistance = 3000;
    controls.target.set(0, 0, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.15;
    camera.position.set(0, outer * 0.75, outer * 1.55);
    this.flying = null;

    ui.card(this.#cardHtml(sector));
    ui.cardEl.querySelectorAll('[data-i]').forEach((el) => {
      const i = Number(el.dataset.i);
      el.onclick = () => this.land(i);
      el.onmouseenter = () => this.#hover(i);
      el.onmouseleave = () => this.#hover(-1);
    });
    ui.cardEl.querySelectorAll('[data-login]').forEach((el) => (el.onclick = () => this.visitWorld(el.dataset.login)));
    ui.hint('A star and its megastructures · click a structure to land in its city · click an inhabitant to visit their world');
    return { sector, catalog: data.login };
  }

  #cardHtml(sector) {
    const d = this.data;
    const lv = this.level;
    const rows = this.structures
      .map((s, i) => `<li data-i="${i}" class="${s.slug ? 'mapped' : ''}"><span class="dot" style="background:${langColor(s.repo.lang)}"></span><span class="cname">${s.repo.n}</span><span class="tier">${i === 0 ? 'Dyson ring' : cityTier(s.repo.s)}</span><span class="stars">${fmt(s.repo.s)} ★</span></li>`)
      .join('');
    const people = this.members.map((m) => `<button class="chip world" data-login="${m.login}">@${m.login}</button>`).join('');
    return `
      <div class="world-head">
        <img src="${d.avatar}" alt="" width="52" height="52" />
        <div>
          <div class="world-name">${d.name ?? d.login}</div>
          <div class="world-login">@${d.login} · a star in <span style="color:${sector.color}">${sector.name}</span></div>
        </div>
      </div>
      <div class="level">
        <div class="level-row"><span class="level-badge">Level ${lv.level}</span><span class="level-name">${lv.name}</span></div>
        <div class="level-bar"><i style="width:${Math.round(lv.progress * 100)}%"></i></div>
        <div class="level-next">${lv.next ? `${fmt(lv.next.min - this.stars)} ★ to <b>${lv.next.name}</b>` : 'The highest level a star can reach'}</div>
      </div>
      <div class="stats">
        <div><b>${fmt(this.stars)}</b><span>stars</span></div>
        <div><b>${fmt(d.repos.length)}</b><span>structures</span></div>
        <div><b>${fmt((d.members ?? []).length)}</b><span>inhabitants</span></div>
      </div>
      ${d.bio ? `<p class="bio">${d.bio}</p>` : ''}
      <h4>Megastructures <small>click to land</small></h4>
      <ul class="cities">${rows}</ul>
      ${people ? `<h4>Inhabitants</h4><div class="chips">${people}</div>` : ''}`;
  }

  #hover(i) {
    this.structures.forEach((s, k) => (s.mesh.material.uniforms.uHover.value = k === i ? 1 : 0));
  }

  pointerMove(event, ray) {
    if (this.flying) return;
    const hits = new THREE.Raycaster(ray.origin, ray.direction).intersectObjects(this.structures.map((s) => s.mesh), false);
    const i = hits.length ? this.structures.findIndex((s) => s.mesh === hits[0].object) : -1;
    this.#hover(i);
    const tip = this.ctx.ui.tooltipEl;
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    const s = this.structures[i];
    tip.innerHTML = `<b>${s.repo.n}</b> · ${i === 0 ? 'Dyson ring' : 'megastructure'}<br>${fmt(s.repo.s)} ★ · ${s.repo.lang ?? 'n/a'}${s.repo.d ? `<br><span class="desc">${s.repo.d}</span>` : ''}<br><em>${s.slug ? 'Click to land' : 'Uncharted: click to survey it'}</em>`;
    tip.style.left = `${Math.min(event.clientX + 16, innerWidth - 320)}px`;
    tip.style.top = `${event.clientY + 16}px`;
    tip.hidden = false;
  }

  click(ray) {
    if (this.flying) return;
    const hits = new THREE.Raycaster(ray.origin, ray.direction).intersectObjects(this.structures.map((s) => s.mesh), false);
    if (hits.length) this.land(this.structures.findIndex((s) => s.mesh === hits[0].object));
  }

  async land(i) {
    const s = this.structures[i];
    const { ui } = this.ctx;
    ui.tooltipEl.hidden = true;
    if (!s.slug) {
      if (!(await apiBase())) {
        ui.toast(`<b>${s.repo.n}</b> is uncharted: its history hasn't been mapped yet. <a href="https://github.com/${this.data.login}/${s.repo.n}" target="_blank" rel="noopener">View on GitHub ↗</a>`);
        return;
      }
      const repo = `${this.data.login}/${s.repo.n}`;
      ui.survey(repo, 'queued');
      try {
        s.slug = await mapCity(repo, (job) => ui.survey(repo, job.step, job.position));
        ui.survey(null);
      } catch (err) {
        ui.survey(null);
        ui.toast(`Couldn't map <b>${s.repo.n}</b>: ${err.message}`);
        return;
      }
    }
    const { camera, controls } = this.ctx;
    const at = s.anchor.getWorldPosition(new THREE.Vector3());
    const dir = camera.position.clone().sub(at).normalize();
    controls.autoRotate = false;
    this.flying = {
      t: 0,
      dur: 2.0,
      fromPos: camera.position.clone(),
      toPos: at.clone().addScaledVector(dir, 6),
      fromTarget: controls.target.clone(),
      toTarget: at,
      then: () => (location.href = `city.html?repo=${encodeURIComponent(s.slug)}&from=${encodeURIComponent(this.data.login)}&arrive=1`),
    };
  }

  visitWorld(login) {
    const m = this.members.find((x) => x.login === login);
    const { camera, controls } = this.ctx;
    const at = m ? m.mesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const dir = camera.position.clone().sub(at).normalize();
    controls.autoRotate = false;
    this.flying = { t: 0, dur: 1.6, fromPos: camera.position.clone(), toPos: at.clone().addScaledVector(dir, 18), fromTarget: controls.target.clone(), toTarget: at, then: () => this.ctx.go({ planet: login }) };
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    for (const s of this.structures ?? []) s.mesh.rotation.z += dt * s.spin;
    for (const m of this.members ?? []) {
      const a = m.phase + time * m.speed;
      m.mesh.position.set(Math.cos(a) * m.radius, Math.sin(a * 0.7) * 12, Math.sin(a) * m.radius);
      m.mesh.rotation.y += dt * 0.3;
    }
    this.sky.update(this.ctx.camera, new THREE.Vector3(0, 1, 0));
    const f = this.flying;
    if (f) {
      const { camera, controls, ui } = this.ctx;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
      camera.position.lerpVectors(f.fromPos, f.toPos, e);
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      camera.lookAt(controls.target);
      ui.fade(Math.max(0, (f.t - 0.72) / 0.28));
      if (f.t >= 1 && !f.done) {
        f.done = true;
        this.flying = null;
        f.then?.();
      }
    }
  }
}
