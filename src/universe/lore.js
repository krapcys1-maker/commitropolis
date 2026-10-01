// The rules of the Commitverse (docs/LORE.md), as code.

// Stars are energy: a world develops with the total stars across its repositories.
export const LEVELS = [
  { level: 0, name: 'Dust', min: 0, text: 'A bare rock and a single campfire: the first commit.' },
  { level: 1, name: 'Outpost', min: 1, text: 'A few lit huts and dirt tracks.' },
  { level: 2, name: 'Colony', min: 10, text: 'Towns joined by roads. The first satellite goes up.' },
  { level: 3, name: 'Civilisation', min: 100, text: 'City lights you can see from orbit, and a base on the moon.' },
  { level: 4, name: 'Industrial', min: 1000, text: 'Megacities, and a spaceport that launches a rocket on every release.' },
  { level: 5, name: 'Spacefaring', min: 10000, text: 'An orbital ring, a space elevator, fleets of contributor ships.' },
  { level: 6, name: 'Ecumenopolis', min: 100000, text: 'The whole night side is one city. Stations crowd the ring.' },
  { level: 7, name: 'Galactic', min: 500000, text: 'This world bends its region of the galaxy. Its light is seen from anywhere.' },
];

export function levelOf(stars) {
  let current = LEVELS[0];
  for (const l of LEVELS) if (stars >= l.min) current = l;
  const next = LEVELS[current.level + 1] ?? null;
  const progress = next ? (Math.log10(stars + 1) - Math.log10(current.min + 1)) / (Math.log10(next.min + 1) - Math.log10(current.min + 1)) : 1;
  return { ...current, next, progress: Math.max(0, Math.min(1, progress)) };
}

// Each city (repository) has its own tier by its own stars.
export function cityTier(stars) {
  if (stars >= 10000) return 'Metropolis';
  if (stars >= 1000) return 'City';
  if (stars >= 100) return 'Town';
  return 'Village';
}

export const SECTORS = {
  singularity: { name: 'The Singularity', color: '#ffb36b', text: 'At the centre of everything: git. Every world orbits it.' },
  ancient: { name: 'Ancient Worlds', color: '#ffd28a', text: 'The oldest worlds, still burning. Kernels, compilers, languages: the code that runs everything.' },
  titan: { name: 'The Titan Cluster', color: '#7fb6ff', text: 'The largest organisations. Their flagship projects orbit them as megastructures.' },
  ai: { name: 'The AI Nebula', color: '#c58bff', text: 'Ignited in 2023 and still the fastest-growing region of the galaxy.' },
  nursery: { name: 'The Stellar Nursery', color: '#ff7aa8', text: 'Protostars: repositories born this year and rising fast. Visit them early and your flag stays on them.' },
  arm: { name: 'The Language Arms', color: '#9fe3ff', text: 'Where most developers live, each arm the colour of its language.' },
  silent: { name: 'The Silent Belt', color: '#8fa3b8', text: 'Archived and resting worlds. A memorial, not a graveyard.' },
  frontier: { name: 'The Frontier', color: '#b6c2d9', text: 'The newest worlds, at the edge of the galaxy, still forming.' },
};

// GitHub Linguist colours, used for atmospheres and spiral arms.
export const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Rust: '#dea584', Go: '#00ADD8', Java: '#b07219',
  'C++': '#f34b7d', C: '#8e9aa8', 'C#': '#178600', PHP: '#4F5D95', Ruby: '#701516', Swift: '#F05138', Kotlin: '#A97BFF',
  Shell: '#89e051', 'Jupyter Notebook': '#DA5B0B', Dart: '#00B4AB', Scala: '#c22d40', Zig: '#ec915c', Lua: '#4a5fd0',
  Haskell: '#5e5086', Elixir: '#6e4a7e', HTML: '#e34c26', Vue: '#41b883', Cuda: '#3A9E4A', 'Objective-C': '#438eff',
  CSS: '#663399', Other: '#9aa7c7',
};
export const langColor = (lang) => LANGUAGE_COLORS[lang] ?? LANGUAGE_COLORS.Other;

