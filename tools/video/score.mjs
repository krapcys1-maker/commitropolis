#!/usr/bin/env node
// The soundtrack of "The Big Bang of open source", synthesised from scratch (no samples, no
// licences): pads, plucks, bells, drums and sound effects, cut to the film's timeline. The city's
// asteroid impacts and rocket launches land exactly where capture.mjs saw them happen.
//
//   node tools/video/score.mjs --cues video/bigbang-silent.cues.json --out video/score.wav
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const PART = opt('part', 'all');
// --part city: the city part alone, for a film of any repository (src/cityDirector.js records it live)
const film = PART === 'city' ? { duration: Number(opt('duration', 28.6)), segments: [{ name: 'city', start: 0 }], cues: [] } : JSON.parse(readFileSync(opt('cues', 'video/bigbang-silent.cues.json'), 'utf8'));
const OUT = opt('out', 'video/score.wav');
const SR = 48000;
const DUR = film.duration;
const N = Math.ceil(DUR * SR) + SR;
const city = film.segments.find((s) => s.name === 'city')?.start ?? 43.4;

// two buses: dry, and a send into the reverb
const dry = [new Float32Array(N), new Float32Array(N)];
const wet = [new Float32Array(N), new Float32Array(N)];

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));

function put(i, l, r, send) {
  if (i < 0 || i >= N) return;
  dry[0][i] += l;
  dry[1][i] += r;
  if (send) {
    wet[0][i] += l * send;
    wet[1][i] += r * send;
  }
}
const panLR = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// Zavalishin's state-variable filter: stable under fast cutoff sweeps
function svf() {
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  let k = 1;
  return {
    set(fc, q = 0.707) {
      const g = Math.tan(Math.PI * Math.min(fc, SR * 0.45) / SR);
      k = 1 / q;
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    },
    run(x) {
      const v3 = x - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      return { low: v2, band: v1, high: x - k * v1 - v2 };
    },
  };
}

const blep = (t, dt) => {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
};

// ---------------------------------------------------------------- instruments

// A warm analogue pad: three detuned saws per note through a slowly opening low-pass.
function pad(start, dur, notes, { amp = 0.05, attack = 1.2, release = 1.8, cut0 = 500, cut1 = 1800, q = 0.8, send = 0.6, width = 0.7 } = {}) {
  const total = dur + release;
  const n0 = Math.floor(start * SR);
  const len = Math.floor(total * SR);
  for (const m of notes) {
    const f = mtof(m);
    const det = [-0.11, 0.0, 0.12].map((c) => f * Math.pow(2, c / 12));
    const ph = det.map(() => rand());
    const fl = svf();
    const fr = svf();
    const pan = (rand() * 2 - 1) * width * 0.6;
    const [gl, gr] = panLR(pan);
    const scale = amp / Math.sqrt(notes.length) * (m < 40 ? 1.25 : 1);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      if (i % 32 === 0) {
        const c = cut0 + (cut1 - cut0) * Math.min(1, t / Math.max(dur, 0.01));
        fl.set(c, q);
        fr.set(c * 1.04, q);
      }
      let l = 0;
      let r = 0;
      for (let k = 0; k < 3; k++) {
        const dt = det[k] / SR;
        ph[k] += dt;
        if (ph[k] >= 1) ph[k] -= 1;
        const s = 2 * ph[k] - 1 - blep(ph[k], dt);
        if (k !== 2) l += s;
        if (k !== 0) r += s;
      }
      const env = t < attack ? Math.sin((t / attack) * Math.PI / 2) ** 2 : t < dur ? 1 : Math.max(0, 1 - (t - dur) / release) ** 2;
      const g = env * scale;
      put(n0 + i, fl.run(l).low * g * gl * 1.2, fr.run(r).low * g * gr * 1.2, send);
    }
  }
}

// Sine (or few-partial) tones: drones, subs, shimmer.
function tone(start, dur, freq, { amp = 0.1, attack = 0.5, release = 1, partials = [1], pan = 0, send = 0.2, tremolo = 0, glide = 0 } = {}) {
  const n0 = Math.floor(start * SR);
  const len = Math.floor((dur + release) * SR);
  const [gl, gr] = panLR(pan);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = freq * Math.pow(2, (glide * Math.min(t, dur)) / Math.max(dur, 0.01) / 12);
    ph += f / SR;
    let s = 0;
    partials.forEach((a, k) => (s += Math.sin(2 * Math.PI * ph * (k + 1)) * a));
    const env = (t < attack ? Math.sin((t / attack) * Math.PI / 2) ** 2 : t < dur ? 1 : Math.max(0, 1 - (t - dur) / release) ** 2) * (1 - tremolo * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.35 * t)));
    put(n0 + i, s * env * amp * gl, s * env * amp * gr, send);
  }
}

