import { langColor } from './lore.js';

// The Commitverse is a cluster of galaxies (docs/LORE.md). Every world belongs to exactly one,
// decided in this order: the giants first, then AI, then the silent archive, then the family of its
// main language. Rising projects (protostars) have a galaxy of their own until they grow into
// megastars, when they migrate to the Titans: the universe changes as GitHub does.

export const MEGASTAR = 100000; // stars that make a giant, for a world or a single rising project

export const GALAXIES = [
  { id: 'titan', name: 'The Titan Galaxy', color: '#ffc76a', shape: 'elliptical', text: 'The giants of GitHub: every world with 100,000 stars or more. Rising projects that grow this bright migrate here.' },
  { id: 'ai', name: 'The AI Galaxy', color: '#b77bff', shape: 'spiral', arms: 2, pitch: 1.7, text: 'Worlds that build artificial intelligence: models, agents, the tools around them. It ignited with the LLM wave.' },
  { id: 'rising', name: 'The Rising Galaxy', color: '#ff6f9f', shape: 'irregular', text: 'Repositories born in the last year and climbing fast: protostars. At 100,000 stars one ignites and migrates to the Titans.' },
  { id: 'python', name: 'The Python Galaxy', langs: ['Python', 'Jupyter Notebook', 'R', 'Julia', 'Cython'], shape: 'spiral', arms: 4, text: 'Python and the data languages around it: science, notebooks, scripts that run the world.' },
  { id: 'javascript', name: 'The JavaScript Galaxy', langs: ['JavaScript', 'Vue', 'HTML', 'CSS', 'SCSS', 'Svelte', 'Astro'], shape: 'spiral', arms: 5, text: 'The web as it is written: JavaScript, Vue, Svelte, HTML and CSS.' },
  { id: 'typescript', name: 'The TypeScript Galaxy', langs: ['TypeScript'], shape: 'barred', arms: 2, text: 'JavaScript with types, and the tooling the modern web is built on.' },
  { id: 'rust', name: 'The Rust Galaxy', langs: ['Rust', 'Zig'], shape: 'spiral', arms: 3, pitch: 2.4, text: 'Memory-safe systems languages: Rust, and Zig beside it.' },
  { id: 'go', name: 'The Go Galaxy', langs: ['Go'], shape: 'spiral', arms: 2, pitch: 1.5, text: 'Go: the cloud, its servers and its command lines.' },
  { id: 'c', name: 'The C & C++ Galaxy', langs: ['C', 'C++', 'Cuda', 'Assembly', 'Objective-C++'], shape: 'barred', arms: 4, text: 'The oldest light: C, C++ and the metal under everything else.' },
  { id: 'jvm', name: 'The JVM & .NET Galaxy', langs: ['Java', 'Kotlin', 'Scala', 'Groovy', 'Clojure', 'C#', 'F#'], shape: 'spiral', arms: 4, text: 'Java, Kotlin, Scala and C#: the enterprise, Android and the virtual machines.' },
  { id: 'mobile', name: 'The Apple & Mobile Galaxy', langs: ['Swift', 'Dart', 'Objective-C'], shape: 'spiral', arms: 3, text: 'Swift, Dart and Objective-C: apps in every pocket.' },
  { id: 'functional', name: 'The Functional Galaxy', langs: ['Haskell', 'Elixir', 'Erlang', 'OCaml', 'Elm', 'Gleam', 'PureScript', 'Racket', 'Common Lisp'], shape: 'spiral', arms: 6, pitch: 2.6, text: 'Haskell, Elixir, Erlang, OCaml: pure functions and very old ideas that keep coming back.' },
  { id: 'scripting', name: 'The Scripting Galaxy', langs: ['Ruby', 'Lua', 'Perl', 'PHP', 'Shell', 'PowerShell', 'Vim Script', 'Emacs Lisp'], shape: 'spiral', arms: 3, text: 'Ruby, Lua, PHP, Shell, and every language without a galaxy of its own.' },
  { id: 'archive', name: 'The Silent Galaxy', color: '#8fa3c7', shape: 'elliptical', text: 'Worlds that went quiet: archived, or nothing pushed for two years. Their light is still arriving.' },
];
export const GALAXY = Object.fromEntries(GALAXIES.map((g) => [g.id, g]));
for (const g of GALAXIES) g.color ??= langColor(g.langs[0]);
GALAXY.all = { id: 'all', name: 'The Commitverse as one galaxy', color: '#ffd7a0', shape: 'legacy', text: 'Every world in a single galaxy, as in the film.' };

const FAMILY = new Map(GALAXIES.flatMap((g) => (g.langs ?? []).map((l) => [l, g.id])));
export const familyOf = (lang) => FAMILY.get(lang) ?? 'scripting';

export function galaxyOf(a) {
  if (a.s >= MEGASTAR) return 'titan';
  if (a.sector === 'ai') return 'ai';
  if (a.sector === 'silent') return 'archive';
  return familyOf(a.lang);
}

// The galaxy of a world we have only its repositories for (the README card, a live world): the same
// rules the seed applies (tools/universe/seed.mjs), from the repositories alone.
const AI_RE = /(^|-)(ai|llm|llms|gpt|ml|machine-learning|deep-learning|neural|transformer|transformers|agent|agents|rag|diffusion|generative-ai|langchain|pytorch|tensorflow|nlp)($|-)/;
export function galaxyOfRepos(repos, now = Date.now() / 1000) {
  let stars = 0;
  let ai = 0;
  let archived = 0;
  let pushed = 0;
  const langs = {};
  for (const r of repos) {
    stars += r.s;
    if (r.lang) langs[r.lang] = (langs[r.lang] ?? 0) + r.s;
    if ((r.topics ?? []).some((t) => AI_RE.test(t)) || AI_RE.test(r.n.toLowerCase())) ai += r.s;
    if (r.a) archived += r.s;
    pushed = Math.max(pushed, r.p ?? 0);
  }
  const lang = Object.entries(langs).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'Other';
  const sector = archived / Math.max(stars, 1) > 0.8 || now - pushed > 2 * 365 * 86400 ? 'silent' : ai / Math.max(stars, 1) >= 0.5 && stars >= 2000 ? 'ai' : 'arm';
  return galaxyOf({ s: stars, sector, lang });
}
