// Controles táctiles: botones momentáneos, perillas y faders.
// Todos usan Pointer Events para funcionar con varios dedos a la vez.

export function press(el, down, up) {
  const active = new Set();
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    active.add(e.pointerId);
    el.classList.add('pressed');
    if (navigator.vibrate) navigator.vibrate(6);
    if (down) down(e);
  });
  const end = (e) => {
    if (!active.delete(e.pointerId)) return;
    if (active.size === 0) el.classList.remove('pressed');
    if (up) up(e);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Doble toque = volver al valor por defecto.
function doubleTap() {
  let last = 0;
  return () => {
    const now = performance.now();
    const hit = now - last < 300;
    last = hit ? 0 : now;
    return hit;
  };
}

export class Knob {
  constructor(el, opts) {
    Object.assign(this, { min: -1, max: 1, value: 0, bipolar: true, label: '', onChange: null, sensitivity: 150 }, opts);
    this.def = opts.def ?? this.value;
    el.classList.add('knob');
    el.innerHTML = `<div class="knob-body"><div class="knob-arc"></div><div class="knob-cap"><i></i></div></div><span class="knob-label">${this.label}</span>`;
    this.arc = el.querySelector('.knob-arc');
    this.cap = el.querySelector('.knob-cap');
    const body = el.querySelector('.knob-body');
    const isDouble = doubleTap();
    let drag = null;

    body.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      body.setPointerCapture(e.pointerId);
      if (isDouble()) { this.set(this.def); drag = null; return; }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v: this.value };
      el.classList.add('active');
    });
    body.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = (drag.y - e.clientY) + (e.clientX - drag.x);
      this.set(drag.v + (d / this.sensitivity) * (this.max - this.min));
    });
    const end = (e) => {
      if (drag && drag.id === e.pointerId) { drag = null; el.classList.remove('active'); }
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
    this.render();
  }

  set(v, silent) {
    v = Math.min(this.max, Math.max(this.min, v));
    if (this.bipolar && Math.abs(v - this.def) < (this.max - this.min) * 0.02) v = this.def;
    if (v === this.value) return;
    this.value = v;
    this.render();
    if (!silent && this.onChange) this.onChange(v);
  }

  render() {
    const t = (this.value - this.min) / (this.max - this.min);
    const a = -135 + 270 * t;
    this.cap.style.transform = `rotate(${a}deg)`;
    const from = this.bipolar ? Math.min(0, a) : -135;
    const to = this.bipolar ? Math.max(0, a) : a;
    const span = to - from;
    this.arc.style.background = span > 0.5
      ? `conic-gradient(from ${from}deg, var(--arc) 0deg ${span}deg, transparent ${span}deg)`
      : 'none';
  }
}

// Fader vertical u horizontal con valor 0..1 (vertical: 1 = arriba).
// mode 'grab': tocar la tapa la arrastra, tocar la pista salta a ese punto.
// mode 'relative': siempre se mueve en relativo (ideal para el tempo).
export class Fader {
  constructor(el, opts) {
    Object.assign(this, { vertical: true, value: 0.5, mode: 'grab', detent: null, resettable: false, onChange: null }, opts);
    this.def = opts.def ?? this.value;
    this.el = el;
    el.classList.add('fader', this.vertical ? 'v' : 'h');
    el.innerHTML = '<div class="fader-track"></div><div class="fader-cap"></div>';
    this.cap = el.querySelector('.fader-cap');
    const isDouble = doubleTap();
    let drag = null;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (drag) return;
      el.setPointerCapture(e.pointerId);
      if (this.resettable && isDouble()) { this.set(this.def); return; }
      const r = el.getBoundingClientRect();
      const c = this.cap.getBoundingClientRect();
      const onCap = this.vertical
        ? e.clientY >= c.top - 10 && e.clientY <= c.bottom + 10
        : e.clientX >= c.left - 10 && e.clientX <= c.right + 10;
      drag = { id: e.pointerId, r, x: e.clientX, y: e.clientY, v: this.value, rel: this.mode === 'relative' || onCap };
      if (!drag.rel) this.set(this.fromPoint(e, r));
      el.classList.add('active');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.rel) {
        const span = this.vertical ? drag.r.height - this.capSize() : drag.r.width - this.capSize();
        const d = this.vertical ? (drag.y - e.clientY) : (e.clientX - drag.x);
        this.set(drag.v + d / Math.max(20, span));
      } else {
        this.set(this.fromPoint(e, drag.r));
      }
    });
    const end = (e) => {
      if (drag && drag.id === e.pointerId) { drag = null; el.classList.remove('active'); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    this.render();
  }

  capSize() {
    return this.vertical ? this.cap.offsetHeight : this.cap.offsetWidth;
  }

  fromPoint(e, r) {
    const cs = this.capSize();
    return this.vertical
      ? 1 - (e.clientY - r.top - cs / 2) / (r.height - cs)
      : (e.clientX - r.left - cs / 2) / (r.width - cs);
  }

  set(v, silent) {
    v = Math.min(1, Math.max(0, v));
    if (this.detent != null && Math.abs(v - this.detent) < 0.012) v = this.detent;
    if (v === this.value) return;
    this.value = v;
    this.render();
    if (!silent && this.onChange) this.onChange(v);
  }

  render() {
    this.el.style.setProperty('--v', this.value);
  }
}

// Perilla sin tope (encoder), como el selector de una controladora:
// deslizar hacia arriba sube y hacia abajo baja, un paso cada `pxPerStep` píxeles.
export class Encoder {
  constructor(el, { pxPerStep = 9, onStep }) {
    this.onStep = onStep;
    this.angle = 0;
    el.classList.add('encoder');
    el.innerHTML = '<div class="enc-cap"><i></i></div>';
    this.cap = el.querySelector('.enc-cap');
    let drag = null;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (drag) return;
      el.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, acc: 0 };
      el.classList.add('active');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = (drag.y - e.clientY) + (e.clientX - drag.x) * 0.5;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.acc += d;
      while (Math.abs(drag.acc) >= pxPerStep) {
        const dir = Math.sign(drag.acc);
        drag.acc -= dir * pxPerStep;
        this.step(dir);
      }
    });
    const end = (e) => {
      if (drag && drag.id === e.pointerId) { drag = null; el.classList.remove('active'); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.step(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  step(dir) {
    this.angle += dir * 15;
    this.cap.style.transform = `rotate(${this.angle}deg)`;
    if (navigator.vibrate) navigator.vibrate(3);
    if (this.onStep) this.onStep(dir);
  }
}
