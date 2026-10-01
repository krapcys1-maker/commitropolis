import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { NOISE, TERRAIN, ATMOSPHERE } from './glsl.js';
import { levelOf, langColor, hashString, rng, cityTier, worldStyle } from './lore.js';

export const R = 100; // planet radius in world units
const MAX_CITIES = 64;
const MAX_ROADS = 96;
const CITY_LIGHT_COLOR = new THREE.Color(1.0, 0.72, 0.42);

function haloTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.1, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------- bakes

// Height (r) and cloud density (g) on the unit sphere, baked once into a cube map so the surface and
// cloud shaders only sample textures per frame.
function bakeCube(renderer, uniforms, size = 512) {
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${TERRAIN}
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = terrain(dir);
        vec3 q = dir * 2.2 + uSeed * 0.37;
        vec3 warp = vec3(fbm(q + 1.3, 3), fbm(q + 5.1, 3), fbm(q + 9.7, 3));
        float c = fbm(q * 1.6 + warp * 1.4, 6);
        float bands = 0.5 + 0.5 * sin(dir.y * 9.0 + c * 3.0);
        float clouds = smoothstep(0.16, 0.5, c + 0.1 * bands - 0.06);
        gl_FragColor = vec4(h, clouds, 0.0, 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material));
  const camera = new THREE.CubeCamera(0.1, 10, target);
  camera.update(renderer, scene);
  material.dispose();
  return target;
}

