import * as THREE from 'three';

// Procedural looks, no textures: every detail is derived from world-space units, so windows keep
// the same size on a 2-storey config file and a 60-storey changelog.

const HASH = /* glsl */ `
float cc_hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}`;

// Per-instance box size and local position in world units (instances are scaled unit shapes).
const INSTANCE_LOCAL_VERTEX = /* glsl */ `
vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vLocal = position * vSize;
vObjNormal = normal;`;

export const FLOOR_HEIGHT = 1.1;

// Buildings: dark facades with a window grid. Lit windows = recent activity (aLit), a neon crown in the
// district's hue, and a warm (growth) or red (deletion) wash while a commit touches the file (aHeat).
// uFocus/uBand light up a band of floors on one building: the lines being read in the code view.
export function createBuildingMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uFocus = uniforms.uFocus;
    shader.uniforms.uBand = uniforms.uBand;
    shader.uniforms.uCamPos = uniforms.uCamPos;
    shader.uniforms.uFocusPos = uniforms.uFocusPos;
    shader.uniforms.uTunnel = uniforms.uTunnel;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aHeat;
        attribute float aLit;
        attribute float aSeed;
        attribute float aRuin;
        attribute float aId;
        varying float vHeat;
        varying float vLit;
        varying float vSeed;
        varying float vRuin;
        varying float vId;
        varying vec3 vLocal;
        varying vec3 vSize;
        varying vec3 vObjNormal;
        varying vec3 vWorld;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vHeat = aHeat;
        vLit = aLit;
        vSeed = aSeed;
        vRuin = aRuin;
        vId = aId;
        vWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        ${INSTANCE_LOCAL_VERTEX}`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uFocus;
        uniform vec2 uBand;
        uniform vec3 uCamPos;
        uniform vec3 uFocusPos;
        uniform float uTunnel;
        varying float vHeat;
        varying float vLit;
        varying float vSeed;
        varying float vRuin;
        varying float vId;
        varying vec3 vLocal;
        varying vec3 vSize;
        varying vec3 vObjNormal;
        varying vec3 vWorld;
        ${HASH}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // X-ray tunnel: while a building is open, dissolve whatever stands between it and the camera.
        if (uFocus > -0.5 && abs(vId - uFocus) > 0.5) {
          vec3 cc_ab = uFocusPos - uCamPos;
          float cc_t = clamp(dot(vWorld - uCamPos, cc_ab) / max(dot(cc_ab, cc_ab), 1e-4), 0.0, 1.0);
          float cc_off = length(vWorld - uCamPos - cc_ab * cc_t);
          float cc_fade = (1.0 - smoothstep(uTunnel * 0.55, uTunnel, cc_off)) * step(cc_t, 0.97);
          if (cc_hash(vec3(floor(gl_FragCoord.xy), 3.0)) < cc_fade) discard;
        }
        vec3 cc_hue = diffuseColor.rgb;
        float cc_roof = step(0.5, vObjNormal.y);
        float cc_sideX = step(0.5, abs(vObjNormal.x));
        float cc_face = cc_sideX * 2.0 + step(0.0, vObjNormal.x + vObjNormal.z);
        float cc_u = mix(vLocal.x, vLocal.z, cc_sideX);
        vec2 cc_grid = vec2(cc_u, vLocal.y / ${FLOOR_HEIGHT.toFixed(2)});
        vec2 cc_cellId = floor(cc_grid);
        vec2 cc_cell = fract(cc_grid);
        float cc_top = vSize.y - vLocal.y;
        float cc_facade = (1.0 - cc_roof) * step(0.7, cc_top) * step(0.45, vLocal.y) * (1.0 - vRuin);
        float cc_win = step(0.2, cc_cell.x) * step(cc_cell.x, 0.8) * step(0.3, cc_cell.y) * step(cc_cell.y, 0.84);
        // Far away a window is smaller than a few pixels: fade to the average instead of shimmering.
        vec2 cc_fw = fwidth(cc_grid);
        float cc_far = smoothstep(0.18, 0.45, max(cc_fw.x, cc_fw.y));
        // Hot files light more windows; a commit flash (heat > 1) lights nearly all of them.
        float cc_heatUp = max(vHeat, 0.0);
        float cc_chance = clamp(vLit + min(cc_heatUp, 1.0) * 0.3 + max(cc_heatUp - 1.0, 0.0) * 0.8, 0.0, 1.0);
        float cc_rand = cc_hash(vec3(vSeed * 917.0 + cc_face * 13.0, cc_cellId));
        float cc_lit = mix(cc_win * step(cc_rand, cc_chance), 0.33 * cc_chance, cc_far) * cc_facade;
        cc_win = mix(cc_win, 0.33, cc_far) * cc_facade;
        float cc_warm = mix(cc_hash(vec3(cc_cellId * vec2(7.0, 3.0), vSeed * 311.0)), 0.4, cc_far);
        vec3 cc_wall = cc_hue * 0.08 + vec3(0.016, 0.018, 0.026);
        diffuseColor.rgb = mix(cc_wall, vec3(0.012, 0.016, 0.026), cc_win);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.032, 0.04), cc_roof);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.045, 0.05), vRuin);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.08, cc_win * (1.0 - cc_lit));`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 1.0, cc_win * (1.0 - cc_lit));`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 cc_lamp = mix(vec3(1.0, 0.68, 0.36), vec3(0.62, 0.8, 1.0), step(0.78, cc_warm));
        totalEmissiveRadiance += cc_lamp * cc_lit * (0.3 + cc_warm * 0.45);
        float cc_crown = (1.0 - cc_roof) * (1.0 - smoothstep(0.08, 0.5, cc_top)) * (1.0 - vRuin);
        vec3 cc_neon = cc_hue / max(max(cc_hue.r, max(cc_hue.g, cc_hue.b)), 0.001);
        totalEmissiveRadiance += cc_neon * cc_crown * (0.35 + 1.3 * vLit);
        float cc_flashAmt = max(abs(vHeat) - 0.95, 0.0);
        vec3 cc_flash = vHeat >= 0.0 ? vec3(1.0, 0.55, 0.22) : vec3(1.0, 0.08, 0.16);
        totalEmissiveRadiance += cc_flash * cc_flashAmt * (0.3 + 0.7 * cc_roof);
        float cc_focus = 1.0 - step(0.5, abs(vId - uFocus));
        float cc_inBand = cc_focus * step(uBand.x, vLocal.y) * step(vLocal.y, uBand.y) * (1.0 - cc_roof);
        float cc_edges = cc_focus * (1.0 - cc_roof) * (1.0 - smoothstep(0.0, 0.07, min(abs(vLocal.y - uBand.x), abs(vLocal.y - uBand.y))));
        float cc_scan = 0.75 + 0.25 * sin(vLocal.y * 9.0 - uTime * 6.0);
        totalEmissiveRadiance += vec3(0.3, 0.85, 1.0) * (cc_inBand * (cc_win * 1.3 + 0.06) * cc_scan + cc_edges * 1.4);`
      );
  };
  return mat;
}

