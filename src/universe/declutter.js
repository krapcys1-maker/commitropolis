import * as THREE from 'three';

// Labels in space collide when their objects line up on screen. Each label tries its own place
// first, then just below, just above, to the left and to the right of it. Labels earlier in the list
// (the more important ones) choose first. A label with no free place is hidden.
//   items: [{ label: CSS2DObject, wanted: boolean }]
const v = new THREE.Vector3();
const SPOTS = [
  [0, 0],
  [0, -1.1],
  [0, 1.1],
  [-0.62, 0],
  [0.62, 0],
];

export function declutter(items, camera, pad = 6) {
  const placed = [];
  for (const it of items) {
    if (!it.wanted) {
      it.label.visible = false;
      continue;
    }
    it.label.getWorldPosition(v).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
      it.label.visible = false;
      continue;
    }
    it.home ??= it.label.center.clone();
    // measure once, while the label is shown (a hidden label measures 0)
    const el = it.label.element;
    if (!it.w && el.offsetWidth) {
      it.w = el.offsetWidth;
      it.h = el.offsetHeight;
    }
    const w = it.w || 120;
    const h = it.h || 32;
    const px = (v.x * 0.5 + 0.5) * innerWidth;
    const py = (-v.y * 0.5 + 0.5) * innerHeight;
    let chosen = null;
    for (const [dx, dy] of SPOTS) {
      // the label's centre on screen when its anchor point sits at (home + spot) of its own box
      const cx = px - w * (it.home.x + dx - 0.5);
      const cy = py - h * (it.home.y + dy - 0.5);
      const r = [cx - w / 2 - pad, cx + w / 2 + pad, cy - h / 2 - pad, cy + h / 2 + pad];
      if (!placed.some((p) => r[0] < p[1] && r[1] > p[0] && r[2] < p[3] && r[3] > p[2])) {
        chosen = [dx, dy, r];
        break;
      }
    }
    it.label.visible = !!chosen;
    if (!chosen) continue;
    it.label.center.set(it.home.x + chosen[0], it.home.y + chosen[1]);
    placed.push(chosen[2]);
  }
}
