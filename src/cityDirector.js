import * as THREE from 'three';
import './cine.css';

// "The Big Bang of open source", part two: we come down through the clouds into a city, watch its
// whole history rebuild it, ride an elevator up its biggest tower while the code scrolls, then the
// end card. Deterministic like the universe director (src/universe/director.js).

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const envelope = (t, a, b, fade = 0.6) => Math.min(span(t, a, a + fade), 1 - span(t, b - fade, b));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const hashUnit = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const month = (t) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const CODE = new Set(['c', 'cu', 'h', 'cc', 'cpp', 'hpp', 'py', 'js', 'mjs', 'ts', 'tsx', 'go', 'rs', 'java', 'zig', 'rb', 'cs', 'swift', 'kt']);

const FONTS = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';
const SITE = 'krapcys1-maker.github.io/commitverse';

// timeline (seconds)
const T = { play: 0.6, history: 11.5, orbitEnd: 13.6, fly: 13.6, enter: 15.6, scroll: [16.2, 22.0], dip: [21.6, 22.1], end: 22.1, card: [23.0, 27.7], out: [27.6, 28.6] };

export class CityDirector {
  constructor(cp) {
    this.cp = cp;
    this.t = 0;
    this.duration = T.out[1];
    this.ready = false;
    this.cues = []; // [time, kind] of rockets and impacts, for the soundtrack (tools/video/score.mjs)
  }

