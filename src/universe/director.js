import * as THREE from 'three';
import { R } from './planet.js';
import '../cine.css';

// "The Big Bang of open source", part one: from the git singularity to a world, then down to a city.
// Fully deterministic: every frame is computed from the director's clock, so tools/video/capture.mjs
// can render it frame by frame (?director&capture) or it plays live (?director).

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const envelope = (t, a, b, fade = 0.6) => Math.min(span(t, a, a + fade), 1 - span(t, b - fade, b));
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// A smooth curve through keyframes [t, value] that never overshoots (monotone cubic, Fritsch-Carlson)
// and starts and ends at rest.
function curve(keys) {
  const n = keys.length;
  const d = keys.slice(1).map(([t1, y1], i) => (y1 - keys[i][1]) / (t1 - keys[i][0]));
  const m = keys.map((_, i) => (i === 0 || i === n - 1 || d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) continue;
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      m[i] = (3 / Math.sqrt(h)) * a * d[i];
      m[i + 1] = (3 / Math.sqrt(h)) * b * d[i];
    }
  }
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (t > keys[i + 1][0]) i++;
    const [t0, y0] = keys[i];
    const [t1, y1] = keys[i + 1];
    const h = t1 - t0;
    const s = (t - t0) / h;
    return (2 * s ** 3 - 3 * s ** 2 + 1) * y0 + (s ** 3 - 2 * s ** 2 + s) * h * m[i] + (-2 * s ** 3 + 3 * s ** 2) * y1 + (s ** 3 - s ** 2) * h * m[i + 1];
  };
}

// film time -> galaxy year: brisk through the early years, lingering on the AI wave and this year's protostars
const YEARS = [
  [6.6, 2007.4],
  [9.2, 2010.6],
  [12.0, 2015.6],
  [14.4, 2020.4],
  [15.6, 2022.5],
  [18.0, 2024.9],
  [20.8, 2027.2], // a little past today, so the newest worlds finish lighting up
];
const yearAt = curve(YEARS);
// camera distance from the core: close on the singularity, pulling back as the disk grows outward
const distanceAt = curve([
  [0, 330],
  [5.5, 400],
  [8.4, 640],
  [10.8, 1050],
  [13.2, 1550],
  [16.2, 1950],
  [20, 2250],
  [24.5, 2300],
]);

export const HERO = 'karpathy';
export const HERO_CITY = 'llm.c';

export class Director {
  constructor(cv) {
    this.cv = cv;
    this.t = 0;
    this.duration = 43.4;
    this.ready = false;
  }

  async prepare() {
    const { views, ctx, go } = this.cv;
    // build the hero's world first (its terrain bake takes a moment), then open on the galaxy
    await views.galaxy.load();
    await views.planet.enter(HERO);
    views.planet.noNavigate = true;
    await go({}, { push: false });
    await document.fonts?.ready;
    const { camera, controls } = ctx;
    controls.enabled = false;
    controls.autoRotate = false;
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    camera.near = 1;
    camera.far = 30000;
    camera.updateProjectionMatrix();

    this.galaxy = views.galaxy;
    this.planet = views.planet;
    this.galaxy.setYear(YEARS[0][1]);
    this.born = this.galaxy.data.accounts.map((a) => this.galaxy.yearOfId(a.i)).sort((a, b) => a - b);
    const hero = this.galaxy.byLogin.get(HERO);
    this.heroPos = this.galaxy.worldPos[hero];
    this.heroAccount = this.galaxy.data.accounts[hero];
    this.heroCity = Math.max(0, this.planet.planet.cities.findIndex((c) => c.repo.n === HERO_CITY));
    this.bloom = ctx.composer.passes.find((p) => 'strength' in p);
    this.bloomStrength = this.bloom?.strength ?? 0.85;
    this.glow = this.galaxy.singularity.children[0];

    this.cine = document.createElement('div');
    this.cine.id = 'cine';
    this.cine.innerHTML = `
      <div class="cine-shade"></div>
      <div class="cine-center"><div class="cine-title"></div><div class="cine-sub"></div></div>
      <div class="cine-year"><b></b><span></span></div>
      <div class="cine-top"></div>`;
    document.body.appendChild(this.cine);
    const q = (s) => this.cine.querySelector(s);
    this.el = { center: q('.cine-center'), title: q('.cine-title'), sub: q('.cine-sub'), year: q('.cine-year'), yearN: q('.cine-year b'), count: q('.cine-year span'), top: q('.cine-top'), shade: q('.cine-shade') };
    this.nurseryAt = YEARS[0][0];
    while (yearAt(this.nurseryAt) < 2025.15) this.nurseryAt += 0.01;
    this.ready = true;
    this.step(0);
    if (!new URLSearchParams(location.search).has('capture')) this.play();
  }