// A world's main language shapes its nature, so you can tell ecosystems apart from orbit.
// ocean: [deep, shallow]; land: [shore, lowland, highland, rock]; sea: sea level (higher = more ocean).
export const WORLD_STYLES = {
  Python: { kind: 'temperate', ocean: ['#04142b', '#0f4a6e'], land: ['#c9b48a', '#2f6a34', '#5b6b3a', '#8a8278'], sea: 0.04 },
  'Jupyter Notebook': { kind: 'autumn', ocean: ['#071528', '#16466a'], land: ['#d8b98a', '#b8732e', '#8a4a22', '#8a7a6a'], sea: 0.04 },
  JavaScript: { kind: 'desert', ocean: ['#0b1a2e', '#1b5a6e'], land: ['#f0d58a', '#d9aa4e', '#a8723a', '#7e5c40'], sea: -0.1 },
  TypeScript: { kind: 'ocean', ocean: ['#021030', '#0a3d8a'], land: ['#e0d4a8', '#3f7a5a', '#56705a', '#8a8a8a'], sea: 0.16 },
  Rust: { kind: 'rust', ocean: ['#140905', '#3a2014'], land: ['#d0773e', '#a8522a', '#7a3a22', '#5a3020'], sea: -0.14 },
  Go: { kind: 'lagoon', ocean: ['#022a2e', '#067a80'], land: ['#c8eadc', '#3aa08a', '#2a6a60', '#8aa0a0'], sea: 0.06 },
  C: { kind: 'ice', ocean: ['#081424', '#34506a'], land: ['#e6ecf2', '#a6b4c4', '#74849a', '#f4f8fb'], sea: 0.02 },
  'C++': { kind: 'crystal', ocean: ['#140818', '#40163a'], land: ['#e0aac4', '#a8567a', '#74405e', '#c8c0cc'], sea: 0.02 },
  Cuda: { kind: 'jungle', ocean: ['#03140c', '#0c4a34'], land: ['#b8d890', '#2e8a3a', '#1f5a2a', '#6a7a5a'], sea: 0.0 },
  Java: { kind: 'canyon', ocean: ['#0a1420', '#2a4a5a'], land: ['#e0b080', '#b87840', '#8a5030', '#6a4a3a'], sea: -0.06 },
  Kotlin: { kind: 'violet', ocean: ['#0c0820', '#2a1e5a'], land: ['#d8c8f0', '#7a5ab8', '#56408a', '#a098b0'], sea: 0.04 },
  Ruby: { kind: 'crimson', ocean: ['#14060a', '#4a1420'], land: ['#e8a0a0', '#a8323a', '#7a2230', '#8a7070'], sea: 0.0 },
  Lua: { kind: 'twilight', ocean: ['#070a24', '#1a2a7a'], land: ['#c8c0f0', '#5a5ac0', '#40408a', '#9090b0'], sea: 0.06 },
  Shell: { kind: 'moss', ocean: ['#061808', '#1a4a24'], land: ['#d8f0a0', '#7ab83a', '#4a7a2a', '#7a8a6a'], sea: 0.02 },
  Swift: { kind: 'ember', ocean: ['#180a06', '#5a2a14'], land: ['#f8c090', '#e07a3a', '#a84a22', '#8a6a5a'], sea: -0.06 },
};
export const worldStyle = (lang) => WORLD_STYLES[lang] ?? WORLD_STYLES.Python;

export const PROLOGUE = [
  'In 2005 a single commit set off a singularity.',
  'It was called git, and everything since has orbited it.',
  'In 2008 the universe began to expand.',
  'Worlds formed around people. Cities grew around their ideas.',
  'They gathered into galaxies by the code they write, and every star they were given made them brighter.',
  'You are a cartographer of the Commitverse.',
];

export const hashString = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};

// Deterministic PRNG for placements (mulberry32).
export function rng(seed) {
  let a = Math.floor(seed * 4294967295) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
