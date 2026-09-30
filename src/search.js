// MVP search: path/keyword matching over files and districts.
// The planned AI guide replaces this with embedding search (see docs/ARCHITECTURE.md)
// behind the same interface: query -> ranked [{path, kind, score}].
export function search(data, query, limit = 8) {
  const tokens = query.toLowerCase().split(/[\s/]+/).filter(Boolean);
  if (!tokens.length) return [];
  const results = [];
  const score = (path, bonus) => {
    const lower = path.toLowerCase();
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    let s = 0;
    for (const t of tokens) {
      if (!lower.includes(t)) return 0;
      s += base.includes(t) ? 3 : 1;
      if (base.startsWith(t)) s += 1;
    }
    return s + bonus - path.length / 500;
  };
  for (const d of data.districts) {
    const s = score(d.p, 0.5);
    if (s > 0) results.push({ path: d.p, kind: 'district', score: s });
  }
  for (const f of data.files) {
    const s = score(f.p, Math.log10(1 + f.loc) / 10);
    if (s > 0) results.push({ path: f.p, kind: 'file', score: s, loc: f.loc });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
