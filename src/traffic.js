import * as THREE from 'three';
import { PLATE } from './city.js';
import { rng, hashString } from './universe/lore.js';

// Night traffic. Every district has a street: the ring between its edge and what stands inside it
// (ingest/layout.mjs pads each district). Cars circle those rings, headlights one way and tail lights
// the other, each drawn as a short streak. All motion happens in the vertex shader, so thousands of
// cars cost one draw call. A busy city (many files touched lately) has more traffic than a quiet one.

const TRAIL = 4; // points per car: the light and its fading streak

const VERTEX = /* glsl */ `
  attribute vec4 aLoop; // x, z, width, depth of the street loop
  attribute vec4 aCar; // phase 0..1, speed (units/s), direction (+1 / -1), point along the streak (0 = the light)
  attribute vec3 aColor;
  attribute float aY;
  uniform float uTime;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    float w = aLoop.z;
    float d = aLoop.w;
    float per = 2.0 * (w + d);
    float s = mod(aCar.x * per + aCar.z * (aCar.y * uTime - aCar.w * 0.35), per);
    vec2 p;
    if (s < w) p = vec2(aLoop.x + s, aLoop.y);
    else if (s < w + d) p = vec2(aLoop.x + w, aLoop.y + s - w);
    else if (s < 2.0 * w + d) p = vec2(aLoop.x + w - (s - w - d), aLoop.y + d);
    else p = vec2(aLoop.x, aLoop.y + d - (s - 2.0 * w - d));
    vec4 mv = modelViewMatrix * vec4(p.x, aY, p.y, 1.0);
    float k = aCar.w / ${TRAIL.toFixed(1)};
    vColor = aColor * (1.0 - k) * (1.0 - k);
    gl_PointSize = clamp((1.0 - k * 0.5) * uScale / -mv.z, 1.0, 10.0);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d = dot(q, q);
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * exp(-d * 2.5), 1.0);
  }`;

export class Traffic {
  constructor(city) {
    const { districts, files } = city.data;
    const rand = rng(hashString(`${city.data.repo.name}:traffic`));
    // how busy the city is: the share of its buildings touched in the last stretch of its history
    const now = city.end || Date.now() / 1000;
    const recent = files.filter((f) => f.alive && f.last && now - f.last < city.halfLife).length / Math.max(1, files.filter((f) => f.alive).length);
    const busy = 0.35 + Math.min(1, recent * 2.5) * 0.65;

    const loops = [];
    for (const d of districts) {
      const pad = Math.min(Math.min(d.w, d.d) * 0.06, 4 / d.depth);
      if (pad < 0.15 || d.w < 2 || d.d < 2) continue;
      loops.push({ x: d.x + pad / 2, z: d.z + pad / 2, w: d.w - pad, d: d.d - pad, y: d.depth * PLATE + 0.04, lane: pad * 0.14 });
    }
    const cars = [];
    for (const l of loops) {
      const per = 2 * (l.w + l.d);
      const n = Math.max(1, Math.min(48, Math.round((per / 7) * busy)));
      for (let k = 0; k < n; k++) cars.push({ l, phase: rand(), dir: rand() < 0.5 ? 1 : -1, speed: 2.4 + rand() * 2.2 });
    }
    // a cap, keeping cars spread over the whole city
    while (cars.length > 2600) cars.splice(Math.floor(rand() * cars.length), 1);

    const n = cars.length * TRAIL;
    const loop = new Float32Array(n * 4);
    const car = new Float32Array(n * 4);
    const color = new Float32Array(n * 3);
    const y = new Float32Array(n);
    cars.forEach((c, i) => {
      // the two directions keep to their own lanes, on either side of the street's centre line
      const lane = c.dir > 0 ? -c.l.lane : c.l.lane;
      const head = c.dir > 0 ? [2.3, 2.05, 1.6] : [2.5, 0.26, 0.16];
      for (let t = 0; t < TRAIL; t++) {
        const k = i * TRAIL + t;
        loop.set([c.l.x + lane, c.l.z + lane, c.l.w - 2 * lane, c.l.d - 2 * lane], k * 4);
        car.set([c.phase, c.speed, c.dir, t], k * 4);
        color.set(head, k * 3);
        y[k] = c.l.y;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // computed in the shader
    geo.setAttribute('aLoop', new THREE.BufferAttribute(loop, 4));
    geo.setAttribute('aCar', new THREE.BufferAttribute(car, 4));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aY', new THREE.BufferAttribute(y, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), city.data.size); // positions live in the shader
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 400 } };
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.points.frustumCulled = false;
    this.count = cars.length;
  }

  update(time) {
    this.uniforms.uTime.value = time;
    this.uniforms.uScale.value = innerHeight * 0.5;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
