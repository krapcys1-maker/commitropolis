import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PLATE, heightOf } from './city.js';
import { radialTexture } from './universe/sky.js';

// Real events replayed in the timelapse (docs/LORE.md):
//   a release tag    -> a rocket lifts off the tallest building, its version painted on it
//   a huge deletion  -> an asteroid strikes the district it emptied: flash, shockwave, camera shake
export class CityEvents {
  constructor(city, { caption, shake }) {
    this.city = city;
    this.caption = caption;
    this.shake = shake;
    this.group = new THREE.Group();
    city.group.add(this.group);
    const ev = city.data.events ?? {};
    this.tags = (ev.tags ?? []).slice().sort((a, b) => a[1] - b[1]);
    this.impacts = new Map((ev.impacts ?? []).map((x) => [x.i, x]));
    this.nextTag = 0;
    this.effects = [];
    this.glow = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,220,170,0.6)'],
      [1, 'rgba(255,160,80,0)'],
    ]);
  }

  // After a seek: the next tag to launch is the first one after the city's current moment.
  reset(time) {
    this.nextTag = this.tags.findIndex(([, t]) => t > time);
    if (this.nextTag < 0) this.nextTag = this.tags.length;
    this.clear();
  }

  clear() {
    for (const e of this.effects) e.dispose();
    this.effects = [];
  }

  onCommit(index, commit) {
    let launched = null;
    while (this.nextTag < this.tags.length && this.tags[this.nextTag][1] <= commit.t) launched = this.tags[this.nextTag++];
    if (launched && this.effects.filter((e) => e.kind === 'rocket').length < 3) this.#launch(launched[0]);
    const impact = this.impacts.get(index);
    if (impact) this.#impact(impact, commit);
  }

  #tallest() {
    let best = 0;
    for (let i = 1; i < this.city.files.length; i++) if (this.city.loc[i] > this.city.loc[best]) best = i;
    const f = this.city.files[best];
    return new THREE.Vector3(f.x + f.w / 2, this.city.fileLevel[best] * PLATE + heightOf(this.city.loc[best]), f.z + f.d / 2);
  }

  #launch(tag) {
    const start = this.#tallest();
    const size = this.city.data.size;
    const rocket = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 2.0) }));
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color(3, 1.6, 0.6), blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.scale.setScalar(7);
    const trailGeo = new THREE.BufferGeometry();
    const points = new Float32Array(60 * 3);
    trailGeo.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(2.6, 1.5, 0.6), transparent: true, opacity: 0.9 }));
    const el = document.createElement('div');
    el.className = 'rocket-label';
    el.textContent = tag;
    const label = new CSS2DObject(el);
    label.position.set(3, 2, 0);
    rocket.add(label);
    this.group.add(rocket, flame, trail);
    const drift = new THREE.Vector3((Math.random() - 0.5) * 0.3, 1, (Math.random() - 0.5) * 0.3).normalize();
    const history = [];
    let t = 0;
    this.caption(`🚀 Release ${tag}`);
    this.effects.push({
      kind: 'rocket',
      update: (dt) => {
        t += dt;
        const climb = t * t * size * 0.09;
        const pos = start.clone().addScaledVector(drift, climb + 2);
        rocket.position.copy(pos);
        flame.position.copy(pos).addScaledVector(drift, -2.5);
        flame.material.opacity = 0.7 + Math.random() * 0.3;
        history.unshift(pos.clone());
        history.length = Math.min(history.length, 60);
        for (let i = 0; i < 60; i++) {
          const p = history[Math.min(i, history.length - 1)];
          points.set([p.x, p.y, p.z], i * 3);
        }
        trailGeo.attributes.position.needsUpdate = true;
        trail.material.opacity = Math.max(0, 0.9 - t * 0.15);
        return t < 5.5;
      },
      dispose: () => {
        this.group.remove(rocket, flame, trail);
        label.element.remove();
        rocket.geometry.dispose();
        trailGeo.dispose();
      },
    });
  }

  #impact(impact, commit) {
    // aim at the centre of the buildings the commit emptied
    const target = new THREE.Vector3();
    let n = 0;
    for (let k = 0; k < commit.c.length; k += 3) {
      if (commit.c[k + 2] <= commit.c[k + 1]) continue;
      const f = this.city.files[commit.c[k]];
      target.x += f.x + f.w / 2;
      target.z += f.z + f.d / 2;
      n++;
    }
    if (!n) return;
    target.divideScalar(n);
    const size = this.city.data.size;
    const from = target.clone().add(new THREE.Vector3(size * 0.6, size * 1.1, -size * 0.4));
    const streakGeo = new THREE.BufferGeometry().setFromPoints([from, from]);
    const streak = new THREE.Line(streakGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.2, 1.4), transparent: true }));
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color(3, 2.4, 1.6), blending: THREE.AdditiveBlending, depthWrite: false }));
    head.scale.setScalar(size * 0.05);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color(3, 1.4, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.5), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(target).setY(0.5);
    flash.position.copy(target).setY(4);
    this.group.add(streak, head, flash, ring);
    this.caption(`☄ Impact: “${impact.s}” (−${impact.deleted.toLocaleString('en-US')} lines)`);
    const fall = 0.9;
    let t = 0;
    let hit = false;
    this.effects.push({
      kind: 'impact',
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / fall);
        const pos = from.clone().lerp(target, k * k);
        head.position.copy(pos);
        const tail = from.clone().lerp(target, Math.max(0, k * k - 0.18));
        streakGeo.setFromPoints([tail, pos]);
        if (k >= 1 && !hit) {
          hit = true;
          head.visible = false;
          streak.visible = false;
          this.shake(size * 0.012, 0.7);
        }
        if (hit) {
          const e = t - fall;
          flash.material.opacity = Math.max(0, 1 - e * 1.4);
          flash.scale.setScalar(size * (0.08 + e * 0.35));
          ring.material.opacity = Math.max(0, 0.9 - e * 0.7);
          ring.scale.setScalar(size * (0.02 + e * 0.28));
        }
        return t < fall + 1.4;
      },
      dispose: () => {
        this.group.remove(streak, head, flash, ring);
        streakGeo.dispose();
        ring.geometry.dispose();
      },
    });
  }

  update(dt) {
    this.effects = this.effects.filter((e) => {
      if (e.update(dt)) return true;
      e.dispose();
      return false;
    });
  }
}
