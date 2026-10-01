import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Planet, R } from './planet.js';
import { Sky } from './sky.js';
import { langColor, cityTier } from './lore.js';
import { catalogOf } from './systemView.js';
import { shareHtml, wireShare, REPO } from './share.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Showcase worlds are baked by tools/universe/seed.mjs; anyone else is fetched live from GitHub.
export async function loadPlanet(login) {
  const local = await fetch(`universe/planets/${login.toLowerCase()}.json`);
  // dev servers answer unknown files with index.html (200), so check it really is JSON
  if (local.ok && (local.headers.get('content-type') ?? '').includes('json')) return local.json();
  const user = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`);
  if (!user.ok) throw new Error(user.status === 404 ? `No world called @${login}` : 'GitHub rate limit reached, try again in a minute');
  const u = await user.json();
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&type=owner&sort=pushed`);
  const repos = res.ok ? await res.json() : [];
  return {
    login: u.login,
    id: u.id,
    type: u.type,
    name: u.name,
    bio: u.bio,
    avatar: u.avatar_url,
    followers: u.followers,
    created: Math.round(Date.parse(u.created_at) / 1000),
    repos: repos
      .filter((r) => !r.fork)
      .map((r) => ({ n: r.name, s: r.stargazers_count, f: r.forks_count, lang: r.language, kb: r.size, c: Math.round(Date.parse(r.created_at) / 1000), p: Math.round(Date.parse(r.pushed_at) / 1000), a: r.archived ? 1 : 0, d: (r.description ?? '').slice(0, 140), topics: (r.topics ?? []).slice(0, 6) }))
      .sort((a, b) => b.s - a.s),
    live: true,
  };
}

let newsPromise = null;
export function loadNews() {
  newsPromise ??= fetch('universe/events.json')
    .then((r) => ((r.headers.get('content-type') ?? '').includes('json') ? r.json() : { events: [] }))
    .then((j) => j.events)
    .catch(() => []);
  return newsPromise;
}

let cityIndexPromise = null;
export function loadCityIndex() {
  cityIndexPromise ??= fetch('data/index.json')
    .then((r) => r.json())
    .then((list) => new Set(list.map((e) => e.slug)))
    .catch(() => new Set());
  return cityIndexPromise;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const span = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));

// From a to b around the planet (never through it): slerp the direction, lerp the altitude.
function arc(a, b, k) {
  const turn = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
  return a.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(turn, k)).multiplyScalar(THREE.MathUtils.lerp(a.length(), b.length(), k));
}

