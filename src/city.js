import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createBuildingMaterial, createPlateMaterial, FLOOR_HEIGHT } from './materials.js';
import { Beams } from './beams.js';

export const PLATE = 0.18; // height of one district level
export const RUIN_HEIGHT = 0.08;
export const heightOf = (loc) => (loc > 0 ? 0.4 + Math.pow(loc, 0.55) * 0.6 : 0);

// Lines map onto floors bottom-up: the code view lights up the floors holding the lines on screen.
const FIRST_FLOOR = 0.45;
const floorAt = (fraction, loc) => FIRST_FLOOR + fraction * Math.max(heightOf(loc) - FIRST_FLOOR - 0.7, 0.5);

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};
const topDistrict = (p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '');
export const districtHue = (p) => {
  const top = topDistrict(p);
  return top ? hash(top) : 0.58;
};

const boxPart = (w, h, d, y0) => new THREE.BoxGeometry(w, h, d).translate(0, y0 + h / 2, 0);

// Unit shapes (footprint -0.5..0.5, height 0..1); instances scale them to their lot and height.
const SHAPES = {
  block: () => boxPart(1, 1, 1, 0),
  tower: () => mergeGeometries([boxPart(1, 0.64, 1, 0), boxPart(0.78, 0.22, 0.78, 0.64), boxPart(0.56, 0.14, 0.56, 0.86)]),
};

// Every building is an instance: blocks and setback towers are two InstancedMeshes (one draw call each).
export class City {
  constructor(data, uniforms) {
    this.data = data;
    this.files = data.files;
    this.uniforms = uniforms;
    const n = this.files.length;
    this.group = new THREE.Group();

    this.loc = new Float32Array(n); // lines currently shown per building
    this.heat = new Float32Array(n);
    this.baseHeat = new Float32Array(n);
    this.lastTouch = new Float64Array(n); // unix time of the last commit touching the file, so far
    this.start = data.commits[0]?.t ?? 0;
    this.end = data.commits.at(-1)?.t ?? 0;
    this.now = this.end;
    this.halfLife = Math.max(45 * 86400, (this.end - this.start) * 0.1);
    this.showRuins = true;
    this.ruinMode = true;
    this.fileLevel = this.files.map((f) => f.p.split('/').length - 1);

    const maxCommits = Math.max(1, ...this.files.map((f) => (f.alive ? f.c : 0)));
    this.files.forEach((f, i) => {
      const churn = f.alive ? Math.log1p(f.c) / Math.log1p(maxCommits) : 0;
      this.baseHeat[i] = churn > 0.6 ? Math.pow((churn - 0.6) / 0.4, 1.5) * 0.9 : 0;
    });

    this.material = createBuildingMaterial(uniforms);
    this.group.add(this.#buildDistricts(data.districts));

    // Slender, tall files become setback towers; everything else is a block.
    const kind = this.files.map((f) => {
      const h = heightOf(f.peak);
      return h >= 14 && h / Math.max(f.w, f.d) >= 1.7 ? 'tower' : 'block';
    });
    this.layerOf = new Uint8Array(n);
    this.slot = new Int32Array(n);
    this.layers = ['block', 'tower']
      .map((k) => this.#buildLayer(k, this.files.map((_, i) => i).filter((i) => kind[i] === k)))
      .filter(Boolean);
    this.layers.forEach((L, li) => L.ids.forEach((i, k) => ((this.layerOf[i] = li), (this.slot[i] = k))));
    for (const L of this.layers) this.group.add(L.mesh);
    this.pickables = this.layers.map((L) => L.mesh);

    this.#buildBeacons();
    this.beams = new Beams();
    this.group.add(this.beams.mesh);
    this.labels = this.#buildLabels();
    this.group.add(this.labels);

    this.showFinal();
  }

  #buildDistricts(districts) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const depth = new Float32Array(Math.max(districts.length, 1));
    districts.forEach((d, i) => (depth[i] = d.depth));
    geo.setAttribute('aDepth', new THREE.InstancedBufferAttribute(depth, 1));
    const mesh = new THREE.InstancedMesh(geo, createPlateMaterial(), Math.max(districts.length, 1));
    mesh.count = districts.length;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    districts.forEach((d, i) => {
      m.makeScale(d.w, PLATE, d.d);
      m.setPosition(d.x + d.w / 2, (d.depth - 1) * PLATE, d.z + d.d / 2);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.setHSL(districtHue(d.p), 0.95, 0.5));
    });
    mesh.receiveShadow = true;
    return mesh;
  }

