// Runtime configuration shared by the universe and the city pages.
// public/config.json sets the mapping service; `?api=https://…` overrides it for this tab (handy for testing).
let configPromise = null;

export function apiBase() {
  configPromise ??= (async () => {
    const fromUrl = new URLSearchParams(location.search).get('api');
    try {
      if (fromUrl) sessionStorage.setItem('commitverse:api', fromUrl);
    } catch {}
    let stored = null;
    try {
      stored = sessionStorage.getItem('commitverse:api');
    } catch {}
    if (stored) return stored.replace(/\/$/, '');
    try {
      const res = await fetch('config.json');
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return ((await res.json()).api ?? '').replace(/\/$/, '');
    } catch {}
    return '';
  })();
  return configPromise;
}

// A city bundle, best first: prebaked with the site, mapped by the mapping service (both with the
// whole history), or, for any other public repository ("owner/name"), a snapshot raised live from
// the GitHub API.
export async function fetchCity(slug) {
  const name = slug.includes('/') ? slug.replace(/^https?:\/\/github\.com\//, '').split('/').slice(0, 2).join('/') : null;
  const key = name ? name.replace('/', '-').toLowerCase() : slug;
  const local = await fetch(`data/${key}.json`);
  if (local.ok && (local.headers.get('content-type') ?? '').includes('json')) return local.json();
  const api = await apiBase();
  if (api) {
    const remote = await fetch(`${api}/api/city/${key}`).catch(() => null);
    if (remote?.ok) return remote.json();
  }
  if (!name) throw new Error(`City ${slug} is not mapped`);
  const { liveCity } = await import('./liveCity.js');
  return liveCity(name);
}

// Ask the mapping service to build a city, reporting progress steps until it is done.
export async function mapCity(repo, onStep) {
  const api = await apiBase();
  if (!api) throw new Error('No mapping service configured');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let res = await fetch(`${api}/api/map`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo }) });
  let job = await res.json();
  if (!res.ok) throw new Error(job.error ?? `Mapping service error ${res.status}`);
  while (job.status !== 'done') {
    if (job.status === 'error') throw new Error(job.error ?? 'Mapping failed');
    onStep?.(job);
    await sleep(1200);
    res = await fetch(`${api}/api/map/${job.slug}`);
    job = await res.json();
  }
  onStep?.(job);
  return job.slug;
}