export class PlanetView {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.sky = new Sky(this.scene);
    this.hovered = -1;
    this.landing = null;
  }

  // ascend: the repository we're rising from (we came up out of its city, through the clouds)
  async enter(login, { ascend } = {}) {
    const { camera, controls, ui } = this.ctx;
    const [data, index] = await Promise.all([loadPlanet(login), loadCityIndex()]);
    if (data.type === 'Organization') return { redirect: 'org', login: data.login }; // organisations are stars
    this.clear();
    this.data = data;
    this.planet = new Planet(this.ctx.renderer, data, index);
    this.scene.add(this.planet.frame);
    this.#buildLabels();
    // real releases of this world's cities become its rocket launches
    const news = await loadNews();
    const mine = news.filter((e) => e.type === 'launch' && e.repo.split('/')[0].toLowerCase() === data.login.toLowerCase());
    this.planet.setLaunches(mine.map((e) => ({ city: this.planet.cities.findIndex((c) => c.repo.n === e.repo.split('/')[1]), name: e.repo.split('/')[1], tag: e.tag })));

    camera.near = 0.5;
    camera.far = 20000;
    camera.updateProjectionMatrix();
    // start where the terminator crosses the disk: day on one side, city lights on the other
    const sun = this.planet.uniforms.uSunDir.value;
    const side = new THREE.Vector3().crossVectors(sun, new THREE.Vector3(0, 1, 0)).normalize();
    camera.position.copy(side.multiplyScalar(-1).addScaledVector(sun, -0.35).add(new THREE.Vector3(0, 0.25, 0)).normalize().multiplyScalar(R * 3.0));
    controls.target.set(0, 0, 0);
    controls.minDistance = R * 1.25;
    controls.maxDistance = R * 9;
    controls.zoomToCursor = false;
    controls.enabled = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;

    ui.card(this.#cardHtml());
    ui.hint('Drag to orbit · zoom into a glowing city to land · keep zooming out to leave orbit');
    this.#wireCard();
    const from = ascend ? this.planet.cities.findIndex((c) => c.repo.n.toLowerCase() === ascend.toLowerCase()) : -1;
    if (from >= 0) this.#ascend(from);
    return this.planet;
  }

  // While landing or rising through the clouds, this view draws the white-out itself.
  get ownsFade() {
    return !!(this.landing || this.ascending);
  }

  // The scale gesture (src/scale.js): out to this world's star system, in to the city under the cursor.
  zoomTarget(dir, event, ray) {
    if (!this.planet || this.landing || this.ascending) return null;
    if (dir === 'out') return { label: `Leave orbit: System ${catalogOf(this.data.login)}`, go: () => this.zoomOut() };
    let i = this.planet.cityAt(ray);
    if (i < 0) i = this.#cityAhead();
    return i < 0 ? null : { label: `Land in ${this.planet.cities[i].repo.n}`, go: () => this.land(i) };
  }

  zoomOut() {
    this.ctx.leave(() => this.ctx.go({ system: this.data.login, fromWorld: true }));
  }

  // The city nearest the middle of the view, if one is close enough to aim at.
  #cityAhead() {
    const view = this.ctx.camera.position.clone().normalize();
    const q = this.planet.group.getWorldQuaternion(new THREE.Quaternion());
    let best = -1;
    let bestAngle = 0.4;
    this.planet.cities.forEach((c, i) => {
      const angle = c.dir.clone().applyQuaternion(q).angleTo(view);
      if (angle < bestAngle) {
        best = i;
        bestAngle = angle;
      }
    });
    return best;
  }

  // The landing, backwards: from just above a city, up out of the clouds and back to orbit.
  #ascend(i) {
    const city = this.planet.cities[i];
    this.planet.group.updateMatrixWorld(true);
    const normal = city.dir.clone().applyQuaternion(this.planet.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const tangent = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    const sun = this.planet.uniforms.uSunDir.value;
    this.ascending = { t: 0, normal, tangent, sunHome: sun.clone(), sunDusk: normal.clone().multiplyScalar(-0.12).add(tangent).normalize() };
    sun.copy(this.ascending.sunDusk);
    this.planet.spin = false;
    this.ctx.controls.enabled = false;
    this.ctx.controls.autoRotate = false;
    this.#updateAscend(0);
  }

  #updateAscend(dt) {
    const A = this.ascending;
    const { camera, controls, ui } = this.ctx;
    A.t += dt;
    const cityPoint = A.normal.clone().multiplyScalar(R);
    const low = A.normal.clone().multiplyScalar(R * 1.006).addScaledVector(A.tangent, R * 0.02);
    const above = A.normal.clone().multiplyScalar(R * 2.1).addScaledVector(A.tangent, R * 0.35);
    const rise = 1 - (1 - span(A.t, 0, 2.4)) ** 2;
    const out = ease(span(A.t, 2.0, 4.4));
    camera.position.lerpVectors(low, above, rise).lerp(above.clone().setLength(R * 3.0), out);
    const look = cityPoint.clone().addScaledVector(A.tangent, -R * 0.4 * (1 - rise)).lerp(new THREE.Vector3(), out);
    controls.target.copy(look);
    camera.lookAt(look);
    this.planet.uniforms.uSunDir.value.lerpVectors(A.sunDusk, A.sunHome, ease(span(A.t, 1.6, 4.4))).normalize();
    ui.fade(1 - span(A.t, 0.15, 1.4));
    if (A.t >= 4.4) {
      this.ascending = null;
      this.planet.spin = true;
      controls.enabled = true;
      controls.autoRotate = true;
    }
  }

  clear() {
    if (!this.planet) return;
    this.scene.remove(this.planet.frame);
    this.planet.frame.traverse((o) => o.element?.remove());
    this.planet.dispose();
    this.planet = null;
    this.landing = null;
    this.ascending = null;
  }

  #buildLabels() {
    this.labels = [];
    this.planet.cities.slice(0, 12).forEach((city, i) => {
      const el = document.createElement('div');
      el.className = `city-label ${city.slug ? 'mapped' : ''}`;
      el.innerHTML = `${city.repo.n}<small>${fmt(city.repo.s)} ★</small>`;
      el.onclick = () => this.land(i);
      const label = new CSS2DObject(el);
      label.position.copy(city.dir).multiplyScalar(R * 1.03);
      label.center.set(0.5, 1.4);
      this.planet.group.add(label);
      this.labels.push({ label, city });
    });
  }

  #cardHtml() {
    const p = this.planet;
    const d = this.data;
    const lv = p.level;
    const toNext = lv.next ? `${fmt(lv.next.min - p.stars)} ★ to <b>${lv.next.name}</b>` : 'The highest level a world can reach';
    const langs = p.languages
      .slice(0, 5)
      .map(([l]) => `<span class="chip"><i style="background:${langColor(l)}"></i>${l}</span>`)
      .join('');
    const cities = p.cities
      .slice(0, 14)
      .map(
        (c, i) => `<li data-i="${i}" class="${c.slug ? 'mapped' : ''}">
          <span class="dot" style="background:${langColor(c.repo.lang)}"></span>
          <span class="cname">${c.repo.n}</span>
          <span class="tier">${c.tier}</span>
          <span class="stars">${fmt(c.repo.s)} ★</span>
        </li>`
      )
      .join('');
    return `
      <div class="world-head">
        <img src="${d.avatar}" alt="" width="52" height="52" />
        <div>
          <div class="world-name">${d.name ?? d.login}</div>
          <div class="world-login">@${d.login} · world formed ${new Date(d.created * 1000).getUTCFullYear()}</div>
        </div>
      </div>
      <div class="level">
        <div class="level-row"><span class="level-badge">Level ${lv.level}</span><span class="level-name">${lv.name}</span></div>
        <div class="level-bar"><i style="width:${Math.round(lv.progress * 100)}%"></i></div>
        <div class="level-next">${toNext}</div>
        <p class="level-text">${lv.text}</p>
      </div>
      <div class="stats">
        <div><b>${fmt(p.stars)}</b><span>stars</span></div>
        <div><b>${fmt(d.repos.length)}</b><span>cities</span></div>
        <div><b>${fmt(d.followers ?? 0)}</b><span>followers</span></div>
      </div>
      <div class="chips">${langs}</div>
      ${d.bio ? `<p class="bio">${d.bio}</p>` : ''}
      <h4>Cities <small>click to land</small></h4>
      <ul class="cities">${cities}</ul>
      ${d.live ? `<div class="join"><b>This world isn't charted yet.</b> It was fetched live from GitHub just now. <a href="https://github.com/${REPO}" target="_blank" rel="noopener">⭐ Star the Commitverse</a> and it joins its galaxy at the next daily update.</div>` : ''}
      <h4>Share this world</h4>
      ${shareHtml(d)}
      <p><button id="leave-orbit" class="chip world">↥ Leave orbit: see this star system</button></p>`;
  }

  #wireCard() {
    this.ctx.ui.cardEl.querySelector('#leave-orbit').onclick = () => this.zoomOut();
    wireShare(this.ctx.ui.cardEl, this.data, (html) => this.ctx.ui.toast(html));
    this.ctx.ui.cardEl.querySelectorAll('.cities li').forEach((li) => {
      const i = Number(li.dataset.i);
      li.onmouseenter = () => this.#hover(i);
      li.onmouseleave = () => this.#hover(-1);
      li.onclick = () => this.land(i);
    });
  }

  #hover(i) {
    this.hovered = i;
    this.planet.uniforms.uHighlight.value = i;
  }

  pointerMove(event, ray) {
    if (!this.planet || this.landing || this.ascending) return;
    const i = this.planet.cityAt(ray);
    this.#hover(i);
    const tip = this.ctx.ui.tooltipEl;
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    const c = this.planet.cities[i];
    tip.innerHTML = `<b>${c.repo.n}</b> · ${c.tier}<br>${fmt(c.repo.s)} ★ · ${c.repo.lang ?? 'n/a'}${c.repo.d ? `<br><span class="desc">${c.repo.d}</span>` : ''}<br><em>${c.slug ? 'Click to land · its whole history' : 'Click to land · history not surveyed yet'}</em>`;
    tip.style.left = `${Math.min(event.clientX + 16, innerWidth - 320)}px`;
    tip.style.top = `${event.clientY + 16}px`;
    tip.hidden = false;
  }

  click(ray) {
    if (!this.planet || this.landing || this.ascending) return;
    const i = this.planet.cityAt(ray);
    if (i >= 0) this.land(i);
  }

  // Swing the sun to dusk over the city, align above it, then descend through the clouds.
  land(i) {
    const city = this.planet.cities[i];
    const { ui, camera, controls } = this.ctx;
    controls.enabled = false;
    controls.autoRotate = false;
    this.ctx.ui.tooltipEl.hidden = true;
    this.planet.spin = false;
    const normal = city.dir.clone().applyQuaternion(this.planet.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const tangent = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    this.landing = {
      city,
      t: 0,
      from: camera.position.clone(),
      fromTarget: controls.target.clone(),
      normal,
      tangent,
      sunFrom: this.planet.uniforms.uSunDir.value.clone(),
      sunTo: normal.clone().multiplyScalar(-0.12).add(tangent).normalize(),
    };
    ui.hint(`Descending to ${city.repo.n}…`);
  }

  #updateLanding(dt) {
    const L = this.landing;
    const { camera, controls, ui } = this.ctx;
    L.t += dt;
    const align = Math.min(1, L.t / 2.2);
    const descend = Math.min(1, Math.max(0, (L.t - 2.0) / 2.6));
    this.planet.uniforms.uSunDir.value.lerpVectors(L.sunFrom, L.sunTo, ease(align)).normalize();

    const above = L.normal.clone().multiplyScalar(R * 2.1).addScaledVector(L.tangent, R * 0.35);
    const pos = arc(L.from, above, ease(align));
    const cityPoint = L.normal.clone().multiplyScalar(R);
    if (descend > 0) {
      const e = descend * descend;
      const low = L.normal.clone().multiplyScalar(R * 1.006).addScaledVector(L.tangent, R * 0.02);
      pos.lerp(low, e);
    }
    camera.position.copy(pos);
    const look = new THREE.Vector3().lerpVectors(L.fromTarget, cityPoint, ease(align));
    if (descend > 0) look.lerp(cityPoint.clone().addScaledVector(L.tangent, -R * 0.4), descend);
    controls.target.copy(look);
    camera.lookAt(look);
    ui.fade(Math.max(0, (descend - 0.72) / 0.28));
    if (L.t > 4.7 && !L.done && !this.noNavigate) {
      L.done = true;
      // a surveyed city has its whole history; any other is raised live from GitHub (src/liveCity.js)
      const repo = L.city.slug ?? `${this.data.login}/${L.city.repo.n}`;
      location.href = `city.html?repo=${encodeURIComponent(repo)}&from=${encodeURIComponent(this.data.login)}&arrive=1`;
    }
  }

  update(dt, time) {
    if (!this.planet) return;
    this.planet.update(this.planet.spin === false ? 0 : dt, time);
    if (this.landing) this.#updateLanding(dt);
    if (this.ascending) this.#updateAscend(dt);
    this.sky.update(this.ctx.camera, this.planet.uniforms.uSunDir.value);

    // labels: only the side facing the camera, fading at the limb
    const camDir = this.ctx.camera.position.clone().normalize();
    for (const { label, city } of this.labels) {
      const world = city.dir.clone().applyQuaternion(this.planet.group.getWorldQuaternion(new THREE.Quaternion()));
      const facing = world.dot(camDir);
      label.element.style.opacity = this.landing || this.ascending ? 0 : Math.max(0, Math.min(1, (facing - 0.25) * 3));
    }
  }
}
