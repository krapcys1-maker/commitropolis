import * as THREE from 'three';

export const PLATE = 0.18; // height of one district level
export const RUIN_HEIGHT = 0.08;
export const heightOf = (loc) => (loc > 0 ? 0.4 + Math.pow(loc, 0.55) * 0.6 : 0);

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};
const topDistrict = (p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '');

// All buildings are ONE InstancedMesh (one draw call), which keeps 50k+ files smooth.
// Glow is a per-instance "heat" attribute added to the emissive term, then picked up by bloom:
// positive heat = growth/churn (warm), negative heat = demolition (red).
export class City {
  constructor(data) {
    this.data = data;
    this.files = data.files;
    const n = this.files.length;
    this.group = new THREE.Group();

    this.loc = new Float32Array(n); // lines currently shown per building
    this.heat = new Float32Array(n);
    this.baseHeat = new Float32Array(n);
    this.showRuins = true; // demolished files as rubble in the static view
    this.fileLevel = this.files.map((f) => f.p.split('/').length - 1);

    const maxCommits = Math.max(1, ...this.files.map((f) => (f.alive ? f.c : 0)));
    this.files.forEach((f, i) => {
      const churn = f.alive ? Math.log1p(f.c) / Math.log1p(maxCommits) : 0;
      this.baseHeat[i] = churn > 0.55 ? Math.pow((churn - 0.55) / 0.45, 1.5) * 1.1 : 0;
    });

    this.group.add(this.#buildDistricts(data.districts));
    this.buildings = this.#buildBuildings();
    this.group.add(this.buildings);
    this.showFinal();
  }

  #buildDistricts(districts) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(districts.length, 1));
    mesh.count = districts.length;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    districts.forEach((d, i) => {
      m.makeScale(d.w, PLATE, d.d);
      m.setPosition(d.x + d.w / 2, (d.depth - 1) * PLATE, d.z + d.d / 2);
      mesh.setMatrixAt(i, m);
      color.setHSL(0.62, 0.12, 0.07 + Math.min(d.depth, 6) * 0.025);
      mesh.setColorAt(i, color);
    });
    mesh.receiveShadow = true;
    return mesh;
  }

  #buildBuildings() {
    const n = this.files.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    this.heatAttr = new THREE.InstancedBufferAttribute(this.heat, 1);
    this.heatAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aHeat', this.heatAttr);

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.15 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHeat;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float heatAbs = abs(vHeat);
          vec3 warm = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.9, 0.6), clamp(heatAbs - 1.0, 0.0, 1.0));
          vec3 glow = vHeat >= 0.0 ? warm : vec3(1.0, 0.12, 0.2);
          totalEmissiveRadiance += glow * heatAbs;`
        );
    };

    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ruins=true paints demolished files grey (static view); false gives them their district colour.
  #paint(ruins) {
    const color = new THREE.Color();
    this.files.forEach((f, i) => {
      if (ruins && !f.alive) {
        color.setHSL(0.6, 0.05, 0.16);
      } else {
        const top = topDistrict(f.p);
        color.setHSL(top ? hash(top) : 0.58, top ? 0.45 : 0.1, 0.42 + hash(f.p) * 0.12);
      }
      this.buildings.setColorAt(i, color);
    });
    this.buildings.instanceColor.needsUpdate = true;
  }

  // Static view of HEAD: standing buildings at full size, ruins where deleted files stood.
  showFinal() {
    this.files.forEach((f, i) => (this.loc[i] = f.loc));
    this.heat.set(this.baseHeat);
    this.ruinMode = true;
    this.#paint(true);
    this.update();
  }

  // Blank lot, ready for the timelapse to build on.
  showEmpty() {
    this.loc.fill(0);
    this.heat.fill(0);
    this.ruinMode = false;
    this.#paint(false);
    this.update();
  }

  // Push loc/heat arrays to the GPU. Cheap enough to call every frame for ~50k buildings;
  // see docs/ARCHITECTURE.md for the sparse, GPU-eased version needed at Linux scale.
  update() {
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.files.length; i++) {
      const f = this.files[i];
      let h = heightOf(this.loc[i]);
      if (h === 0 && this.ruinMode && this.showRuins && !f.alive) h = RUIN_HEIGHT;
      const s = h > 0 ? 1 : 0;
      m.makeScale(f.w * s, Math.max(h, 1e-4), f.d * s);
      m.setPosition(f.x + f.w / 2, this.fileLevel[i] * PLATE, f.z + f.d / 2);
      this.buildings.setMatrixAt(i, m);
    }
    this.buildings.instanceMatrix.needsUpdate = true;
    this.heatAttr.needsUpdate = true;
    this.buildings.computeBoundingSphere();
    this.buildings.computeBoundingBox();
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
}