// Equirectangular height map read back to the CPU, for placing cities on land.
function bakeLandMask(renderer, uniforms, width = 1024, height = 512) {
  const target = new THREE.WebGLRenderTarget(width, height);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${TERRAIN}
      varying vec2 vUv;
      void main() {
        float lon = (vUv.x - 0.5) * 6.2831853;
        float lat = (vUv.y - 0.5) * 3.1415927;
        vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
        float h = terrain(dir);
        gl_FragColor = vec4(clamp(h * 0.5 + 0.5, 0.0, 1.0), 0.0, 0.0, 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  material.dispose();
  return {
    heightAt(dir) {
      const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      const lon = Math.atan2(dir.z, dir.x);
      const x = Math.min(width - 1, Math.max(0, Math.floor((lon / (Math.PI * 2) + 0.5) * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor((lat / Math.PI + 0.5) * height)));
      return (pixels[(y * width + x) * 4] / 255) * 2 - 1;
    },
  };
}

// ---------------------------------------------------------------- the planet

// A world: one GitHub account. Its repositories are cities on its continents; its total stars set its
// level of civilisation (docs/LORE.md).
export class Planet {
  constructor(renderer, data, cityIndex = new Set()) {
    this.data = data;
    this.group = new THREE.Group(); // spins: day and night
    this.frame = new THREE.Group(); // does not spin: atmosphere
    this.frame.add(this.group);
    this.stars = data.repos.reduce((s, r) => s + r.s, 0);
    this.level = levelOf(this.stars);

    const langStars = {};
    for (const r of data.repos) if (r.lang) langStars[r.lang] = (langStars[r.lang] ?? 0) + r.s;
    this.languages = Object.entries(langStars).sort((a, b) => b[1] - a[1]);
    this.mainLanguage = this.languages[0]?.[0] ?? 'Other';

    const seed = hashString(data.login);
    this.uniforms = {
      uSeed: { value: new THREE.Vector3(seed * 91.7, hashString(`${data.login}:y`) * 73.3, hashString(`${data.login}:z`) * 57.1) },
      uSea: { value: worldStyle(this.mainLanguage).sea },
      uSunDir: { value: new THREE.Vector3(1, 0.25, 0.4).normalize() },
      uTime: { value: 0 },
    };

    this.cube = bakeCube(renderer, this.uniforms);
    this.mask = bakeLandMask(renderer, this.uniforms);
    this.cities = this.#placeCities(cityIndex);

    this.#buildSurface();
    this.#buildClouds();
    this.#buildAtmosphere();
    this.#buildCivilisation();
    this.#buildAurora();
    this.#buildFleet();
  }

  // Fleets of contributor ships (Level 5 and up, docs/LORE.md): engine lights on inclined orbits,
  // each with a short trail. The orbits are computed in the vertex shader: one draw call for all.
  #buildFleet() {
    const lv = this.level.level;
    if (lv < 5) return;
    const ships = lv >= 7 ? 44 : lv >= 6 ? 28 : 16;
    const TRAIL = 7;
    const rand = rng(hashString(`${this.data.login}:fleet`));
    const n = ships * TRAIL;
    const orbit = new Float32Array(n * 4); // radius, eccentricity, phase, speed
    const tilt = new Float32Array(n * 3); // euler x, y, z of the orbit plane
    const trail = new Float32Array(n);
    for (let i = 0; i < ships; i++) {
      const o = [R * (1.25 + rand() * 1.3), rand() * 0.35, rand() * Math.PI * 2, (0.12 + rand() * 0.22) * (rand() < 0.5 ? 1 : -1)];
      const t = [(rand() - 0.5) * 2.2, rand() * Math.PI * 2, (rand() - 0.5) * 0.8];
      for (let k = 0; k < TRAIL; k++) {
        orbit.set(o, (i * TRAIL + k) * 4);
        tilt.set(t, (i * TRAIL + k) * 3);
        trail[i * TRAIL + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
    geo.setAttribute('aTilt', new THREE.BufferAttribute(tilt, 3));
    geo.setAttribute('aTrail', new THREE.BufferAttribute(trail, 1));
    const points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uTime: this.uniforms.uTime },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aOrbit;
          attribute vec3 aTilt;
          attribute float aTrail;
          uniform float uTime;
          varying float vFade;
          mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
          mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
          void main() {
            float th = aOrbit.z + aOrbit.w * uTime - sign(aOrbit.w) * aTrail * 0.018;
            float r = aOrbit.x * (1.0 - aOrbit.y * cos(th));
            vec3 p = rotY(aTilt.y) * rotX(aTilt.x) * rotZ(aTilt.z) * vec3(cos(th) * r, 0.0, sin(th) * r);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vFade = 1.0 - aTrail / ${TRAIL.toFixed(1)};
            gl_PointSize = clamp((aTrail < 0.5 ? 2.6 : 1.6) * 260.0 / -mv.z, 1.0, 7.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vFade;
          void main() {
            vec2 q = gl_PointCoord * 2.0 - 1.0;
            float d = dot(q, q);
            if (d > 1.0) discard;
            gl_FragColor = vec4(vec3(1.1, 1.6, 2.4) * vFade * vFade * exp(-d * 2.2), 1.0);
          }`,
      })
    );
    points.frustumCulled = false;
    this.frame.add(points);
  }

  // Aurorae over both poles, on the night side. They burn brightest on a world that shipped this week
  // and fade on one that has gone quiet: activity is the solar wind here.
  #buildAurora() {
    const lastPush = Math.max(0, ...this.data.repos.map((r) => r.p ?? 0));
    const days = (Date.now() / 1000 - lastPush) / 86400;
    const strength = days < 7 ? 1 : days < 30 ? 0.65 : days < 180 ? 0.3 : 0;
    if (!strength) return;
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uniforms.uTime, uSunDir: this.uniforms.uSunDir, uStrength: { value: strength } },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          float a = vUv.x * 6.2831853;
          float curtain = 0.5 + 0.5 * sin(a * 9.0 + uTime * 0.5 + 2.0 * sin(a * 3.0 - uTime * 0.31));
          curtain *= 0.55 + 0.45 * sin(a * 27.0 - uTime * 1.1 + sin(a * 5.0) * 3.0);
          float v = vUv.y;
          float body = smoothstep(0.0, 0.12, v) * pow(clamp(1.0 - v, 0.0, 1.0), 1.6); // clamped: a NaN here blooms over the whole frame
          vec3 col = mix(vec3(0.15, 1.7, 0.75), vec3(1.0, 0.3, 1.5), smoothstep(0.3, 1.0, v));
          float night = smoothstep(0.2, -0.3, dot(normalize(vWorld), normalize(uSunDir)));
          gl_FragColor = vec4(col * curtain * body * night * uStrength * 1.35, 1.0);
        }`,
    });
    for (const pole of [1, -1]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.31, R * 0.37, R * 0.17, 160, 1, true), material);
      ring.position.y = pole * R * 1.02;
      if (pole < 0) ring.rotation.x = Math.PI;
      this.group.add(ring);
    }
  }

  #palette() {
    const style = worldStyle(this.mainLanguage);
    const c = (hex) => new THREE.Color(hex);
    return {
      oceanDeep: c(style.ocean[0]),
      oceanShallow: c(style.ocean[1]),
      sand: c(style.land[0]),
      low: c(style.land[1]),
      high: c(style.land[2]),
      rock: c(style.land[3]),
      snow: c(style.kind === 'rust' ? '#e8d0c0' : '#eef3f7'),
      atmosphere: c(langColor(this.mainLanguage)),
    };
  }

  // Cities go on land, the biggest first, spaced by their size. Positions are deterministic.
  #placeCities(cityIndex) {
    const repos = this.data.repos.filter((r) => !r.a).slice(0, MAX_CITIES);
    const maxStars = Math.max(1, ...repos.map((r) => r.s));
    const placed = [];
    for (const repo of repos) {
      const rand = rng(hashString(`${this.data.login}/${repo.n}`));
      const size = 0.018 + 0.07 * (Math.log10(1 + repo.s) / Math.log10(1 + maxStars));
      let best = null;
      for (let attempt = 0; attempt < 400; attempt++) {
        const u = rand() * 2 - 1;
        const lon = rand() * Math.PI * 2;
        const lat = Math.asin(u) * 0.82; // keep cities out of the polar ice
        const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        const h = this.mask.heightAt(dir);
        if (h < 0.035) continue;
        const clear = placed.every((c) => c.dir.angleTo(dir) > (c.size + size) * 0.9);
        if (clear) {
          best = dir;
          break;
        }
        if (!best && attempt > 300) best = dir; // crowded world: accept overlap rather than drop the city
      }
      if (!best) continue;
      const slug = `${this.data.login}-${repo.n}`.toLowerCase();
      placed.push({
        repo,
        dir: best,
        size,
        tier: cityTier(repo.s),
        activity: Math.exp(-Math.max(0, Date.now() / 1000 - repo.p) / (180 * 86400)),
        slug: cityIndex.has(slug) ? slug : null,
      });
    }
    return placed;
  }

  #cityUniforms() {
    const dirs = [];
    const glow = [];
    for (let i = 0; i < MAX_CITIES; i++) {
      const c = this.cities[i];
      dirs.push(c ? new THREE.Vector4(c.dir.x, c.dir.y, c.dir.z, c.size) : new THREE.Vector4(0, 1, 0, 0));
      glow.push(c ? 0.35 + 0.65 * c.activity : 0);
    }
    // highways: each city to its two nearest neighbours, along great circles
    const pairs = new Set();
    this.cities.forEach((c, i) => {
      this.cities
        .map((o, j) => [j, c.dir.angleTo(o.dir)])
        .filter(([j, a]) => j !== i && a < 0.9)
        .sort((x, y) => x[1] - y[1])
        .slice(0, 2)
        .forEach(([j]) => pairs.add(i < j ? `${i}:${j}` : `${j}:${i}`));
    });
    const roadA = [];
    const roadB = [];
    for (const key of [...pairs].slice(0, MAX_ROADS)) {
      const [i, j] = key.split(':').map(Number);
      roadA.push(this.cities[i].dir.clone());
      roadB.push(this.cities[j].dir.clone());
    }
    const count = roadA.length;
    while (roadA.length < MAX_ROADS) {
      roadA.push(new THREE.Vector3(0, 1, 0));
      roadB.push(new THREE.Vector3(0, 1, 0));
    }
    return { uCities: { value: dirs }, uCityGlow: { value: glow }, uCityCount: { value: this.cities.length }, uRoadA: { value: roadA }, uRoadB: { value: roadB }, uRoadCount: { value: count } };
  }

  #buildSurface() {
    const p = this.#palette();
    const lv = this.level.level;
    Object.assign(this.uniforms, this.#cityUniforms(), {
      uHeight: { value: this.cube.texture },
      uOceanDeep: { value: p.oceanDeep },
      uOceanShallow: { value: p.oceanShallow },
      uSand: { value: p.sand },
      uLow: { value: p.low },
      uHigh: { value: p.high },
      uRock: { value: p.rock },
      uSnow: { value: p.snow },
      uLightColor: { value: CITY_LIGHT_COLOR },
      uSprawl: { value: 0.9 + lv * 0.12 }, // richer worlds light up more of their land
      uGlobal: { value: lv >= 6 ? 1 : 0 },
      uHighlight: { value: -1 },
      uRot: { value: new THREE.Matrix3() },
    });
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform samplerCube uHeight;
        varying vec3 vDir;
        varying vec3 vWorld;
        void main() {
          vec3 dir = normalize(position);
          float h = textureLod(uHeight, dir, 0.0).r;
          vec3 pos = dir * (1.0 + max(h, 0.0) * 0.028);
          vDir = dir;
          vec4 world = modelMatrix * vec4(pos * ${R.toFixed(1)}, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        uniform samplerCube uHeight;
        uniform vec3 uSunDir;
        uniform mat3 uRot;
        uniform vec3 uOceanDeep, uOceanShallow, uSand, uLow, uHigh, uRock, uSnow, uLightColor;
        uniform vec4 uCities[${MAX_CITIES}];
        uniform float uCityGlow[${MAX_CITIES}];
        uniform int uCityCount;
        uniform vec3 uRoadA[${MAX_ROADS}];
        uniform vec3 uRoadB[${MAX_ROADS}];
        uniform int uRoadCount;
        uniform float uSprawl;
        uniform float uGlobal;
        uniform float uHighlight;
        varying vec3 vDir;
        varying vec3 vWorld;

        // a thin bright line where a noise field crosses zero, anti-aliased: when it gets thinner than a
        // pixel it widens and dims, keeping its average brightness instead of sparkling
        float streak(float n, float k) {
          float w = fwidth(n);
          return (1.0 - smoothstep(0.0, k + w, abs(n))) * k / (k + w);
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = texture(uHeight, dir).r;

          // normal from the height field
          vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 t2 = cross(dir, t1);
          float e = 0.004;
          float hx = max(texture(uHeight, normalize(dir + t1 * e)).r, 0.0) - max(texture(uHeight, normalize(dir - t1 * e)).r, 0.0);
          float hy = max(texture(uHeight, normalize(dir + t2 * e)).r, 0.0) - max(texture(uHeight, normalize(dir - t2 * e)).r, 0.0);
          vec3 nLocal = normalize(dir - (t1 * hx + t2 * hy) * 3.2);
          vec3 n = normalize(uRot * nLocal);
          vec3 up = normalize(uRot * dir);
          vec3 L = normalize(uSunDir);
          vec3 V = normalize(cameraPosition - vWorld);

          // biomes: depth, elevation, latitude, a little texture noise
          float detail = snoise(dir * 38.0) * 0.5 + snoise(dir * 90.0) * 0.25;
          float lat = abs(dir.y);
          vec3 color;
          float ocean = step(h, 0.0);
          if (h < 0.0) {
            color = mix(uOceanShallow, uOceanDeep, smoothstep(0.0, -0.25, h));
          } else {
            color = mix(uSand, uLow, smoothstep(0.0, 0.035, h));
            color = mix(color, uHigh, smoothstep(0.08, 0.22, h + detail * 0.04));
            color = mix(color, uRock, smoothstep(0.22, 0.34, h));
            color *= 0.85 + detail * 0.25;
          }
          float ice = smoothstep(0.78, 0.86, lat + detail * 0.05) + smoothstep(0.34, 0.42, h) * step(0.0, h);
          color = mix(color, uSnow, clamp(ice, 0.0, 1.0));
          ocean *= 1.0 - clamp(ice, 0.0, 1.0);

          // cities: urban grey by day, lights by night; hovered city glows cyan
          float urban = 0.0;
          float lights = 0.0;
          float highlight = 0.0;
          for (int i = 0; i < ${MAX_CITIES}; i++) {
            if (i >= uCityCount) break;
            vec4 c = uCities[i];
            float ang = acos(clamp(dot(dir, c.xyz), -1.0, 1.0));
            float core = exp(-pow(ang / (c.w * 0.4), 2.0));
            float metro = exp(-pow(ang / (c.w * uSprawl), 2.0));
            urban = max(urban, core);
            lights += (core * 2.4 + metro * 0.2) * uCityGlow[i];
            if (float(i) == uHighlight) highlight = smoothstep(c.w * 1.25, c.w * 1.1, ang) * smoothstep(c.w * 0.95, c.w * 1.1, ang);
          }
          // highways along great circles between neighbouring cities
          float roads = 0.0;
          for (int i = 0; i < ${MAX_ROADS}; i++) {
            if (i >= uRoadCount) break;
            vec3 a = uRoadA[i];
            vec3 b = uRoadB[i];
            vec3 gn = normalize(cross(a, b));
            float d = abs(dot(dir, gn));
            float between = step(0.0, dot(cross(a, dir), gn)) * step(0.0, dot(cross(dir, b), gn));
            roads = max(roads, exp(-pow(d / 0.0035, 2.0)) * between);
          }
          // the texture of lights: a network of arteries and streets (brightest where they cross)
          // over a fine grain of lit blocks, so cities read like real ones from orbit at night
          float net = streak(snoise(dir * 23.0 + 11.0), 0.05) + streak(snoise(dir * 61.0 - 5.0), 0.045) * 0.75 + streak(snoise(dir * 150.0 + 3.0), 0.045) * 0.5;
          float grain = mix(step(0.6, hash13(floor(dir * 1600.0))), 0.4, clamp(length(fwidth(dir)) * 1600.0 - 0.5, 0.0, 1.0));
          float density = smoothstep(0.2, 0.8, snoise(dir * 7.0 + 3.0) * 0.5 + 0.5);
          lights = lights * (0.16 + net * 1.15 + grain * 0.3) + roads * 0.55;
          lights += uGlobal * mix(0.2, 1.0, density) * (net * 0.2 + grain * 0.035); // ecumenopolis: the whole land is city
          lights *= 1.0 - ocean;
          color = mix(color, vec3(0.34, 0.33, 0.32), urban * 0.55 * (1.0 - ocean));

          // lighting
          float ndl = dot(n, L);
          float sun = dot(up, L);
          float diffuse = max(ndl, 0.0);
          vec3 lit = color * (diffuse * vec3(1.0, 0.97, 0.92) * 1.25 + vec3(0.012, 0.016, 0.03));
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(up, H), 0.0), 420.0) * ocean * smoothstep(-0.05, 0.2, sun);
          float fres = pow(1.0 - max(dot(up, V), 0.0), 5.0) * ocean;
          lit += vec3(1.0, 0.92, 0.8) * spec * 0.55 + vec3(0.25, 0.4, 0.6) * fres * max(sun, 0.0) * 0.4;
          lit += vec3(0.9, 0.35, 0.12) * smoothstep(0.12, 0.0, abs(sun)) * 0.06; // warm terminator

          float night = smoothstep(0.08, -0.18, sun);
          vec3 emission = uLightColor * lights * night * 1.6;
          emission += vec3(0.3, 0.9, 1.0) * highlight * 2.0;
          gl_FragColor = vec4(lit + emission, 1.0);
        }`,
    });
    this.surface = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 80), material);
    this.group.add(this.surface);
  }

  #buildClouds() {
    this.cloudUniforms = {
      uHeight: { value: this.cube.texture },
      uSunDir: this.uniforms.uSunDir,
      uTime: this.uniforms.uTime,
    };
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: this.cloudUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        varying vec3 vUp;
        varying vec3 vWorld;
        void main() {
          vDir = normalize(position);
          vUp = normalize(mat3(modelMatrix) * vDir);
          vec4 w = modelMatrix * vec4(position * ${(R * 1.014).toFixed(2)}, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform samplerCube uHeight;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        varying vec3 vUp;
        varying vec3 vWorld;
        void main() {
          float d = texture(uHeight, vDir).g;
          float sun = dot(normalize(vUp), normalize(uSunDir));
          float light = smoothstep(-0.12, 0.35, sun);
          vec3 col = mix(vec3(0.01, 0.012, 0.02), vec3(0.78, 0.8, 0.84), light);
          col = mix(col, vec3(1.0, 0.55, 0.3) * 0.9, smoothstep(0.18, 0.0, abs(sun)) * 0.35);
          gl_FragColor = vec4(col, d * 0.78);
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 40), material);
    this.group.add(this.clouds);
  }

  #buildAtmosphere() {
    const tint = this.#palette().atmosphere;
    this.atmoUniforms = {
      uSunDir: this.uniforms.uSunDir,
      uCenter: { value: new THREE.Vector3() },
      uTint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
    };
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.atmoUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${ATMOSPHERE}
        uniform vec3 uSunDir;
        uniform vec3 uCenter;
        uniform vec3 uTint;
        varying vec3 vWorld;
        void main() {
          vec3 r0 = (cameraPosition - uCenter) / ${R.toFixed(1)};
          vec3 rd = normalize(vWorld - cameraPosition);
          vec3 col = atmosphere(rd, r0, uSunDir, 24.0, 1.0, 1.1, vec3(5.5, 13.0, 22.4), 21.0, 0.008, 0.0012, 0.758);
          col = 1.0 - exp(-col * 0.75);
          col *= mix(vec3(1.0), uTint * 1.6, 0.18);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.1, 96, 48), material);
    this.atmosphere.renderOrder = 5;
    this.frame.add(this.atmosphere);
  }

  // What a civilisation of this level has built around its world.
  #buildCivilisation() {
    const lv = this.level.level;
    const rand = rng(hashString(`${this.data.login}:civ`));
    this.orbiters = [];

    if (lv >= 2) {
      const count = lv >= 7 ? 90 : 3 + lv * 5;
      const geo = new THREE.BoxGeometry(0.5, 0.5, 1.4);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.4, 2.6) });
      const sats = new THREE.InstancedMesh(geo, mat, count);
      for (let i = 0; i < count; i++) {
        this.orbiters.push({ mesh: sats, index: i, radius: R * (1.18 + rand() * 0.5), speed: 0.05 + rand() * 0.12, phase: rand() * Math.PI * 2, tilt: new THREE.Euler(rand() * Math.PI, rand() * Math.PI, 0) });
      }
      this.frame.add(sats);
    }

    if (lv >= 3) {
      const moonMat = new THREE.ShaderMaterial({
        uniforms: { uSunDir: this.uniforms.uSunDir, uSeed: this.uniforms.uSeed },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          varying vec3 vN;
          void main() {
            vDir = normalize(position);
            vN = normalize(mat3(modelMatrix) * vDir);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          ${NOISE}
          uniform vec3 uSunDir;
          uniform vec3 uSeed;
          varying vec3 vDir;
          varying vec3 vN;
          void main() {
            float n = fbm(vDir * 3.0 + uSeed, 5);
            float craters = smoothstep(0.55, 0.62, abs(snoise(vDir * 7.0 + uSeed.yzx)));
            vec3 col = vec3(0.42, 0.41, 0.4) * (0.8 + n * 0.3) - craters * 0.08;
            float sun = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
            float base = smoothstep(0.985, 1.0, fract(sin(dot(floor(vDir * 60.0), vec3(12.9, 78.2, 37.7))) * 43758.5)) * step(sun, 0.05);
            gl_FragColor = vec4(col * (sun * 1.2 + 0.015) + vec3(1.0, 0.75, 0.45) * base * 3.0, 1.0);
          }`,
      });
      this.moon = new THREE.Mesh(new THREE.SphereGeometry(R * 0.2, 48, 24), moonMat);
      this.moonOrbit = { radius: R * 3.4, speed: 0.02, phase: rand() * Math.PI * 2 };
      this.frame.add(this.moon);
    }

    if (lv >= 5) {
      // orbital ring with lit panels, and a space elevator down to the port city
      const ringMat = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        uniforms: { uSunDir: this.uniforms.uSunDir, uTime: this.uniforms.uTime, uDense: { value: lv >= 6 ? 1 : 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir;
          uniform float uTime;
          uniform float uDense;
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            float ang = atan(vWorld.z, vWorld.x);
            float seg = fract(ang * 60.0 / 6.2831853);
            float frame = step(0.93, seg) + step(vUv.y, 0.08) + step(0.92, vUv.y);
            float lamps = step(0.97, fract(ang * 480.0 / 6.2831853)) * step(0.45, vUv.y) * step(vUv.y, 0.55);
            float blink = 0.6 + 0.4 * sin(uTime * 2.0 + ang * 40.0);
            vec3 panel = vec3(0.1, 0.11, 0.13);
            float shade = 0.25 + 0.75 * max(dot(normalize(uSunDir), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0);
            vec3 col = panel * shade + vec3(0.2, 0.22, 0.25) * frame * shade;
            col += vec3(1.0, 0.8, 0.5) * lamps * blink * (1.5 + uDense * 2.0);
            gl_FragColor = vec4(col, 0.92);
          }`,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(R * 1.62, R * 1.7, 512, 1), ringMat);
      ring.rotation.x = -Math.PI / 2;
      this.group.add(ring);
      this.ring = ring;

      // port city: the biggest city closest to the equator gets the elevator
      const port = [...this.cities].slice(0, 6).sort((a, b) => Math.abs(a.dir.y) - Math.abs(b.dir.y))[0];
      if (port) {
        const flat = new THREE.Vector3(port.dir.x, 0, port.dir.z).normalize();
        const base = port.dir.clone().multiplyScalar(R * 1.01);
        const top = flat.clone().multiplyScalar(R * 1.62);
        const length = base.distanceTo(top);
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, length, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.6, 1.8) }));
        cable.position.copy(base).add(top).multiplyScalar(0.5);
        cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(base).normalize());
        this.group.add(cable);
      }

      if (lv >= 7) {
        const second = new THREE.Mesh(new THREE.RingGeometry(R * 1.9, R * 1.96, 512, 1), ringMat);
        second.rotation.set(-Math.PI / 2 + 1.05, 0.4, 0);
        this.group.add(second);
        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: haloTexture(),
            color: new THREE.Color(langColor(this.mainLanguage)).multiplyScalar(0.28),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        );
        halo.scale.setScalar(R * 4.6);
        this.frame.add(halo);
      }

      if (lv >= 6) {
        const stations = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 1.2, 3.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.3) }), 24);
        const m = new THREE.Matrix4();
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2 + rand() * 0.1;
          m.makeRotationY(-a).setPosition(Math.cos(a) * R * 1.66, 0, Math.sin(a) * R * 1.66);
          stations.setMatrixAt(i, m);
        }
        this.group.add(stations);
      }
    }

    // rockets: industrial worlds launch from their biggest city; real releases replace this (setLaunches)
    if (lv >= 4 && this.cities[0]) this.#makeRocket(rand() * 8);
    this.launches = [];
  }

  #makeRocket(delay = 0) {
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(3, 1.8, 0.8), transparent: true, opacity: 0.9 }));
    this.group.add(trail);
    const el = document.createElement('div');
    el.className = 'rocket-label';
    const label = new CSS2DObject(el);
    this.group.add(label);
    this.rocket = { trail, label, t: -delay, every: 12, n: 0 };
  }

  // Real release tags of this world's cities (tools/universe/events.mjs): each lifts off its own city.
  setLaunches(launches) {
    this.launches = launches.filter((l) => l.city >= 0);
    if (this.launches.length && !this.rocket) this.#makeRocket(2);
  }

  // City under a world-space ray, if any: analytic sphere hit, then nearest city within its radius.
  cityAt(ray) {
    const center = this.frame.position;
    const oc = ray.origin.clone().sub(center);
    const b = oc.dot(ray.direction);
    const c = oc.lengthSq() - (R * 1.01) ** 2;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return -1;
    const hit = ray.origin.clone().addScaledVector(ray.direction, t).sub(center).normalize();
    const local = hit.applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion()).invert());
    let best = -1;
    let bestScore = Infinity;
    this.cities.forEach((city, i) => {
      const ang = city.dir.angleTo(local);
      const score = ang / (city.size * 1.2);
      if (score < 1 && score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best;
  }

  // World-space position of a city (slightly above the surface).
  cityWorld(i, lift = 1.012) {
    return this.cities[i].dir.clone().multiplyScalar(R * lift).applyMatrix4(this.group.matrixWorld);
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    this.group.rotation.y += dt * 0.012;
    this.clouds.rotation.y += dt * 0.004;
    this.group.updateMatrixWorld();
    this.uniforms.uRot.value.setFromMatrix4(this.group.matrixWorld);
    this.atmoUniforms.uCenter.value.setFromMatrixPosition(this.frame.matrixWorld);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const o of this.orbiters) {
      const a = o.phase + time * o.speed;
      const p = new THREE.Vector3(Math.cos(a) * o.radius, 0, Math.sin(a) * o.radius).applyEuler(o.tilt);
      q.setFromEuler(o.tilt);
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      o.mesh.setMatrixAt(o.index, m);
    }
    if (this.orbiters.length) this.orbiters[0].mesh.instanceMatrix.needsUpdate = true;

    if (this.moon) {
      const a = this.moonOrbit.phase + time * this.moonOrbit.speed;
      this.moon.position.set(Math.cos(a) * this.moonOrbit.radius, Math.sin(a) * this.moonOrbit.radius * 0.18, Math.sin(a) * this.moonOrbit.radius);
      this.moon.rotation.y = a;
    }

    if (this.rocket) {
      const r = this.rocket;
      r.t += dt;
      if (r.t > r.every) {
        r.t = 0;
        r.n++;
      }
      const launch = this.launches.length ? this.launches[r.n % this.launches.length] : null;
      const pos = r.trail.geometry.attributes.position;
      const start = this.cities[launch ? launch.city : 0].dir.clone();
      const side = new THREE.Vector3(0, 1, 0).cross(start).normalize();
      const k = Math.min(1, Math.max(0, r.t / 6));
      for (let i = 0; i < 64; i++) {
        const s = Math.max(0, k - (i / 64) * 0.35);
        const alt = R * (1.01 + s * s * 1.4);
        const dir = start.clone().addScaledVector(side, s * s * 0.9).normalize();
        pos.setXYZ(i, dir.x * alt, dir.y * alt, dir.z * alt);
      }
      pos.needsUpdate = true;
      const visible = k > 0 && k < 1;
      r.trail.material.opacity = visible ? 0.95 * (1 - k * 0.6) : 0;
      r.label.position.set(pos.getX(0), pos.getY(0), pos.getZ(0));
      r.label.element.textContent = launch ? `${launch.name} ${launch.tag}` : '';
      r.label.element.style.opacity = visible && launch ? 1 : 0;
    }
  }

  dispose() {
    this.frame.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    this.cube.dispose();
  }
}