// Plucked string (Karplus-Strong), bright to dull.
function pluck(start, m, { amp = 0.08, decay = 0.996, bright = 0.5, pan = 0, send = 0.4, dur = 2.5 } = {}) {
  const f = mtof(m);
  const n0 = Math.floor(start * SR);
  const p = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(p);
  for (let i = 0; i < p; i++) buf[i] = rand() * 2 - 1;
  const [gl, gr] = panLR(pan);
  let idx = 0;
  const len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    const next = buf[(idx + 1) % p];
    buf[idx] = (cur * bright + (cur + next) * 0.5 * (1 - bright)) * decay; // the string's damping
    idx = (idx + 1) % p;
    const fade = i > len - 2000 ? (len - i) / 2000 : 1;
    put(n0 + i, cur * amp * gl * fade, cur * amp * gr * fade, send);
  }
}

// FM bell: inharmonic, glassy; for stars being born and the end card.
function bell(start, m, { amp = 0.05, decay = 2.2, ratio = 3.5, index = 3, pan = 0, send = 0.7 } = {}) {
  const f = mtof(m);
  const n0 = Math.floor(start * SR);
  const len = Math.floor(decay * 2.2 * SR);
  const [gl, gr] = panLR(pan);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.exp(-t / (decay * 0.45));
    const mod = Math.sin(2 * Math.PI * f * ratio * t) * index * Math.exp(-t / (decay * 0.18));
    const s = Math.sin(2 * Math.PI * f * t + mod) * e * (t < 0.004 ? t / 0.004 : 1);
    put(n0 + i, s * amp * gl, s * amp * gr, send);
  }
}

// Filtered noise: risers, wind, whooshes, cymbals.
function noise(start, dur, { amp = 0.1, f0 = 400, f1 = 4000, q = 1.2, mode = 'band', shape = (x) => Math.sin(Math.PI * x), pan0 = 0, pan1 = 0, send = 0.4 } = {}) {
  const n0 = Math.floor(start * SR);
  const len = Math.floor(dur * SR);
  const fl = svf();
  const fr = svf();
  for (let i = 0; i < len; i++) {
    const x = i / len;
    if (i % 32 === 0) {
      const f = f0 * Math.pow(f1 / f0, x);
      fl.set(f, q);
      fr.set(f * 1.03, q);
    }
    const a = fl.run(rand() * 2 - 1);
    const b = fr.run(rand() * 2 - 1);
    const pick = (o) => (mode === 'low' ? o.low : mode === 'high' ? o.high : o.band);
    const [gl, gr] = panLR(pan0 + (pan1 - pan0) * x);
    const e = shape(x) * amp;
    put(n0 + i, pick(a) * e * gl, pick(b) * e * gr, send);
  }
}

// A deep impact: falling sine thump with a noise crack.
function boom(start, { amp = 0.5, f0 = 90, f1 = 26, len = 2.6, crack = 0.3, send = 0.35 } = {}) {
  const n0 = Math.floor(start * SR);
  const L = Math.floor(len * SR);
  let ph = 0;
  for (let i = 0; i < L; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t * 3.2);
    ph += f / SR;
    const s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * (2.2 / len) * 1.6) * (t < 0.005 ? t / 0.005 : 1);
    put(n0 + i, s * amp, s * amp, send);
  }
  if (crack) noise(start, 1.4, { amp: crack, f0: 3000, f1: 300, q: 0.7, mode: 'low', shape: (x) => Math.exp(-x * 7), send: 0.6 });
}

function kick(start, amp = 0.32) {
  const n0 = Math.floor(start * SR);
  let ph = 0;
  for (let i = 0; i < SR * 0.45; i++) {
    const t = i / SR;
    ph += (48 + 110 * Math.exp(-t * 28)) / SR;
    const s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) * amp;
    put(n0 + i, s, s, 0.02);
  }
}

function hat(start, amp = 0.05, open = false, pan = 0.25) {
  noise(start, open ? 0.32 : 0.07, { amp, f0: 9000, f1: 7000, q: 0.9, mode: 'high', shape: (x) => Math.exp(-x * (open ? 4 : 6)), pan0: pan, pan1: pan, send: 0.08 });
}

