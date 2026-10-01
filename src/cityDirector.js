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
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const month = (t) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const CODE = new Set(['c', 'cu', 'h', 'cc', 'cpp', 'hpp', 'py', 'js', 'mjs', 'ts', 'tsx', 'go', 'rs', 'java', 'zig', 'rb', 'cs', 'swift', 'kt']);

const FONTS = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';
const SITE = 'krapcys1-maker.github.io/commitropolis';

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

    const { data, controls, timelapse } = this.cp;
    this.size = data.size;
    controls.enabled = false;
    controls.autoRotate = false;
    const params = new URLSearchParams(location.search);
    const path = params.get('enter');
    this.building = path ? data.files.findIndex((f) => f.p === path) : -1;
    if (this.building < 0) {
      let best = -1;
      data.files.forEach((f, i) => {
        if (f.alive && CODE.has(f.p.split('.').pop().toLowerCase()) && (best < 0 || f.loc > data.files[best].loc)) best = i;
      });
      this.building = best;
    }
    timelapse.duration = T.history;
    timelapse.seek(0);
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
    if (!params.has('capture')) this.play();
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
    if (t >= T.play && !this.played) {
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
    this.el.year.style.opacity = envelope(t, 1.0, 13.2, 0.7);

    const first = data.commits[0]?.t ?? 0;
    const last = data.commits.at(-1)?.t ?? 0;
    const f = data.files[this.building];
    this.#top(`${data.repo.name}<small>${fmt(data.files.filter((x) => x.alive).length)} buildings · ${fmt(data.commits.length)} commits</small>`, envelope(t, 1.4, 13.4, 0.7));
    this.el.center.classList.toggle('aside', t > 14);
    if (t < 6.6) this.#caption('Every file is a building.', 'every folder, a district', envelope(t, 2.4, 6.4, 0.6));
    else if (t < 12) this.#caption('Every commit raises the city.', `${fmt(data.commits.length)} commits · ${month(first)} → ${month(last)}`, envelope(t, 6.8, 11.4, 0.6));
    else if (t > 16 && t < T.end) this.#caption('Every floor is a line of code.', `${f.p.split('/').pop()} · ${fmt(f.loc)} lines`, envelope(t, 16.4, 21.4, 0.6));
    else this.#caption('', '', 0);

    // ---- into the tallest tower
    if (t >= T.fly && !this.flown) {
      this.flown = true;
      if (timelapse.active) timelapse.finish();
      this.cp.flyTo(f.p);
    }
    if (t >= T.enter && !this.entered) {
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
