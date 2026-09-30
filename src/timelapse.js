// Replays commit history on top of the fixed all-time layout: buildings rise from empty lots,
// shrink or get demolished, and files touched by a commit flash (warm = growth, red = deletion).
export class Timelapse {
  constructor(city, { duration = 40 } = {}) {
    this.city = city;
    this.commits = city.data.commits;
    this.duration = duration; // seconds for the whole history
    this.target = new Float32Array(city.files.length);
    this.cursor = this.commits.length;
    this.acc = 0;
    this.playing = false;
    this.active = false; // true while the city shows a historic state
    this.onCommit = () => {};
  }

  get progress() {
    return this.commits.length ? this.cursor / this.commits.length : 1;
  }

  get currentCommit() {
    return this.commits[Math.max(0, Math.min(this.cursor, this.commits.length) - 1)];
  }

  play() {
    if (!this.active || this.cursor >= this.commits.length) this.seek(0);
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  seek(fraction) {
    const to = Math.round(fraction * this.commits.length);
    if (!this.active) {
      this.active = true;
      this.city.showEmpty();
    }
    this.target.fill(0);
    this.city.heat.fill(0);
    this.cursor = 0;
    while (this.cursor < to) this.#apply(this.commits[this.cursor++], false);
    this.city.loc.set(this.target);
    this.city.update();
    this.onCommit(this.currentCommit);
  }

  // Advance by a wall-clock (or fixed, for video capture) time step.
  step(dt) {
    if (!this.playing) return;
    const perSecond = this.commits.length / this.duration;
    this.acc += dt * perSecond;
    let applied = false;
    while (this.acc >= 1 && this.cursor < this.commits.length) {
      this.#apply(this.commits[this.cursor++], true);
      this.acc -= 1;
      applied = true;
    }
    if (applied) this.onCommit(this.currentCommit);

    const { loc, heat } = this.city;
    const k = Math.min(1, dt * 6);
    const decay = Math.exp(-dt * 2.5);
    let settled = true;
    for (let i = 0; i < loc.length; i++) {
      const d = this.target[i] - loc[i];
      loc[i] = Math.abs(d) < 0.5 ? this.target[i] : loc[i] + d * k;
      heat[i] *= decay;
      if (loc[i] !== this.target[i] || Math.abs(heat[i]) > 0.02) settled = false;
    }
    this.city.update();
    if (this.cursor >= this.commits.length && settled) this.finish();
  }

  finish() {
    this.playing = false;
    this.active = false;
    this.acc = 0;
    this.cursor = this.commits.length;
    this.city.showFinal();
    this.onCommit(this.currentCommit);
  }

  #apply(commit, flash) {
    const c = commit.c;
    for (let k = 0; k < c.length; k += 3) {
      const i = c[k];
      this.target[i] = Math.max(0, this.target[i] + c[k + 1] - c[k + 2]);
      if (flash) {
        const sign = c[k + 1] >= c[k + 2] ? 1 : -1;
        this.city.heat[i] = Math.max(-2.2, Math.min(2.2, this.city.heat[i] + sign * 1.4));
      }
    }
  }
}
