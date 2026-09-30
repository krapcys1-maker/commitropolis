// City layout: folders -> districts, files -> buildings.
// Computed ONCE for the final (HEAD) state of the repo, so the timelapse can grow
// every building in place instead of reshuffling the map after each commit.

// Footprint grows slower than height so small files stay visible next to big ones.
export const footprintWeight = (loc) => Math.sqrt(Math.max(loc, 4));

export function buildTree(files) {
  const root = { name: '', path: '', children: new Map(), value: 0 };
  files.forEach((f, i) => {
    const parts = f.p.split('/');
    let node = root;
    for (let k = 0; k < parts.length - 1; k++) {
      const name = parts[k];
      const key = `d:${name}`;
      if (!node.children.has(key)) {
        node.children.set(key, {
          name,
          path: node.path ? `${node.path}/${name}` : name,
          children: new Map(),
          value: 0,
        });
      }
      node = node.children.get(key);
    }
    // Keyed per identity, not per name: two files can end their lives at the same path, and a path
    // can be a file in one era and a folder in another. Each still needs its own lot.
    node.children.set(`f:${i}`, { name: parts.at(-1), path: f.p, file: i, value: footprintWeight(f.loc) });
  });
  sumValues(root);
  return root;
}

function sumValues(node) {
  if (node.file !== undefined) return node.value;
  node.value = 0;
  for (const child of node.children.values()) node.value += sumValues(child);
  return node.value;
}

// Squarified treemap (Bruls, Huizing, van Wijk). Returns [{node, x, y, w, h}].
export function squarify(nodes, rect) {
  const total = nodes.reduce((s, n) => s + n.value, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const items = nodes
    .map((node) => ({ node, area: node.value * scale }))
    .sort((a, b) => b.area - a.area);

  const out = [];
  let r = { ...rect };
  let row = [];
  while (items.length) {
    const side = Math.min(r.w, r.h);
    if (row.length === 0 || worst([...row, items[0]], side) <= worst(row, side)) {
      row.push(items.shift());
    } else {
      r = layoutRow(row, r, out);
      row = [];
    }
  }
  if (row.length) layoutRow(row, r, out);
  return out;
}

function worst(row, side) {
  let sum = 0, max = -Infinity, min = Infinity;
  for (const it of row) {
    sum += it.area;
    max = Math.max(max, it.area);
    min = Math.min(min, it.area);
  }
  const s2 = sum * sum, side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

function layoutRow(row, r, out) {
  const sum = row.reduce((s, it) => s + it.area, 0);
  if (r.w >= r.h) {
    const colW = sum / r.h;
    let y = r.y;
    for (const it of row) {
      const h = it.area / colW;
      out.push({ node: it.node, x: r.x, y, w: colW, h });
      y += h;
    }
    return { x: r.x + colW, y: r.y, w: r.w - colW, h: r.h };
  }
  const rowH = sum / r.w;
  let x = r.x;
  for (const it of row) {
    const w = it.area / rowH;
    out.push({ node: it.node, x, y: r.y, w, h: rowH });
    x += w;
  }
  return { x: r.x, y: r.y + rowH, w: r.w, h: r.h - rowH };
}

const round = (v) => Math.round(v * 100) / 100;

export function layoutCity(root, fileCount) {
  const size = Math.sqrt(root.value) * 3;
  const half = size / 2;
  const out = { size: round(size), districts: [], files: new Array(fileCount) };

  const place = (node, r, depth) => {
    if (node.file !== undefined) {
      const gap = Math.min(r.w, r.h) * 0.14;
      out.files[node.file] = {
        x: round(r.x + gap - half),
        z: round(r.y + gap - half),
        w: round(Math.max(r.w - 2 * gap, 0.05)),
        d: round(Math.max(r.h - 2 * gap, 0.05)),
      };
      return;
    }
    if (depth > 0) {
      out.districts.push({ p: node.path, depth, x: round(r.x - half), z: round(r.y - half), w: round(r.w), d: round(r.h) });
    }
    // Streets: padding between a district's edge and its contents, thinner as we go deeper.
    const pad = depth === 0 ? 0 : Math.min(Math.min(r.w, r.h) * 0.06, 4 / depth);
    const inner = { x: r.x + pad, y: r.y + pad, w: Math.max(r.w - 2 * pad, 0.01), h: Math.max(r.h - 2 * pad, 0.01) };
    const kids = [...node.children.values()].filter((c) => c.value > 0);
    for (const { node: child, ...rect } of squarify(kids, inner)) place(child, rect, depth + 1);
  };

  place(root, { x: 0, y: 0, w: size, h: size }, 0);
  return out;
}