  async prepare() {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONTS });
    document.head.appendChild(link);
    await new Promise((resolve) => (link.onload = link.onerror = resolve));
    await Promise.all(['600 20px "Space Grotesk"', '500 20px "JetBrains Mono"'].map((f) => document.fonts.load(f).catch(() => null)));

    const { data, controls, timelapse, camera } = this.cp;
    this.size = data.size;
    // a vertical film (Shorts, Reels) keeps the landscape film's width of view
    if (camera.aspect < 1) {
      camera.fov = (2 * Math.atan(Math.tan((22.5 * Math.PI) / 180) / camera.aspect) * 180) / Math.PI;
      camera.updateProjectionMatrix();
    }
    controls.enabled = false;
    controls.autoRotate = false;
    const params = new URLSearchParams(location.search);
    const path = params.get('enter');
    this.building = path ? data.files.findIndex((f) => f.p === path) : -1;
    if (this.building < 0) {
      // the tallest hand-written code: generated files are often the biggest, and the least telling
      const GENERATED = /(^|\/)(ent|gen|generated|vendor|mocks?|dist|build|third_party|node_modules)\/|\.(pb|gen|generated|min)\.|_pb2\.|_generated\./i;
      const code = data.files.map((f, i) => [f, i]).filter(([f]) => f.alive && CODE.has(f.p.split('.').pop().toLowerCase()) && !GENERATED.test(f.p));
      const pick = (list) => list.reduce((best, x) => (!best || x[0].loc > best[0].loc ? x : best), null)?.[1] ?? -1;
      this.building = pick(code.filter(([f]) => f.loc <= 5000));
      if (this.building < 0) this.building = pick(code);
    }
    // a live snapshot (src/liveCity.js) has no history to replay: its buildings rise in waves from the
    // centre outward instead, and the ones worked on lately flash as they go up
    this.snapshot = !!data.snapshot;
    if (this.snapshot) {
      const far = Math.max(...data.files.map((f) => Math.hypot(f.x + f.w / 2, f.z + f.d / 2)), 1);
      this.rise = data.files.map((f) => T.play + 8.4 * Math.pow(Math.hypot(f.x + f.w / 2, f.z + f.d / 2) / far, 0.8) + (hashUnit(f.p) - 0.5) * 0.6);
      this.risen = new Uint8Array(data.files.length);
      this.cp.city.showEmpty();
    } else {
      timelapse.duration = T.history;
      timelapse.seek(0);
    }
    this.seen = new WeakSet(); // city effects already noted as cues

    this.cine = document.createElement('div');
    this.cine.id = 'cine';
    this.cine.innerHTML = `
      <div class="cine-shade"></div>
      <div class="cine-center"><div class="cine-title"></div><div class="cine-sub"></div></div>
      <div class="cine-year"><b></b><span></span></div>
      <div class="cine-top"></div>
      <div class="cine-end">
        <div class="mark"></div>
        <h1>COMMITVERSE</h1>
        <p>Every developer is a world. Every repository, a city.</p>
        <div><code>${SITE}</code></div>
      </div>
      <div class="cine-black"></div>`;
    document.body.appendChild(this.cine);
    const q = (s) => this.cine.querySelector(s);
    this.el = { center: q('.cine-center'), title: q('.cine-title'), sub: q('.cine-sub'), year: q('.cine-year'), yearN: q('.cine-year b'), count: q('.cine-year span'), top: q('.cine-top'), end: q('.cine-end'), black: q('.cine-black'), shade: q('.cine-shade') };
    this.el.year.classList.add('date');
    this.veil = document.getElementById('arrival');
    this.veil.classList.add('on');
    this.caption = document.getElementById('caption');
    this.captionAlpha = 0;
    this.ready = true;
    await this.step(0);
    // ?record waits for the viewer to press record (src/main.js); ?capture is stepped from outside
    if (!params.has('capture') && !params.has('record')) this.play();
  }

  // Real time; resolves when the film is over.
  play() {
    return new Promise((resolve) => {
      let last = performance.now();
      const loop = () => {
        const now = performance.now();
        this.step(Math.min((now - last) / 1000, 0.1));
        last = now;
        if (this.t < this.duration + 0.3) requestAnimationFrame(loop);
        else resolve();
      };
      requestAnimationFrame(loop);
    });
  }

  #caption(title, sub, opacity) {
    if (this.el.title.textContent !== title) this.el.title.textContent = title;
    if (this.el.sub.textContent !== sub) this.el.sub.textContent = sub;
    this.el.center.style.opacity = opacity;
    this.el.shade.style.opacity = opacity;
  }

  #top(html, opacity) {
    if (this.el.top.innerHTML !== html) this.el.top.innerHTML = html;
    this.el.top.style.opacity = opacity;
  }

  // A snapshot city going up: every building rises over 1.4 s from its own moment, and the ones worked
  // on lately (src/liveCity.js) flash as they top out, like commits.
  #raise(t) {
    const { city, data } = this.cp;
    if (t > T.fly) return;
    let risen = 0;
    data.files.forEach((f, i) => {
      const k = ease(span(t, this.rise[i], this.rise[i] + 1.4));
      city.loc[i] = f.loc * k;
      city.lastTouch[i] = k > 0 ? f.last : 0;
      if (k > 0) risen++;
      if (k >= 1 && !this.risen[i]) {
        this.risen[i] = 1;
        if (f.c > 0) city.touch(i, f.loc, 0);
      }
    });
    this.risenCount = risen;
    city.now = data.snapshot.now;
    city.ruinMode = true;
    city.update();
  }

  // Orbit around the city, high enough to watch all of it grow: angle, distance and height
  // as fractions of the city's size.
  #orbitPos(k) {
    const s = this.size;
    const a = 0.85 + 0.95 * k;
    const r = s * THREE.MathUtils.lerp(1.4, 1.02, k);
    return new THREE.Vector3(Math.sin(a) * r, s * THREE.MathUtils.lerp(0.85, 0.48, k), Math.cos(a) * r);
  }

  async step(dt) {
    this.t += dt;
    const t = this.t;
    const { camera, controls, timelapse, data, reader } = this.cp;
    const s = this.size;

    // ---- arrival and history
    this.veil.style.opacity = 1 - ease(span(t, 0.1, 2.5));
    if (this.snapshot) this.#raise(t);
    else if (t >= T.play && !this.played) {
      this.played = true;
      timelapse.play();
    }
    if (t < T.fly) {
      const orbitK = ease(span(t, 0, T.orbitEnd));
      const orbit = this.#orbitPos(orbitK);
      const arrive = ease(span(t, 0, 3.6));
      const high = new THREE.Vector3(s * 0.12, s * 2.6, s * 0.3);
      camera.position.copy(high.lerp(orbit, arrive));
      controls.target.set(0, s * 0.02, 0);
    }
    // note every rocket and asteroid the city launches, for the soundtrack
    for (const e of this.cp.events?.effects ?? []) {
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      this.cues.push([Number(t.toFixed(3)), e.kind]);
    }

    if (timelapse.active && t > 0.8) {
      const c = timelapse.currentCommit;
      this.el.yearN.textContent = c ? day(c.t) : '';
      this.el.count.textContent = `${fmt(timelapse.cursor)} commits`;
    }
    if (this.snapshot && t > 0.8) {
      this.el.yearN.textContent = day(data.snapshot.now);
      this.el.count.textContent = `${fmt(this.risenCount ?? 0)} buildings`;
    }
    this.el.year.style.opacity = envelope(t, 1.0, 13.2, 0.7);

    const first = data.commits[0]?.t ?? 0;
    const last = data.commits.at(-1)?.t ?? 0;
    const f = data.files[this.building];
    const stat = this.snapshot ? `${fmt(data.files.length)} buildings · ${fmt(data.snapshot.stars ?? 0)} ★` : `${fmt(data.files.filter((x) => x.alive).length)} buildings · ${fmt(data.commits.length)} commits`;
    this.#top(`${data.repo.name}<small>${stat}</small>`, envelope(t, 1.4, 13.4, 0.7));
    this.el.center.classList.toggle('aside', t > 14);
    if (t < 6.6) this.#caption('Every file is a building.', 'every folder, a district', envelope(t, 2.4, 6.4, 0.6));
    else if (t < 12 && this.snapshot) this.#caption('Every line is a floor.', 'lit windows: the files worked on lately', envelope(t, 6.8, 11.4, 0.6));
    else if (t < 12) this.#caption('Every commit raises the city.', `${fmt(data.commits.length)} commits · ${month(first)} → ${month(last)}`, envelope(t, 6.8, 11.4, 0.6));
    else if (t > 16 && t < T.end && f) this.#caption('Every floor is a line of code.', `${f.p.split('/').pop()} · ${fmt(f.loc)} lines`, envelope(t, 16.4, 21.4, 0.6));
    else this.#caption('', '', 0);

    // ---- into the tallest tower
    if (t >= T.fly && !this.flown) {
      this.flown = true;
      if (timelapse.active) timelapse.finish();
      if (this.snapshot) this.cp.city.showFinal();
      if (f) this.cp.flyTo(f.p);
    }
    if (!f) {
      // a city without a code file to walk into: keep circling until the end card
      if (t >= T.fly && t < T.end) {
        const k = ease(span(t, T.fly, T.end));
        const a = 1.8 + 0.6 * k;
        camera.position.set(Math.sin(a) * s * 0.9, s * THREE.MathUtils.lerp(0.48, 0.3, k), Math.cos(a) * s * 0.9);
        controls.target.set(0, s * 0.02, 0);
      }
    }
    if (t >= T.enter && !this.entered && f) {
      this.entered = true;
      await this.cp.enterBuilding(this.building);
    }
    if (this.entered && t < T.end) {
      const k = ease(span(t, T.scroll[0], T.scroll[1]));
      reader.scrollTo(Math.round(k * reader.scrollMax * 0.32));
    }

    // ---- a dip to black, then the end card over the night city
    const dip = t < T.end ? span(t, T.dip[0], T.dip[1]) : 1 - span(t, T.end, T.end + 0.5);
    this.el.black.style.opacity = Math.max(dip, span(t, T.out[0], T.out[1]));
    if (t >= T.end && !this.exited) {
      this.exited = true;
      this.cp.exitBuilding();
      controls.enabled = false;
    }
    if (t >= T.end) {
      const k = ease(span(t, T.end, T.out[1]));
      const a = 2.4 + 0.5 * k;
      const r = s * THREE.MathUtils.lerp(0.75, 1.15, k);
      camera.position.set(Math.sin(a) * r, s * THREE.MathUtils.lerp(0.28, 0.62, k), Math.cos(a) * r);
      controls.target.set(0, s * 0.03, 0);
    }
    this.el.end.style.opacity = envelope(t, T.card[0], T.card[1] + 1, 1.0);

    // the city's own captions (rockets, impacts) fade on the film clock too
    const on = this.caption.classList.contains('show');
    this.captionAlpha = clamp01(this.captionAlpha + (on ? dt / 0.3 : -dt / 0.5));
    this.caption.style.opacity = this.captionAlpha;

    this.cp.stepFrame(dt);
  }
}
