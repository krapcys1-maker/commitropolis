// The sound of the Commitverse: an ambient score generated live in the browser (no samples) and a few
// effects for travel and events. A drone, slow pad chords, the odd bell, a little space wind; a whoosh
// between scales, a boom for an asteroid, a roar for a rocket. Off until the viewer turns it on.

const KEY = 'commitverse:sound';
const CHORDS = [
  [50, 57, 60, 64, 69], // Dm9
  [46, 53, 57, 62, 65], // Bbmaj7
  [53, 57, 60, 64, 67], // Fmaj7
  [48, 55, 62, 64, 67], // Cadd9
];
const BELLS = [74, 77, 79, 81, 84, 86, 89];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const MOODS = {
  universe: { cutoff: 1500, bells: 5, air: 0.55 },
  galaxy: { cutoff: 1300, bells: 6, air: 0.5 },
  system: { cutoff: 1100, bells: 8, air: 0.45 },
  planet: { cutoff: 950, bells: 9, air: 0.4 },
  city: { cutoff: 800, bells: 12, air: 0.3 },
};

export class Sound {
  constructor() {
    this.on = false;
    this.mode = 'universe';
    this.chord = 0;
    try {
      this.wanted = localStorage.getItem(KEY) === 'on';
    } catch {
      this.wanted = false;
    }
  }

  // A toggle button; when the viewer had sound on last time, the first click anywhere resumes it.
  attach(button) {
    this.button = button;
    this.#label();
    button.onclick = (e) => {
      e.stopPropagation();
      this.toggle();
    };
    if (this.wanted) addEventListener('pointerdown', () => this.wanted && !this.on && this.start(), { once: true });
  }

  toggle() {
    if (this.on) this.stop();
    else this.start();
  }

  start() {
    if (this.on) return;
    this.on = this.wanted = true;
    this.#save();
    if (!this.ctx) this.#build();
    this.ctx.resume();
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 1.2);
    this.#loop();
    this.#label();
  }

  stop() {
    this.on = this.wanted = false;
    this.#save();
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    clearTimeout(this.timer);
    clearTimeout(this.bellTimer);
    this.#label();
  }

  mood(name) {
    this.mode = MOODS[name] ? name : 'universe';
    if (!this.ctx) return;
    const m = MOODS[this.mode];
    this.padFilter.frequency.setTargetAtTime(m.cutoff, this.ctx.currentTime, 2);
    this.airGain.gain.setTargetAtTime(0.03 * m.air, this.ctx.currentTime, 2);
  }

  #save() {
    try {
      localStorage.setItem(KEY, this.wanted ? 'on' : 'off');
    } catch {}
  }

  #label() {
    if (!this.button) return;
    this.button.textContent = this.on ? '🔊' : '🔈';
    this.button.title = this.on ? 'Sound on: click to mute' : 'Sound off: click for the music of the Commitverse';
    this.button.setAttribute('aria-pressed', String(this.on));
  }

  #build() {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // a long, dark hall: an impulse of decaying stereo noise
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 4.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);
    // the drone: D and A, breathing slowly
    for (const [f, g] of [[mtof(26), 0.05], [mtof(33), 0.025], [mtof(38), 0.018]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = g;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.05;
      const depth = ctx.createGain();
      depth.gain.value = g * 0.5;
      lfo.connect(depth).connect(gain.gain);
      o.connect(gain).connect(this.master);
      o.start();
      lfo.start();
    }
    // the pad's filter, opened and closed by the mood
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = MOODS[this.mode].cutoff;
    this.padFilter.Q.value = 0.7;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.32;
    this.padFilter.connect(this.padBus);
    this.padBus.connect(this.master);
    this.padBus.connect(this.reverb);
    // space wind: noise through a slowly wandering band-pass
    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 500;
    band.Q.value = 0.8;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.03;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 300;
    sweep.connect(sweepDepth).connect(band.frequency);
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0.03 * MOODS[this.mode].air;
    src.connect(band).connect(this.airGain);
    this.airGain.connect(this.master);
    this.airGain.connect(this.reverb);
    src.start();
    sweep.start();
    this.noise = noise;
  }

  // The next chord, held for nine seconds with long swells; then the one after.
  #loop() {
    if (!this.on) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const notes = CHORDS[this.chord++ % CHORDS.length];
    for (const m of notes) {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.022, t + 3);
        g.gain.setValueAtTime(0.022, t + 7.5);
        g.gain.linearRampToValueAtTime(0, t + 11.5);
        o.connect(g).connect(this.padFilter);
        o.start(t);
        o.stop(t + 12);
      }
    }
    this.timer = setTimeout(() => this.#loop(), 9000);
    clearTimeout(this.bellTimer);
    const bell = () => {
      if (!this.on) return;
      this.bell(BELLS[Math.floor(Math.random() * BELLS.length)], 0.05);
      this.bellTimer = setTimeout(bell, (MOODS[this.mode].bells * 0.5 + Math.random() * MOODS[this.mode].bells) * 1000);
    };
    this.bellTimer = setTimeout(bell, 1500 + Math.random() * 3000);
  }

  // An FM bell: glassy, inharmonic, mostly reverb.
  bell(m, amp = 0.06) {
    if (!this.on) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f = mtof(m);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * 2.5, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 1.5);
    mod.connect(modGain).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    car.connect(g).connect(pan);
    pan.connect(this.reverb);
    pan.connect(this.master);
    car.start(t);
    mod.start(t);
    car.stop(t + 3.6);
    mod.stop(t + 3.6);
  }

  #noiseBurst(dur, from, to, amp, q = 1.2, type = 'bandpass') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    g.connect(this.master);
    g.connect(this.reverb);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  // travelling between scales
  whoosh(out = true) {
    if (!this.on) return;
    this.#noiseBurst(1.3, out ? 300 : 5000, out ? 5000 : 300, 0.22);
  }

  // an asteroid hits the city
  boom() {
    if (!this.on) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.9);
    this.#noiseBurst(0.9, 3000, 200, 0.3, 0.7, 'lowpass');
  }

  // a release lifts off
  rocket() {
    if (!this.on) return;
    this.#noiseBurst(2.6, 250, 2600, 0.12, 0.9);
  }

  // arriving somewhere: a soft rising arpeggio
  chime() {
    if (!this.on) return;
    [69, 74, 76, 81].forEach((m, k) => setTimeout(() => this.bell(m, 0.04), k * 140));
  }
}