  #buildLayer(kind, ids) {
    if (!ids.length) return null;
    const count = ids.length;
    const geo = SHAPES[kind]();
    const attrs = {};
    for (const name of ['aHeat', 'aLit', 'aSeed', 'aRuin', 'aId']) {
      attrs[name] = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
      attrs[name].setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attrs[name]);
    }
    const mesh = new THREE.InstancedMesh(geo, this.material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.ids = ids;
    const color = new THREE.Color();
    ids.forEach((i, k) => {
      const f = this.files[i];
      attrs.aSeed.array[k] = hash(f.p);
      attrs.aId.array[k] = i;
      mesh.setColorAt(k, color.setHSL(districtHue(f.p), topDistrict(f.p) ? 0.95 : 0.35, 0.5));
    });
    return { mesh, ids: Int32Array.from(ids), attrs };
  }

  // The tallest standing towers get a spire with a blinking red aircraft light.
  #buildBeacons() {
    const alive = this.files.map((f, i) => i).filter((i) => this.files[i].alive);
    alive.sort((a, b) => this.files[b].loc - this.files[a].loc);
    this.beaconIds = alive.slice(0, Math.max(3, Math.round(alive.length * 0.02))).filter((i) => heightOf(this.files[i].loc) > 12);
    const n = Math.max(this.beaconIds.length, 1);
    this.spires = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.05, 0.14, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 0.4, metalness: 0.8 }),
      n
    );
    this.lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.25, 0.2) }), n);
    for (const mesh of [this.spires, this.lamps]) {
      mesh.count = this.beaconIds.length;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  #updateBeacons() {
    const m = new THREE.Matrix4();
    this.beaconIds.forEach((i, k) => {
      const f = this.files[i];
      const h = heightOf(this.loc[i]);
      const len = h > 0 ? 1.5 + h * 0.12 : 0;
      const x = f.x + f.w / 2;
      const z = f.z + f.d / 2;
      const y = this.fileLevel[i] * PLATE + h;
      m.makeScale(1, Math.max(len, 1e-4), 1).setPosition(x, y, z);
      this.spires.setMatrixAt(k, m);
      m.makeScale(h > 0 ? 1 : 0, h > 0 ? 1 : 0, h > 0 ? 1 : 0).setPosition(x, y + len, z);
      this.lamps.setMatrixAt(k, m);
    });
    this.spires.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
  }

  // Names of the biggest top-level districts, floating over them.
  #buildLabels() {
    const group = new THREE.Group();
    const counts = new Map();
    for (const f of this.files) if (f.alive) counts.set(topDistrict(f.p), (counts.get(topDistrict(f.p)) ?? 0) + 1);
    const area = this.data.size * this.data.size;
    this.data.districts
      .filter((d) => d.depth === 1 && d.w * d.d >= area * 0.012)
      .sort((a, b) => b.w * b.d - a.w * a.d)
      .slice(0, 14)
      .forEach((d) => {
        const el = document.createElement('div');
        el.className = 'district-label';
        const hue = Math.round(districtHue(d.p) * 360);
        el.style.setProperty('--hue', hue);
        const n = counts.get(d.p) ?? 0;
        el.innerHTML = `${d.p}<small>${n ? `${n} files` : 'demolished'}</small>`;
        const label = new CSS2DObject(el);
        label.position.set(d.x + d.w / 2, 1.5, d.z + d.d / 2);
        label.center.set(0.5, 1);
        group.add(label);
      });
    return group;
  }

  // Static view of HEAD: standing buildings at full size, ruins where deleted files stood.
  showFinal() {
    this.files.forEach((f, i) => {
      this.loc[i] = f.loc;
      this.lastTouch[i] = f.last;
    });
    this.now = this.end;
    this.heat.set(this.baseHeat);
    this.ruinMode = true;
    this.beams.clear();
    this.update();
  }

  // Blank lots, ready for the timelapse to build on.
  showEmpty() {
    this.loc.fill(0);
    this.heat.fill(0);
    this.lastTouch.fill(0);
    this.now = this.start;
    this.ruinMode = false;
    this.beams.clear();
    this.update();
  }

  // A commit touched building i: flash it and fire a beam from its roof.
  touch(i, added, deleted) {
    const sign = added >= deleted ? 1 : -1;
    this.heat[i] = Math.max(-2.2, Math.min(2.2, this.heat[i] + sign * 1.4));
    const f = this.files[i];
    const size = added + deleted;
    if (size < 1) return;
    const top = this.fileLevel[i] * PLATE + Math.max(heightOf(this.loc[i]), RUIN_HEIGHT);
    this.beams.spawn(f.x + f.w / 2, top, f.z + f.d / 2, Math.min(f.w, f.d) * 0.28 + 0.15, 5 + Math.log2(1 + size) * 6, sign);
  }

  setHeat(i, value) {
    this.heat[i] = value;
    const L = this.layers[this.layerOf[i]];
    L.attrs.aHeat.array[this.slot[i]] = value;
    L.attrs.aHeat.needsUpdate = true;
  }

  // Push heights, heat and lights to the GPU. Cheap enough per frame for ~50k buildings;
  // see docs/ARCHITECTURE.md for the sparse, GPU-eased version needed at Linux scale.
  update() {
    const m = new THREE.Matrix4();
    for (const { mesh, ids, attrs } of this.layers) {
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        const f = this.files[i];
        let h = heightOf(this.loc[i]);
        let ruin = 0;
        if (h === 0 && this.ruinMode && this.showRuins && !f.alive) {
          h = RUIN_HEIGHT;
          ruin = 1;
        }
        const s = h > 0 ? 1 : 0;
        m.makeScale(f.w * s, Math.max(h, 1e-4), f.d * s);
        m.setPosition(f.x + f.w / 2, this.fileLevel[i] * PLATE, f.z + f.d / 2);
        mesh.setMatrixAt(k, m);
        attrs.aHeat.array[k] = this.heat[i];
        const last = this.lastTouch[i];
        attrs.aLit.array[k] = last > 0 && !ruin ? 0.03 + 0.55 * Math.exp(-Math.max(0, this.now - last) / this.halfLife) : 0;
        attrs.aRuin.array[k] = ruin;
      }
      mesh.instanceMatrix.needsUpdate = true;
      for (const a of Object.values(attrs)) a.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
    }
    this.#updateBeacons();
  }

  tick(dt, time) {
    this.beams.tick(dt);
    this.lamps.visible = time % 1.6 < 0.25;
  }

  // Which building is under a raycast hit.
  buildingAt(hit) {
    return hit ? hit.object.userData.ids[hit.instanceId] : -1;
  }

  // World-space focus point of a file or district path, used for fly-to.
  boundsOf(path) {
    const i = this.files.findIndex((f) => f.p === path);
    if (i >= 0) {
      const f = this.files[i];
      const h = Math.max(heightOf(this.loc[i]), RUIN_HEIGHT);
      const y0 = this.fileLevel[i] * PLATE;
      return { index: i, center: { x: f.x + f.w / 2, y: y0 + h / 2, z: f.z + f.d / 2 }, radius: Math.max(f.w, f.d, h) };
    }
    const d = this.data.districts.find((d) => d.p === path);
    if (!d) return null;
    return { index: -1, center: { x: d.x + d.w / 2, y: d.depth * PLATE, z: d.z + d.d / 2 }, radius: Math.max(d.w, d.d) * 0.7 };
  }

  // Floor band (height above the building's base) holding the given fraction range of its lines.
  bandOf(i, fromFraction, toFraction) {
    const loc = this.files[i].loc;
    return [floorAt(fromFraction, loc) - FLOOR_HEIGHT * 0.15, floorAt(toFraction, loc) + FLOOR_HEIGHT * 0.35];
  }

  baseOf(i) {
    return this.fileLevel[i] * PLATE;
  }
}
