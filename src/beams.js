import * as THREE from 'three';
import { createBeamMaterial } from './materials.js';

// A ring buffer of light columns: every commit in the timelapse fires a beam from the roof of each
// file it touches. Height grows with the size of the change; warm for growth, red for deletion.
export class Beams {
  constructor(max = 512) {
    this.max = max;
    this.next = 0;
    this.life = new Float32Array(max);
    this.params = new Float32Array(max * 5); // x, y, z, radius, height
    this.beam = new Float32Array(max * 2); // intensity, sign

    const geo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    geo.translate(0, 0.5, 0);
    this.attr = new THREE.InstancedBufferAttribute(this.beam, 2);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBeam', this.attr);

    this.mesh = new THREE.InstancedMesh(geo, createBeamMaterial(), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.active = 0;
  }

  spawn(x, y, z, radius, height, sign) {
    const k = this.next;
    this.next = (this.next + 1) % this.max;
    this.life[k] = 1;
    this.params.set([x, y, z, radius, height], k * 5);
    this.beam[k * 2 + 1] = sign;
    this.active = Math.max(this.active, k + 1);
  }

  clear() {
    this.life.fill(0);
    this.active = 0;
    this.mesh.count = 0;
  }

  tick(dt) {
    if (!this.active) return;
    const m = new THREE.Matrix4();
    let alive = 0;
    for (let k = 0; k < this.active; k++) {
      const l = (this.life[k] = Math.max(0, this.life[k] - dt / 1.1));
      const [x, y, z, r, h] = this.params.subarray(k * 5, k * 5 + 5);
      // rises fast, fades slowly
      const grow = Math.min(1, (1 - l) * 6);
      m.makeScale(r * (0.6 + 0.4 * l), h * (0.25 + 0.75 * grow), r * (0.6 + 0.4 * l));
      m.setPosition(x, y, z);
      this.mesh.setMatrixAt(k, m);
      this.beam[k * 2] = l * l;
      if (l > 0) alive++;
    }
    this.mesh.count = this.active;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
    if (!alive) this.clear();
  }
}