// District plates: dark asphalt with a glowing outline in the district's hue and street lamps along it.
export function createPlateMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aDepth;
        varying float vDepth;
        varying vec3 vLocal;
        varying vec3 vSize;
        varying vec3 vObjNormal;`
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvDepth = aDepth;\n${INSTANCE_LOCAL_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vDepth;
        varying vec3 vLocal;
        varying vec3 vSize;
        varying vec3 vObjNormal;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 cc_hue = diffuseColor.rgb;
        vec2 cc_half = vSize.xz * 0.5;
        vec2 cc_d = cc_half - abs(vLocal.xz);
        float cc_edge = min(cc_d.x, cc_d.y);
        float cc_along = cc_d.x < cc_d.y ? vLocal.z : vLocal.x;
        float cc_topFace = step(0.5, vObjNormal.y);
        diffuseColor.rgb = vec3(0.022, 0.024, 0.034) + cc_hue * 0.012;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float cc_level = 1.0 / vDepth;
        vec3 cc_neon = cc_hue / max(max(cc_hue.r, max(cc_hue.g, cc_hue.b)), 0.001);
        float cc_line = cc_topFace * (1.0 - smoothstep(0.03, 0.14, cc_edge));
        totalEmissiveRadiance += cc_neon * cc_line * (0.1 + 0.5 * cc_level);
        float cc_lampBand = cc_topFace * (1.0 - smoothstep(0.18, 0.3, abs(cc_edge - 0.45)));
        float cc_lamp = cc_lampBand * (1.0 - smoothstep(0.05, 0.14, abs(fract(cc_along / 3.6) - 0.5) - 0.38));
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * cc_lamp * step(vDepth, 1.5) * 0.6;`
      );
  };
  return mat;
}