// Saw bass through a plucky low-pass envelope (the city's groove).
function bass(start, m, dur, amp = 0.12) {
  const f = mtof(m);
  const n0 = Math.floor(start * SR);
  const len = Math.floor((dur + 0.08) * SR);
  const fl = svf();
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if (i % 16 === 0) fl.set(180 + 1400 * Math.exp(-t * 14), 1.1);
    const dt = f / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    const s = 2 * ph - 1 - blep(ph, dt);
    const env = (t < 0.004 ? t / 0.004 : 1) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.08) : 1);
    const y = fl.run(s).low * env * amp + Math.sin(2 * Math.PI * f * t) * env * amp * 0.5;
    put(n0 + i, y, y, 0.03);
  }
}

// ---------------------------------------------------------------- the score
const C = {
  Dm9: [38, 45, 48, 53, 57, 64],
  Bbmaj7: [34, 41, 45, 50, 53, 60],
  Fmaj7: [41, 48, 52, 57, 60, 64],
  Cadd9: [36, 43, 50, 52, 55, 62],
  Gm9: [43, 50, 53, 57, 58, 65],
  Dbig: [26, 38, 45, 50, 53, 57, 64, 69],
  Asus4: [33, 45, 50, 52, 57, 64],
  Bbmaj9: [34, 46, 50, 53, 57, 60],
  FC: [36, 48, 53, 57, 60, 64],
  Gm9lo: [31, 43, 50, 53, 57, 58],
  A7sus4: [33, 45, 50, 52, 55, 62],
  Dmaj9: [26, 38, 45, 50, 54, 57, 61, 64],
};
const PENTA = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86]; // D minor pentatonic, upper octaves

