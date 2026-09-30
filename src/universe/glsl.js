// Shared GLSL snippets for the universe views.

// 3D simplex noise: Ashima Arts / Stefan Gustavson, MIT licence (github.com/ashima/webgl-noise).
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= octaves) break;
    sum += amp * snoise(p);
    norm += amp;
    p = p * 2.03 + vec3(17.1, 9.2, 3.7);
    amp *= 0.5;
  }
  return sum / norm;
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
`;

// Terrain height on the unit sphere, shared by the planet surface and the land-mask bake.
// Domain-warped fbm gives continents with ragged coasts; ridged noise adds mountain ranges.
export const TERRAIN = /* glsl */ `
uniform vec3 uSeed;
uniform float uSea;

float terrain(vec3 dir) {
  vec3 p = dir * 1.35 + uSeed;
  vec3 warp = vec3(fbm(p + 3.1, 3), fbm(p + 7.7, 3), fbm(p + 11.3, 3));
  float continents = fbm(p + warp * 0.55, 6);
  float ridges = 1.0 - abs(fbm(dir * 3.4 + uSeed * 1.7, 5));
  float land = continents - uSea;
  return land + max(land, 0.0) * ridges * ridges * 0.55;
}
`;

// Single-scattering atmosphere (Rayleigh + Mie), after wwwtyro/glsl-atmosphere (Unlicense).
// Units: planet radius = 1.
export const ATMOSPHERE = /* glsl */ `
#define ATMO_PI 3.141592
#define ATMO_I 16
#define ATMO_J 8

vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd);
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b * b - 4.0 * a * c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0 * a), (-b + sqrt(d)) / (2.0 * a));
}

vec3 atmosphere(vec3 r, vec3 r0, vec3 pSun, float iSun, float rPlanet, float rAtmos, vec3 kRlh, float kMie, float shRlh, float shMie, float g) {
  pSun = normalize(pSun);
  r = normalize(r);
  vec2 p = rsi(r0, r, rAtmos);
  if (p.x > p.y) return vec3(0.0);
  p.x = max(p.x, 0.0);
  vec2 hitPlanet = rsi(r0, r, rPlanet);
  if (hitPlanet.x > 0.0) p.y = min(p.y, hitPlanet.x);
  float iStep = (p.y - p.x) / float(ATMO_I);
  float iTime = p.x;
  vec3 totalRlh = vec3(0.0);
  vec3 totalMie = vec3(0.0);
  float iOdRlh = 0.0;
  float iOdMie = 0.0;
  float mu = dot(r, pSun);
  float mumu = mu * mu;
  float gg = g * g;
  float pRlh = 3.0 / (16.0 * ATMO_PI) * (1.0 + mumu);
  float pMie = 3.0 / (8.0 * ATMO_PI) * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * g, 1.5) * (2.0 + gg));
  for (int i = 0; i < ATMO_I; i++) {
    vec3 iPos = r0 + r * (iTime + iStep * 0.5);
    float iHeight = length(iPos) - rPlanet;
    float odRlh = exp(-iHeight / shRlh) * iStep;
    float odMie = exp(-iHeight / shMie) * iStep;
    iOdRlh += odRlh;
    iOdMie += odMie;
    float jStep = rsi(iPos, pSun, rAtmos).y / float(ATMO_J);
    float jTime = 0.0;
    float jOdRlh = 0.0;
    float jOdMie = 0.0;
    for (int j = 0; j < ATMO_J; j++) {
      vec3 jPos = iPos + pSun * (jTime + jStep * 0.5);
      float jHeight = length(jPos) - rPlanet;
      jOdRlh += exp(-jHeight / shRlh) * jStep;
      jOdMie += exp(-jHeight / shMie) * jStep;
      jTime += jStep;
    }
    vec3 attn = exp(-(kMie * (iOdMie + jOdMie) + kRlh * (iOdRlh + jOdRlh)));
    totalRlh += odRlh * attn;
    totalMie += odMie * attn;
    iTime += iStep;
  }
  return iSun * (pRlh * kRlh * totalRlh + pMie * kMie * totalMie);
}
`;