// Ground: near-black with a faint grid that fades out away from the city.
export function createGroundMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.55, metalness: 0.4 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCitySize = uniforms.uCitySize;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCitySize;\nvarying vec3 vGround;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec2 cc_g = vGround.xz / 12.0;
        vec2 cc_gw = abs(fract(cc_g - 0.5) - 0.5) / fwidth(cc_g);
        float cc_grid = 1.0 - min(min(cc_gw.x, cc_gw.y), 1.0);
        float cc_fade = 1.0 - smoothstep(uCitySize * 0.55, uCitySize * 2.2, length(vGround.xz));
        totalEmissiveRadiance += vec3(0.16, 0.22, 0.45) * cc_grid * cc_fade * 0.07;`
      );
  };
  return mat;
}

// Night sky: gradient, a glow band on the horizon (the city lights up the haze), twinkling stars.
export function createSkyMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: uniforms.uTime,
      uTop: { value: new THREE.Color(0.002, 0.003, 0.008) },
      uHorizon: { value: new THREE.Color(0.008, 0.009, 0.022) },
      uGlow: { value: new THREE.Color(0.055, 0.02, 0.07) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // pinned to the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      varying vec3 vDir;
      ${HASH}
      void main() {
        float h = vDir.y;
        vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
        col += uGlow * exp(-abs(h) * 9.0);
        vec3 cell = floor(vDir * 380.0);
        float s = cc_hash(cell);
        float star = step(0.9982, s) * smoothstep(0.04, 0.35, h);
        col += vec3(0.9, 0.95, 1.0) * star * (0.5 + 0.5 * sin(uTime * (1.0 + s * 3.0) + s * 60.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// Commit beams: additive light columns, bright at the roof and fading upward, soft at the silhouette.
export function createBeamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute vec2 aBeam; // x = intensity, y = sign (+1 growth, -1 deletion)
      varying float vY;
      varying float vRim;
      varying vec2 vBeam;
      void main() {
        vY = position.y;
        vBeam = aBeam;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vRim = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vY;
      varying float vRim;
      varying vec2 vBeam;
      void main() {
        vec3 col = vBeam.y >= 0.0 ? vec3(1.0, 0.62, 0.28) : vec3(1.0, 0.1, 0.2);
        // clamp: pow() of a slightly negative base is NaN, and bloom would smear it over the whole frame
        float a = vBeam.x * pow(clamp(1.0 - vY, 0.0, 1.0), 1.8) * pow(clamp(vRim, 0.0, 1.0), 2.0);
        gl_FragColor = vec4(col * a * 2.6, a);
      }`,
  });
}

// Final touch after tone mapping: vignette and a little film grain.
export const FinishShader = {
  // uGrainAnim 0 freezes the grain into a static dither (the film: moving grain costs video bitrate)
  // uWarp (0..1): a zoom blur toward the centre with bright streaks, for travelling between scales
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.022 }, uGrainAnim: { value: 1 }, uWarp: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uGrainAnim;
    uniform float uWarp;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (uWarp > 0.002) {
        vec2 dir = vUv - 0.5;
        vec4 acc = c;
        float total = 1.0;
        for (int i = 1; i < 14; i++) {
          float k = float(i) / 14.0;
          float w = 1.0 - k * 0.7;
          acc += texture2D(tDiffuse, 0.5 + dir * (1.0 - k * 0.42 * uWarp)) * w;
          total += w;
        }
        vec4 blur = acc / total;
        float edge = smoothstep(0.08, 0.6, length(dir));
        c = mix(c, blur, min(1.0, uWarp * 1.6) * (0.35 + 0.65 * edge));
        c.rgb += blur.rgb * uWarp * edge * 0.6; // light stretched into streaks
      }
      vec2 p = vUv - 0.5;
      c.rgb *= mix(0.62, 1.0, smoothstep(0.9, 0.25, length(p * vec2(1.0, 0.85))));
      float g = fract(sin(dot(vUv * (1.0 + fract(uTime) * uGrainAnim), vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};