// the universe part plays only in the whole film (--part city renders the city alone, for films of any repo)
if (PART === 'all') {
  // 0 - 6.6: the void before the first commit
  tone(0, 6.4, mtof(26), { amp: 0.06, attack: 3, release: 1.2, partials: [1, 0.6, 0.45, 0.25], send: 0.1 });
  tone(0.4, 6.0, mtof(33), { amp: 0.07, attack: 3.5, release: 1, send: 0.2 });
  pad(0.2, 6.2, [38, 45, 52, 53], { amp: 0.035, attack: 3.5, release: 1.0, cut0: 260, cut1: 700, send: 0.7 });
  tone(1.5, 4.8, mtof(86), { amp: 0.012, attack: 2, release: 1.5, tremolo: 0.6, pan: -0.4, send: 0.9 });
  tone(2.2, 4.4, mtof(93), { amp: 0.008, attack: 2, release: 1.5, tremolo: 0.6, pan: 0.5, send: 0.9 });
  noise(4.6, 2.0, { amp: 0.09, f0: 300, f1: 7000, q: 1.6, shape: (x) => x ** 3, pan0: -0.3, pan1: 0.3, send: 0.6 }); // reverse swell

  // 6.6: the Big Bang
  boom(6.6, { amp: 0.5, f0: 110, f1: 30, len: 3.6, crack: 0.3 });
  noise(6.6, 3.5, { amp: 0.06, f0: 9000, f1: 2500, q: 0.6, mode: 'high', shape: (x) => Math.exp(-x * 4), send: 0.8 });
  // the galaxy forms
  const formation = [[6.6, 'Dm9'], [9.6, 'Bbmaj7'], [12.6, 'Fmaj7'], [15.6, 'Cadd9'], [18.6, 'Gm9']];
  formation.forEach(([t, name], k) => pad(t, 3.2, C[name], { amp: 0.055 + k * 0.006, attack: t === 6.6 ? 0.05 : 0.9, release: 1.6, cut0: 500 + k * 250, cut1: 1300 + k * 450, send: 0.6 }));
  tone(6.6, 14.4, mtof(26), { amp: 0.035, attack: 1, release: 1, partials: [1, 0.5, 0.3], send: 0.05 });
  // stars light up: bells, denser as the galaxy fills, a flurry when the AI Nebula ignites
  for (let t = 7.2; t < 21; ) {
    const busy = 1.5 + 9 * span(t, 7, 15) + (t > 15.6 && t < 18 ? 6 : 0) + (t > 18.6 ? 4 : 0);
    bell(t, PENTA[Math.floor(rand() * PENTA.length)] + (t > 15.6 && t < 18 ? 0 : 0), { amp: 0.018 + rand() * 0.014, decay: 1.4 + rand(), pan: rand() * 1.6 - 0.8, index: 2 + rand() * 2 });
    t += (0.3 + rand() * 0.7) / busy * 2.5;
  }
  // arpeggio pulse from 2015 on
  for (let t = 12.6, k = 0; t < 21; t += 0.3125, k++) {
    const chord = formation.filter(([s]) => s <= t).at(-1)[1];
    const tones = C[chord].filter((m) => m >= 50);
    pluck(t, tones[k % tones.length] + 12, { amp: 0.035 * span(t, 12.6, 15), bright: 0.35, pan: Math.sin(k * 0.9) * 0.5, decay: 0.994, send: 0.5, dur: 1.4 });
  }

  // 21 - 24.6: "3,959 worlds"
  pad(21, 3.6, C.Dbig, { amp: 0.09, attack: 0.4, release: 1.6, cut0: 1600, cut1: 3200, send: 0.7 });
  tone(21, 3.6, mtof(26), { amp: 0.06, attack: 0.3, release: 1.4, partials: [1, 0.5, 0.3], send: 0.05 });
  [74, 77, 81, 86, 89].forEach((m, k) => bell(21.1 + k * 0.18, m, { amp: 0.03, decay: 2.6, pan: -0.6 + k * 0.3 }));

  // 24.5 - 28.5: the dive into a star
  pad(24.5, 3.9, C.Asus4, { amp: 0.06, attack: 2.5, release: 0.4, cut0: 600, cut1: 4000, send: 0.5 });
  noise(24.5, 4.0, { amp: 0.16, f0: 200, f1: 9000, q: 1.8, shape: (x) => x ** 2.2, pan0: -0.5, pan1: 0.5, send: 0.4 });
  tone(24.5, 4.0, mtof(57), { amp: 0.02, attack: 2, release: 0.1, glide: 24, partials: [1, 0.4], send: 0.6 });

  // 28.5: a world
  boom(28.5, { amp: 0.3, f0: 70, f1: 30, len: 2.5, crack: 0.12, send: 0.5 });
  noise(28.5, 3, { amp: 0.05, f0: 8000, f1: 3000, q: 0.6, mode: 'high', shape: (x) => Math.exp(-x * 3), send: 0.9 });
  const world = [[28.5, 'Bbmaj9'], [31.0, 'FC'], [33.5, 'Gm9lo'], [36.0, 'Dm9']];
  world.forEach(([t, name]) => pad(t, 2.5, C[name], { amp: 0.06, attack: 0.8, release: 1.4, cut0: 900, cut1: 1600, send: 0.65 }));
  for (let t = 29.1, k = 0; t < 38.6; t += 0.3125, k++) {
    const chord = world.filter(([s]) => s <= t).at(-1)[1];
    const tones = C[chord].filter((m) => m >= 45);
    const order = [0, 2, 1, 3, 2, 4, 3, 5];
    pluck(t, tones[order[k % 8] % tones.length] + 12, { amp: 0.04, bright: 0.25 + 0.2 * Math.sin(k * 0.3), pan: Math.sin(k * 1.3) * 0.55, decay: 0.995, send: 0.55, dur: 1.6 });
  }

  // 38.6 - 43.4: down through the atmosphere
  pad(38.6, 2.4, C.Gm9lo, { amp: 0.055, attack: 0.6, release: 1.2, cut0: 1200, cut1: 900, send: 0.6 });
  pad(41.0, 2.4, C.A7sus4, { amp: 0.06, attack: 0.6, release: 0.8, cut0: 900, cut1: 3500, send: 0.6 });
  noise(38.6, 4.8, { amp: 0.15, f0: 300, f1: 1800, q: 0.7, mode: 'low', shape: (x) => x ** 1.6, send: 0.3 }); // wind
  noise(40.6, 2.8, { amp: 0.13, f0: 2500, f1: 300, q: 1.4, shape: (x) => Math.sin(Math.PI * x) ** 2, pan0: 0.7, pan1: -0.7, send: 0.4 }); // whoosh down

}
// ---------------------------------------------------------------- the city
const c0 = city;
noise(c0, 2.6, { amp: 0.11, f0: 1500, f1: 300, q: 0.6, mode: 'low', shape: (x) => (1 - x) ** 2, send: 0.3 }); // clouds clearing
const BEAT = 60 / 112;
const g0 = c0 + 0.6; // the timelapse starts
const grooveEnd = c0 + 13.4;
const cityChords = [C.Dm9, C.Bbmaj7, C.Fmaj7, C.Cadd9];
const bassLine = [[38, 38, 50, 38, 41, 38, 43, 45], [34, 34, 46, 34, 38, 41, 34, 46], [41, 41, 53, 41, 45, 48, 41, 53], [36, 36, 48, 36, 40, 43, 48, 47]];
for (let b = 0; g0 + b * BEAT < grooveEnd; b++) {
  const t = g0 + b * BEAT;
  const bar = Math.floor(b / 8) % 4; // two bars per chord
  const fade = 1 - span(t, grooveEnd - 2, grooveEnd);
  if (b % 8 === 0) pad(t, 8 * BEAT - 0.2, cityChords[bar], { amp: 0.05, attack: 0.3, release: 0.9, cut0: 900, cut1: 2200, send: 0.5 });
  if (b >= 4) kick(t, 0.3 * fade);
  if (b >= 4) hat(t + BEAT / 2, 0.035 * fade, b % 4 === 3, b % 2 ? 0.3 : -0.3);
  const line = bassLine[bar];
  bass(t, line[b % 8], BEAT * 0.45, 0.07 * fade * span(b, 0, 2));
  bass(t + BEAT / 2, line[b % 8], BEAT * 0.3, 0.05 * fade * span(b, 0, 2));
  // sixteenth-note plucks over the top
  const tones = cityChords[bar].filter((m) => m >= 48);
  for (let s = 0; s < 4; s++) pluck(t + (s * BEAT) / 4, tones[(b * 4 + s) % tones.length] + 12, { amp: 0.022 * fade, bright: 0.45, pan: ((b * 4 + s) % 5) / 2.5 - 0.8, decay: 0.993, send: 0.35, dur: 0.9 });
}
// the city's own events, where capture.mjs saw them
for (const [t, kind] of film.cues) {
  if (kind === 'impact') {
    noise(t, 0.95, { amp: 0.14, f0: 6000, f1: 500, q: 1.2, shape: (x) => x ** 1.5, pan0: 0.8, pan1: 0, send: 0.3 });
    boom(t + 0.9, { amp: 0.42, f0: 95, f1: 32, len: 1.9, crack: 0.22, send: 0.3 });
  } else if (kind === 'rocket') {
    noise(t, 2.8, { amp: 0.1, f0: 300, f1: 3000, q: 0.9, shape: (x) => Math.sin(Math.PI * Math.min(1, x * 1.6)) * (1 - x * 0.5), send: 0.4 });
    tone(t, 2.5, 60, { amp: 0.06, attack: 0.1, release: 0.6, glide: 12, send: 0.1 });
  }
}
// into the tower
noise(c0 + 13.6, 1.9, { amp: 0.1, f0: 500, f1: 4000, q: 1.2, shape: (x) => Math.sin(Math.PI * x) ** 2, pan0: -0.6, pan1: 0.6, send: 0.4 });
pad(c0 + 13.4, 2.4, C.Bbmaj7, { amp: 0.05, attack: 0.8, release: 1.2, cut0: 1500, cut1: 900, send: 0.6 });
// the elevator: a scale that climbs with the floors
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const inside = [[c0 + 15.6, 'Dm9'], [c0 + 17.2, 'Bbmaj7'], [c0 + 18.8, 'Cadd9'], [c0 + 20.4, 'A7sus4']];
inside.forEach(([t, name]) => pad(t, 1.6, C[name], { amp: 0.055, attack: 0.25, release: 0.9, cut0: 1000, cut1: 2600, send: 0.55 }));
for (let k = 0, t = c0 + 16.2; t < c0 + 21.8; k++, t += 0.135) {
  const step = Math.floor(k * 0.55);
  const m = 62 + 12 * Math.floor(step / 7) + DORIAN[step % 7];
  pluck(t, Math.min(m, 98), { amp: 0.03, bright: 0.55, pan: Math.sin(k * 0.7) * 0.6, decay: 0.993, send: 0.45, dur: 0.9 });
  if (k % 4 === 0) bass(t, 38, 0.12, 0.05);
}
tone(c0 + 15.6, 6.0, mtof(38), { amp: 0.06, attack: 0.5, release: 0.5, send: 0.1 });
// dip to black, then the end card
noise(c0 + 21.4, 0.7, { amp: 0.08, f0: 6000, f1: 300, q: 0.8, mode: 'low', shape: (x) => (1 - x) ** 2, send: 0.6 });
boom(c0 + 22.1, { amp: 0.32, f0: 60, f1: 28, len: 3.2, crack: 0.08, send: 0.6 });
pad(c0 + 22.1, 5.4, C.Dmaj9, { amp: 0.085, attack: 1.4, release: 1.3, cut0: 800, cut1: 2600, send: 0.75 });
tone(c0 + 22.1, 5.4, mtof(26), { amp: 0.045, attack: 1, release: 1.3, partials: [1, 0.5, 0.3], send: 0.05 });
[69, 74, 76, 78, 81, 86].forEach((m, k) => bell(c0 + 22.9 + k * 0.32, m, { amp: 0.035, decay: 2.8, pan: -0.5 + k * 0.2, ratio: 2.76, index: 2.2 }));

