import './scale.css';

// One continuous zoom from the galaxy down to a line of code. The ladder on the left shows where you
// are; zooming past the limit of a scale and keeping on (wheel or pinch) carries you to the next one:
// out of a city to its world, out of a world to its star system, out to the galaxy, and back down.

export const LEVELS = [
  ['universe', 'Universe'],
  ['galaxy', 'Galaxy'],
  ['system', 'System'],
  ['world', 'World'],
  ['city', 'City'],
  ['building', 'Building'],
];
const PUSH = 2.4; // wheel notches (or pinch strength) past the limit before you change scale

export class ScaleHud {
  constructor() {
    this.el = document.createElement('nav');
    this.el.id = 'scale';
    this.el.setAttribute('aria-label', 'Scale');
    this.el.innerHTML = LEVELS.map(([key, name]) => `<a data-level="${key}"><i></i><span>${name}</span><small></small></a>`).join('');
    this.push = document.createElement('div');
    this.push.id = 'scale-push';
    this.push.innerHTML = '<span></span><i><b></b></i>';
    document.body.append(this.el, this.push);
    this.amount = 0;
    this.dir = null;
    this.last = 0;
    setInterval(() => {
      if (this.amount > 0 && performance.now() - this.last > 900) this.reset();
    }, 150);
  }

  // level: where you are now. stops: what the other rungs say and do, e.g.
  // { galaxy: { label: 'The Language Arms', go() {} }, city: { label: 'zoom into a city' } }
  set(level, stops = {}) {
    const at = LEVELS.findIndex(([key]) => key === level);
    this.el.querySelectorAll('a').forEach((a, i) => {
      const stop = stops[a.dataset.level];
      a.className = i === at ? 'here' : i < at ? 'up' : 'down';
      a.hidden = !stop && i !== at;
      a.querySelector('small').textContent = stop?.label ?? '';
      if (stop?.href) a.href = stop.href;
      else a.removeAttribute('href');
      a.onclick = stop?.go
        ? (e) => {
            e.preventDefault();
            stop.go();
          }
        : null;
      a.title = stop?.go || stop?.href ? `Go to ${a.querySelector('span').textContent.toLowerCase()}` : '';
    });
  }

  // A zoom gesture at the limit of the current scale. Returns true once the push is complete.
  press(dir, amount, label) {
    if (dir !== this.dir || label !== this.label) this.amount = 0;
    this.dir = dir;
    this.label = label;
    this.amount += amount;
    this.last = performance.now();
    const k = Math.min(1, this.amount / PUSH);
    this.push.querySelector('span').textContent = `${dir === 'out' ? '↥' : '↧'} ${label}`;
    this.push.querySelector('b').style.width = `${Math.round(k * 100)}%`;
    this.push.classList.add('on');
    if (k < 1) return false;
    this.reset();
    return true;
  }

  reset() {
    this.amount = 0;
    this.push.classList.remove('on');
  }
}

// Reports wheel notches and pinches, but only those that push against the current zoom limit:
// onPush('out' | 'in', amount, { clientX, clientY }).
export function watchZoom(element, controls, camera, onPush, { enabled = () => true } = {}) {
  const limit = () => {
    const d = camera.position.distanceTo(controls.target);
    if (d >= controls.maxDistance * 0.985) return 'out';
    if (d <= controls.minDistance * 1.02) return 'in';
    return null;
  };
  element.addEventListener(
    'wheel',
    (e) => {
      if (!enabled() || !e.deltaY) return;
      const dir = e.deltaY > 0 ? 'out' : 'in';
      if (limit() !== dir) return;
      onPush(dir, Math.min(1, Math.abs(e.deltaY) / (e.deltaMode === 1 ? 3 : 100)), e);
    },
    { passive: true }
  );
  let spread = 0;
  element.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 2) {
        spread = 0;
        return;
      }
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (spread && enabled()) {
        const dir = d < spread ? 'out' : 'in';
        if (limit() === dir) onPush(dir, Math.abs(d - spread) / 50, { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
      }
      spread = d;
    },
    { passive: true }
  );
  element.addEventListener('touchend', () => (spread = 0), { passive: true });
}
