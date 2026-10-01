import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky, radialTexture } from './sky.js';
import { NOISE } from './glsl.js';
import { SECTORS, levelOf, langColor, worldStyle, hashString } from './lore.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ORBITS = [140, 200, 265, 335, 410, 490, 575, 665];

// A small world as seen from across its star system: noise continents in its language style,
// lit by the star, with a thin atmosphere rim and night lights for developed worlds.
export function worldMaterial(account, sunPos) {
  const style = worldStyle(account.lang);
  const level = levelOf(account.s).level;
  const seed = hashString(account.l);
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunPos },
      uSeed: { value: new THREE.Vector3(seed * 50, seed * 31, seed * 17) },
      uSea: { value: style.sea },
      uDeep: { value: new THREE.Color(style.ocean[0]) },
      uShallow: { value: new THREE.Color(style.ocean[1]) },
      uLow: { value: new THREE.Color(style.land[1]) },
      uHigh: { value: new THREE.Color(style.land[2]) },
      uAtmo: { value: new THREE.Color(langColor(account.lang)) },
      uLights: { value: Math.min(1, level / 6) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vDir = normalize(position);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec3 uSun, uSeed, uDeep, uShallow, uLow, uHigh, uAtmo;
      uniform float uSea, uLights;
      varying vec3 vDir;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        float h = fbm(vDir * 1.4 + uSeed, 5) - uSea;
        vec3 col = h < 0.0 ? mix(uShallow, uDeep, smoothstep(0.0, -0.25, h)) : mix(uLow, uHigh, smoothstep(0.0, 0.25, h));
        col = mix(col, vec3(0.95), smoothstep(0.8, 0.9, abs(vDir.y)));
        vec3 L = normalize(uSun - vWorld);
        vec3 V = normalize(cameraPosition - vWorld);
        float d = max(dot(vNormal, L), 0.0);
        float night = smoothstep(0.1, -0.2, dot(vNormal, L));
        float lights = step(0.0, h) * step(0.62, hash13(floor(vDir * 180.0))) * uLights * night;
        float rim = pow(1.0 - max(dot(vNormal, V), 0.0), 3.0);
        vec3 c = col * (d * 1.2 + 0.02) + vec3(1.0, 0.7, 0.4) * lights * 1.4 + uAtmo * rim * (0.25 + d * 0.9);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export class SystemView {
  constructor(ctx, galaxy) {
    this.ctx = ctx;
    this.galaxy = galaxy;
    this.scene = new THREE.Scene();
    this.sky = new Sky(this.scene, { brightness: 0.4 });
    this.group = null;
    this.flying = null;
  }

  async enter(login, fallback) {
    const { camera, controls, ui } = this.ctx;
    await this.galaxy.load();
    const members = this.galaxy.neighboursOf(login, 7, fallback);
    const home = members[0];
    const sector = SECTORS[home.sector] ?? SECTORS.arm;
    this.members = members;
    this.home = home;
    this.catalog = `CV-${String(Math.floor(hashString(home.l) * 99991)).padStart(5, '0')}`;

    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose?.();
        o.element?.remove();
      });
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // the star
    const sunColor = new THREE.Color(sector.color);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(38, 48, 24), new THREE.MeshBasicMaterial({ color: sunColor.clone().multiplyScalar(3.2) }));
    const glowTex = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.2, 'rgba(255,255,255,0.45)'],
      [0.5, 'rgba(255,255,255,0.08)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: sunColor.clone().multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(420);
    this.group.add(sun, glow);
    this.sunPos = new THREE.Vector3();

    // worlds on orbits: the visited world first, its galactic neighbours outward
    this.worlds = members.map((a, i) => {
      const radius = ORBITS[i];
      const size = 5 + Math.log10(1 + a.s) * 2.4;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 48, 24), worldMaterial(a, this.sunPos));
      const orbit = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.35, radius + 0.35, 256),
        new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffd28a : 0x7f8fb8, transparent: true, opacity: i === 0 ? 0.45 : 0.18, side: THREE.DoubleSide, depthWrite: false })
      );
      orbit.rotation.x = -Math.PI / 2;
      this.group.add(mesh, orbit);
      if (levelOf(a.s).level >= 5) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(size * 1.5, size * 1.7, 128),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.2, 0.9), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2 + 0.3;
        mesh.add(ring);
      }
      const el = document.createElement('button');
      el.className = `world-label ${i === 0 ? 'home' : ''}`;
      const lv = levelOf(a.s);
      el.innerHTML = `@${a.l}<small>L${lv.level} ${lv.name} · ${fmt(a.s)} ★</small>`;
      el.onclick = () => this.visit(a.l);
      const label = new CSS2DObject(el);
      label.position.set(0, size + 10, 0);
      mesh.add(label);
      return { account: a, mesh, radius, size, phase: hashString(`${a.l}:orbit`) * Math.PI * 2, speed: 0.06 / Math.sqrt(radius / 140) };
    });

    camera.near = 0.5;
    camera.far = 30000;
    camera.updateProjectionMatrix();
    controls.enabled = true;
    controls.minDistance = 60;
    controls.maxDistance = 2200;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.2;
    controls.target.set(0, 0, 0);
    camera.position.set(0, 520, 900);

    ui.card(this.#cardHtml(sector));
    ui.cardEl.querySelectorAll('[data-login]').forEach((el) => (el.onclick = () => this.visit(el.dataset.login)));
    ui.cardEl.querySelector('#to-galaxy').onclick = () => this.ctx.go({ sector: home.sector });
    ui.hint('A star system of neighbouring worlds · click a world to visit · scroll out to reach the galaxy');
    return { home, sector, catalog: this.catalog };
  }

  #cardHtml(sector) {
    const rows = this.members
      .map((a, i) => {
        const lv = levelOf(a.s);
        return `<li data-login="${a.l}"><span class="dot" style="background:${langColor(a.lang)}"></span><span class="cname">@${a.l}</span><span class="tier">L${lv.level} ${lv.name}</span><span class="stars">${fmt(a.s)} ★</span></li>`;
      })
      .join('');
    return `
      <div class="world-name">System ${this.catalog}</div>
      <p class="level-text">A star in <b style="color:${sector.color}">${sector.name}</b>. Its worlds are neighbours in the galaxy: accounts with the same language and era of GitHub.</p>
      <h4>Worlds of this system</h4>
      <ul class="cities">${rows}</ul>
      <p><button id="to-galaxy" class="chip world">↥ Out to the galaxy</button></p>`;
  }

  visit(login) {
    const w = this.worlds.find((x) => x.account.l === login);
    const { camera, controls } = this.ctx;
    const at = w ? w.mesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const dir = camera.position.clone().sub(at).normalize();
    this.flying = { t: 0, dur: 1.5, fromPos: camera.position.clone(), toPos: at.clone().addScaledVector(dir, (w?.size ?? 10) * 2.2), fromTarget: controls.target.clone(), toTarget: at, then: () => this.ctx.go({ planet: login }) };
    controls.autoRotate = false;
  }

  pointerMove() {}

  update(dt, time) {
    for (const w of this.worlds ?? []) {
      const a = w.phase + time * w.speed;
      w.mesh.position.set(Math.cos(a) * w.radius, 0, Math.sin(a) * w.radius);
      w.mesh.rotation.y += dt * 0.2;
    }
    this.sky.update(this.ctx.camera, new THREE.Vector3(0, 1, 0));
    const f = this.flying;
    if (f) {
      const { camera, controls, ui } = this.ctx;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
      camera.position.lerpVectors(f.fromPos, f.toPos, e);
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      camera.lookAt(controls.target);
      ui.fade(Math.max(0, (f.t - 0.75) / 0.25));
      if (f.t >= 1) {
        const then = f.then;
        this.flying = null;
        then?.();
      }
    }
  }
}