// ---------------------------------------------------------------- reverb (Freeverb) and master
function freeverb(input, { room = 0.86, damp = 0.32, spread = 23 } = {}) {
  const scale = SR / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  return [0, 1].map((ch) => {
    const out = new Float32Array(N);
    const x = input[ch];
    const combs = combT.map((t) => ({ buf: new Float32Array(Math.round((t + ch * spread) * scale)), i: 0, store: 0 }));
    const aps = apT.map((t) => ({ buf: new Float32Array(Math.round((t + ch * spread) * scale)), i: 0 }));
    for (let n = 0; n < N; n++) {
      const inp = x[n] * 0.015;
      let s = 0;
      for (const c of combs) {
        const y = c.buf[c.i];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.i] = inp + c.store * room;
        if (++c.i >= c.buf.length) c.i = 0;
        s += y;
      }
      for (const a of aps) {
        const b = a.buf[a.i];
        a.buf[a.i] = s + b * 0.5;
        if (++a.i >= a.buf.length) a.i = 0;
        s = b - s;
      }
      out[n] = s;
    }
    return out;
  });
}
const verb = freeverb(wet);
const L = Math.floor(DUR * SR);
const mix = [new Float32Array(L), new Float32Array(L)];
// the arc of the film: a quiet void, a swell to "3,959 worlds", a breath at the planet, the city, the finale
const arc = PART === 'all' ? [[0, 0.5], [6.4, 0.6], [6.7, 0.85], [20, 0.9], [21.2, 1.0], [28.6, 1.0], [30, 0.8], [38.6, 0.85], [43.4, 0.9], [c0 + 1, 0.95], [c0 + 21.4, 0.95], [c0 + 22.3, 1.0]] : [[0, 0.95], [21.4, 0.95], [22.3, 1.0]];
const arcAt = (t) => {
  let k = 1;
  while (k < arc.length - 1 && arc[k][0] < t) k++;
  const [t0, a0] = arc[k - 1];
  const [t1, a1] = arc[k];
  return a0 + (a1 - a0) * clamp01((t - t0) / (t1 - t0));
};
// a 2nd-order high-pass at 28 Hz: rumble no speaker can play only eats headroom
for (let ch = 0; ch < 2; ch++) {
  const hp = svf();
  hp.set(28, 0.707);
  for (let n = 0; n < L; n++) mix[ch][n] = hp.run((dry[ch][n] + verb[ch][n] * 3.2) * arcAt(n / SR)).high;
}
// gentle bus compression by soft clipping, then normalise to -1 dBFS with fades at both ends
let peak = 0;
for (let ch = 0; ch < 2; ch++) for (let n = 0; n < L; n++) peak = Math.max(peak, Math.abs(mix[ch][n]));
const drive = 1.6 / peak;
let peak2 = 0;
for (let ch = 0; ch < 2; ch++) for (let n = 0; n < L; n++) peak2 = Math.max(peak2, Math.abs((mix[ch][n] = Math.tanh(mix[ch][n] * drive))));
const gain = 0.89 / peak2;
const buf = Buffer.alloc(44 + L * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + L * 4, 4);
buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(L * 4, 40);
for (let n = 0; n < L; n++) {
  const t = n / SR;
  const fade = Math.min(1, t / 0.05, (DUR - t) / 1.2);
  for (let ch = 0; ch < 2; ch++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[ch][n] * gain * fade)) * 32767), 44 + n * 4 + ch * 2);
}
writeFileSync(OUT, buf);
console.log(`Wrote ${OUT}: ${DUR.toFixed(1)} s, ${film.cues.length} cued events`);
