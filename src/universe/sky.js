import * as THREE from 'three';

// The star map, shared by every view: a small version first so the sky is there at once, then the
// full 4K map for every sky at once (one copy on the GPU, however many views are open). The 4K map is a
// new texture rather than a bigger image in the old one: WebGL2 textures can't change size.
const skies = new Set();
let starmap = null;
function starmapTexture() {
  if (starmap) return starmap;
  starmap = new THREE.TextureLoader().load('universe/starmap_1k.webp', () => {
    new THREE.TextureLoader().load('universe/starmap_4k.webp', (full) => {
      full.colorSpace = THREE.SRGBColorSpace;
      const small = starmap;
      starmap = full;
      for (const m of skies) m.map = full;
      small.dispose();
    });
  });
  starmap.colorSpace = THREE.SRGBColorSpace;
  return starmap;
}

// The backdrop: 1.7 billion real stars (NASA SVS Deep Star Maps 2020, Gaia DR2: ESA/Gaia/DPAC),
// on a sphere that follows the camera, plus a sun with a soft glare.
export class Sky {
  constructor(scene, { brightness = 0.55 } = {}) {
    const texture = starmapTexture();
    this.stars = new THREE.Mesh(
      new THREE.SphereGeometry(9000, 64, 32),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false, color: new THREE.Color(brightness, brightness, brightness) })
    );
    skies.add(this.stars.material);
    this.stars.renderOrder = -10;
    this.stars.rotation.set(0.4, 2.2, 0.1);
    scene.add(this.stars);

    this.sun = new THREE.Group();
    const glow = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.08, 'rgba(255,246,228,1)'],
      [0.22, 'rgba(255,214,160,0.35)'],
      [1, 'rgba(255,190,120,0)'],
    ]);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(6, 5.6, 5) }));
    core.scale.setScalar(700);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(0.5, 0.42, 0.34), opacity: 0.6 }));
    halo.scale.setScalar(2600);
    this.sun.add(core, halo);
    scene.add(this.sun);
  }

  update(camera, sunDir) {
    this.stars.position.copy(camera.position);
    this.sun.position.copy(camera.position).addScaledVector(sunDir, 7000);
  }
}

export function radialTexture(stops, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