  play() {
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      this.step(Math.min((now - last) / 1000, 0.1));
      last = now;
      if (this.t < this.duration + 0.5) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  caption(title, sub, opacity) {
    if (this.el.title.textContent !== title) this.el.title.textContent = title;
    if (this.el.sub.textContent !== sub) this.el.sub.textContent = sub;
    this.el.center.style.opacity = opacity;
    this.el.shade.style.opacity = opacity;
  }

  top(html, opacity) {
    if (this.el.top.innerHTML !== html) this.el.top.innerHTML = html;
    this.el.top.style.opacity = opacity;
  }

  step(dt) {
    this.t += dt;
    if (this.t < 28.5) this.#galaxyShot(this.t);
    else this.#planetShot(this.t);
    this.cv.stepFrame(dt);
  }

  // 0 - 28.5 s: the singularity, the galaxy forming year by year, then a dive into the hero's star
  #galaxyShot(t) {
    const { camera, controls, ui } = this.cv.ctx;
    if (this.cv.current !== this.galaxy) this.cv.setView(this.galaxy);
    const year = yearAt(t);
    this.galaxy.setYear(year);

    // pull back from the singularity as the disk grows outward
    const dist = distanceAt(t);
    const el = 0.26 + 0.6 * ease(span(t, 2, 21.5));
    const az = 0.9 + 1.5 * ease(span(t, 0, 24.5));
    // the opening is close to a very hot object: keep the glow and bloom down until the stars arrive
    const open = 1 - span(t, 5.5, 9.5);
    if (this.bloom) this.bloom.strength = this.bloomStrength * (1 - 0.6 * open);
    this.glow.material.opacity = 1 - 0.75 * open;
    const pos = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(dist);
    const look = new THREE.Vector3(0, 0, 0);
    if (t > 24.5) {
      const d = ease(span(t, 24.5, 28.5));
      const star = this.heroPos.clone().applyMatrix4(this.galaxy.disk.matrixWorld);
      pos.lerp(star.clone().add(new THREE.Vector3(10, 16, 22)), d);
      look.lerp(star, Math.min(1, d * 1.6));
    }
    camera.position.copy(pos);
    controls.target.copy(look);
    ui.fade(span(t, 27.5, 28.5));

    this.el.year.style.opacity = envelope(t, 6.9, 24.6, 0.8);
    this.el.yearN.textContent = Math.min(Math.floor(year), 2026);
    this.el.count.textContent = `${fmt(this.born.filter((b) => b <= year).length)} worlds`;
    document.body.style.setProperty('--sector-alpha', envelope(t, 21, 24.7, 0.8).toFixed(3));

    if (t < 3.4) this.caption('In 2005, a single commit set off a singularity.', '', envelope(t, 0.5, 3.4, 0.7));
    else if (t < 6.8) this.caption('It was called git.', '', envelope(t, 3.6, 6.8, 0.7));
    else if (year > 2022.5 && year < 2024.9) this.caption('The AI Nebula ignites', 'the LLM wave · 2022 – 2024', envelope(year, 2022.5, 2024.9, 0.5));
    else if (year > 2025.15 && t < 21) this.caption('New stars are born', 'the fastest-rising repositories of 2025 – 2026', envelope(t, this.nurseryAt, 21, 0.5));
    else if (t > 21 && t < 24.6) this.caption(`${fmt(this.galaxy.data.accounts.length)} worlds`, 'every star is a real GitHub account', envelope(t, 21, 24.6, 0.6));
    else this.caption('', '', 0);

    if (t < 12) this.top('The universe of open source', envelope(t, 7.2, 12, 0.8));
    else if (t > 24.6) this.top(`Approaching @${this.heroAccount.l}<small>${this.heroAccount.top?.slice(0, 3).join(' · ') ?? ''}</small>`, envelope(t, 24.8, 28.2, 0.5));
    else this.top('', 0);
  }

  // 28.5 - 43.4 s: the hero's world, then the landing into its city
  #planetShot(t) {
    const { camera, controls, ui } = this.cv.ctx;
    const view = this.planet;
    if (this.cv.current !== view) {
      this.cv.setView(view);
      if (this.bloom) this.bloom.strength = this.bloomStrength;
      camera.near = 0.5;
      camera.far = 20000;
      camera.updateProjectionMatrix();
    }
    const sun = view.planet.uniforms.uSunDir.value;
    const side = new THREE.Vector3().crossVectors(sun, new THREE.Vector3(0, 1, 0)).normalize().negate();
    const orbitFrom = side.clone().addScaledVector(sun, 0.55).add(new THREE.Vector3(0, 0.32, 0)).normalize();
    const orbitTo = side.clone().addScaledVector(sun, -0.5).add(new THREE.Vector3(0, 0.14, 0)).normalize();
    if (t < 38.6) {
      // the world turns slowly; time it so the city we land in comes round just ahead of the camera
      const dir = view.planet.cities[this.heroCity].dir;
      const final = Math.atan2(orbitTo.x, orbitTo.z) - Math.atan2(dir.x, dir.z) + 0.22;
      view.planet.group.rotation.y = final - 0.012 * (38.6 - t);
    }
    this.el.year.style.opacity = 0;
    if (t < 38.6) {
      ui.fade(1 - span(t, 28.5, 29.6));
      // sweep from the day side across the terminator into the city lights
      const k = ease(span(t, 28.5, 38.6));
      camera.position.copy(orbitFrom.clone().lerp(orbitTo, k).normalize().multiplyScalar(R * THREE.MathUtils.lerp(3.5, 2.45, k)));
      controls.target.set(0, 0, 0);
      const p = view.planet;
      if (t < 33.9) this.caption(`@${view.data.login}`, `Level ${p.level.level} · ${p.level.name} · ${fmt(p.stars)} ★`, envelope(t, 29.4, 33.9, 0.6));
      else this.caption('Every developer is a world.', 'Every repository, a city.', envelope(t, 34.1, 38.5, 0.6));
      this.top('', 0);
    } else {
      if (!view.landing) view.land(this.heroCity);
      this.caption('', '', 0);
      const city = view.planet.cities[this.heroCity];
      this.top(`Landing in ${city.repo.n}<small>${fmt(city.repo.s)} ★ · ${city.tier}</small>`, envelope(t, 38.9, 42.6, 0.5));
    }
  }
}
