import { buildTree, layoutCity } from '../ingest/layout.mjs';

// A city for any public repository, raised in the browser from the GitHub API in a few requests: the
// tree of files at HEAD (lines estimated from bytes) and the files the last 100 commits touched,
// which light up. There is no history yet, so no timelapse; the mapping service (server/) or
// `npm run ingest` surveys the whole history and replaces this snapshot with the full city.

const IGNORE = [
  /(^|\/)(node_modules|vendor|third_party|dist|build)\//,
  /\.min\.(js|css)$/,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock)$/,
  /\.(png|jpe?g|gif|ico|svg|webp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp3|mp4|mov|wasm|jar|exe|dll|so|dylib|bin|dat|npy|pt|onnx|safetensors)$/i,
];
const BYTES_PER_LINE = 36; // typical source code; only an estimate until the history is surveyed
const MAX_FILES = 9000;
const CACHE_HOURS = 6;

class ApiError extends Error {}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.ok) return res.json();
  if (res.status === 404) throw new ApiError('not found');
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const wait = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : 60;
    throw new ApiError(`GitHub allows 60 requests an hour without signing in, and they're used up. Try again in ${wait} min, or visit a prebaked city.`);
  }
  throw new ApiError(`GitHub API error ${res.status}`);
}

export async function liveCity(fullName) {
  const key = `commitverse:live2:${fullName.toLowerCase()}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (hit && Date.now() - hit.at < CACHE_HOURS * 3600e3) return hit.city;
  } catch {}

  let repo;
  try {
    repo = await gh(`/repos/${fullName}`);
  } catch (err) {
    throw new Error(err.message === 'not found' ? `There's no public repository ${fullName}` : err.message);
  }
  const tree = await gh(`/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`);

  // recent work: the last 100 commits, and every file they touched between them
  let commits = [];
  const touched = new Map();
  try {
    commits = await gh(`/repos/${repo.full_name}/commits?per_page=100`);
    if (commits.length > 1) {
      const cmp = await gh(`/repos/${repo.full_name}/compare/${commits.at(-1).sha}...${commits[0].sha}`);
      for (const f of cmp.files ?? []) touched.set(f.filename, f.changes ?? 1);
    } else if (commits.length === 1) {
      const one = await gh(`/repos/${repo.full_name}/commits/${commits[0].sha}`);
      for (const f of one.files ?? []) touched.set(f.filename, f.changes ?? 1);
    }
  } catch {}

  let blobs = tree.tree.filter((e) => e.type === 'blob' && e.size > 0 && !IGNORE.some((re) => re.test(e.path)));
  const trimmed = blobs.length > MAX_FILES;
  if (trimmed) blobs = blobs.sort((a, b) => b.size - a.size).slice(0, MAX_FILES);
  if (!blobs.length) throw new Error(`${repo.full_name} has no source files to build with`);

  const t = (iso) => Math.round(Date.parse(iso) / 1000);
  const head = t(commits[0]?.commit.committer.date ?? repo.pushed_at);
  const recentFrom = t(commits.at(-1)?.commit.committer.date ?? repo.pushed_at);
  const born = t(repo.created_at);
  const files = blobs.map((b) => ({ p: b.path, loc: Math.max(1, Math.round(b.size / BYTES_PER_LINE)) }));
  const layout = layoutCity(buildTree(files), files.length);
  const maxTouch = Math.max(1, ...touched.values());
  // In a busy repository 100 commits are a few days: a file outside them is "not lately", so date it
  // well past the city's light half-life (city.js) and let only the files really being worked on glow.
  const halfLife = Math.max(45 * 86400, (head - born) * 0.1);
  const quiet = Math.max(born, recentFrom - 2.2 * halfLife);

  const city = {
    version: 1,
    repo: { name: repo.full_name, url: repo.html_url, head: commits[0]?.sha ?? repo.default_branch, generatedAt: new Date().toISOString() },
    size: layout.size,
    districts: layout.districts,
    files: files.map((f, i) => {
      const changes = touched.get(f.p) ?? 0;
      return {
        p: f.p,
        loc: f.loc,
        peak: f.loc,
        alive: 1,
        // touched lately: lit and a little churn; the rest went quiet before the last 100 commits
        c: changes ? 1 + Math.round(9 * Math.log1p(changes) / Math.log1p(maxTouch)) : 0,
        first: born,
        last: changes ? head : quiet,
        ...layout.files[i],
      };
    }),
    authors: [],
    commits: [],
    events: {},
    snapshot: {
      now: head,
      start: born,
      stars: repo.stargazers_count,
      description: repo.description ?? '',
      language: repo.language,
      trimmed,
      treeTruncated: !!tree.truncated,
      recent: commits.slice(0, 12).map((c) => ({ t: t(c.commit.committer.date), s: c.commit.message.split('\n')[0].slice(0, 120), a: c.commit.author?.name ?? c.author?.login ?? '' })),
    },
  };
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), city }));
  } catch {} // a big city may not fit in storage; it's only a cache
  return city;
}
