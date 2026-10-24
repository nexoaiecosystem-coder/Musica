// Reproducción automática de la lista con transiciones suaves (crossfade).
// Usa los dos decks por turnos: mientras uno suena, el otro prepara la
// siguiente canción. Al final de cada tema, la siguiente entra a tiempo con el
// compás, al mismo BPM, y se intercambian los graves a mitad de la mezcla
// para que los dos bombos no choquen.
//
// Modos de tempo:
//   'original' → cada canción a su BPM, crossfade sin tocar el tempo
//   'match'    → la siguiente se iguala a la anterior y luego vuelve a su BPM
//   'fixed'    → todas suenan al BPM del set que elige el usuario

const MAX_TEMPO_CHANGE = 0.08; // modo 'match': no se fuerza más de ±8 %
const FIXED_MAX = 0.16;        // modo 'fixed': hasta ±16 %, como el rango de una controladora
const RAMP_MS = 20000;         // tras la mezcla, vuelve poco a poco a su tempo original
const GLIDE_PER_SEC = 0.006;   // al cambiar el BPM del set, el tempo se mueve 0,6 % por segundo
const RANGES = [0.06, 0.10, 0.16, 0.50];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Cambio de tempo para que una canción suene a `master` BPM (admite doble/mitad).
// Devuelve null si haría falta más de ±16 %.
export function fitPct(bpm, master) {
  if (!bpm) return null;
  const r = master / bpm;
  const best = [r, r * 2, r / 2].reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a));
  return Math.abs(best - 1) <= FIXED_MAX ? best - 1 : null;
}

export class AutoMix {
  constructor({ decks, mixer, xfader, library, onChange }) {
    this.decks = decks;
    this.mixer = mixer;
    this.xfader = xfader;
    this.library = library;
    this.onChange = onChange;
    this.fade = 12;
    this.tempoMode = 'match';
    this.masterBpm = 128;
    this.lastTick = 0;
    this.active = null;
    this.index = -1;
    this.ready = -1;
    this.loadingIdx = -1;
    this.loadTok = 0;
    this.startTok = 0;
    this.trans = null;
    this.ramp = null;
    this.held = null;
    this.cursor = 0; // canción por la que empezar cuando no suena nada
  }

  get running() { return this.index >= 0; }
  get idle() { return this.active ? this.active.other : this.decks[1]; }
  get isPlaying() { return this.running && !this.held && this.decks.some((d) => d.playing); }
  get beatmatch() { return this.tempoMode !== 'original'; }
  get progress() { return this.trans && this.trans.phase === 'fade' ? this.trans.p || 0 : 0; }

  side(d) { return this.decks.indexOf(d); }
  nextIndex() { return this.index + 1 < this.library.length ? this.index + 1 : -1; }
  changed() { if (this.onChange) this.onChange(); }

  remaining(d) {
    return (d.len - d.position) / d.sr / d.tempo;
  }

  setLow(deck, v) {
    deck.channel.knobs.low.set(v);
  }

  canMatch(a, b) {
    if (!a.bpm || !b.bpm) return false;
    if (this.tempoMode === 'match') return Math.abs(b.syncRatio() - 1) <= MAX_TEMPO_CHANGE;
    if (this.tempoMode === 'fixed') return fitPct(a.bpm, this.masterBpm) != null && fitPct(b.bpm, this.masterBpm) != null;
    return false;
  }

  // Tempo que debería tener un deck fuera de las mezclas.
  targetPct(deck) {
    return this.tempoMode === 'fixed' ? fitPct(deck.bpm, this.masterBpm) ?? 0 : 0;
  }

  applyTempo(deck, pct) {
    if (Math.abs(pct) > deck.range) deck.setRange(RANGES.find((r) => r >= Math.abs(pct)) || RANGES[RANGES.length - 1]);
    deck.setTempoPct(pct, true);
  }

  glide(deck, target, dt) {
    const diff = target - deck.tempoPct;
    if (Math.abs(diff) < 1e-5) return;
    const step = GLIDE_PER_SEC * dt;
    this.applyTempo(deck, deck.tempoPct + clamp(diff, -step, step));
  }

  setTempoMode(mode) {
    this.tempoMode = mode;
    this.ramp = null;
    const a = this.active;
    if (a && a.loaded && mode !== 'fixed' && !this.trans && Math.abs(a.tempoPct) > 1e-4) {
      this.ramp = { deck: a, from: a.tempoPct, t0: performance.now(), dur: 5000 };
    }
    this.changed();
  }

  setMasterBpm(v) {
    if (!Number.isFinite(v)) return;
    this.masterBpm = clamp(Math.round(v * 10) / 10, 60, 200);
    this.changed();
  }

  /* ── control desde la interfaz ── */

  async start(i) {
    this.stopTransitions();
    const d = this.active || this.decks[0];
    for (const x of this.decks) {
      x.pause();
      x.setSync(false);
      this.setLow(x, 0);
    }
    this.active = d;
    this.index = i;
    this.ready = -1;
    this.loadTok++;
    this.loadingIdx = -1;
    this.changed();
    this.cursor = i;
    const tok = ++this.startTok;
    const ok = await d.load(this.library[i]);
    if (tok !== this.startTok) return;
    if (!ok) {
      this.library.splice(i, 1);
      if (i < this.library.length) this.start(i);
      else { this.index = -1; this.active = null; this.changed(); }
      return;
    }
    this.applyTempo(d, this.targetPct(d));
    this.xfader.set(this.side(d));
    d.play();
    this.changed();
    this.preloadNext();
  }

  playIndex(i) {
    if (this.trans) return;
    if (!this.running || !this.active || !this.active.playing || this.held) {
      this.start(i);
      return;
    }
    if (i === this.index) return;
    this.begin(i);
  }

  next() {
    const n = this.nextIndex();
    if (n >= 0) this.playIndex(n);
  }

  prev() {
    if (!this.running || this.trans) return;
    const a = this.active;
    if (this.index === 0 || a.position / a.sr > 4) a.seek(a.cue);
    else this.playIndex(this.index - 1);
  }

  toggle() {
    const now = performance.now();
    if (!this.running) {
      if (this.library.length) this.start(clamp(this.cursor, 0, this.library.length - 1));
      return;
    }
    if (this.held) {
      for (const d of this.held) d.play();
      const pausedFor = now - this.heldAt;
      if (this.trans && this.trans.t0) this.trans.t0 += pausedFor;
      if (this.ramp) this.ramp.t0 += pausedFor;
      this.held = null;
    } else {
      const playing = this.decks.filter((d) => d.playing);
      if (playing.length) {
        for (const d of playing) d.pause();
        this.held = playing;
        this.heldAt = now;
      } else if (this.active.position < this.active.len - 2) {
        this.active.play();
      } else {
        const n = this.nextIndex();
        this.start(n >= 0 ? n : 0);
      }
    }
    this.changed();
  }

  // Detiene el modo automático sin tocar el audio (p. ej. al cargar a mano en modo DJ).
  stop() {
    if (this.index >= 0) this.cursor = this.index;
    this.stopTransitions();
    this.index = -1;
    this.active = null;
    this.ready = -1;
    this.loadTok++;
    this.startTok++;
    this.loadingIdx = -1;
    this.changed();
  }

  stopTransitions() {
    this.trans = null;
    this.ramp = null;
    this.held = null;
  }

  remove(i) {
    if (this.trans || i === this.index) return false;
    this.library.splice(i, 1);
    if (i < this.index) this.index--;
    if (i < this.cursor) this.cursor--;
    this.invalidateNext();
    return true;
  }

  /* ── edición de la cola ── */

  // La canción preparada en el deck libre ya no es la siguiente: hay que recargar.
  invalidateNext() {
    if (!this.trans) {
      this.ready = -1;
      this.loadTok++;
      this.loadingIdx = -1;
    }
    this.changed();
    this.preloadNext();
  }

  // Hace que `item` suene a continuación. Si no suena nada, empieza ya.
  playNext(item) {
    const q = this.library;
    if (!this.running) {
      const at = clamp(this.cursor, 0, q.length);
      q.splice(at, 0, item);
      this.start(at);
      return 'now';
    }
    const at = (this.trans ? this.trans.idx : this.index) + 1;
    q.splice(at, 0, item);
    this.invalidateNext();
    return 'next';
  }

  append(item) {
    this.library.push(item);
    this.changed();
    this.preloadNext();
  }

  // Mueve una canción que ya está en la cola para que suene a continuación.
  moveToNext(i) {
    if (this.trans || i === this.index) return false;
    const [item] = this.library.splice(i, 1);
    if (i < this.index) this.index--;
    if (i < this.cursor) this.cursor--;
    if (this.running) {
      this.library.splice(this.index + 1, 0, item);
    } else {
      this.library.splice(clamp(this.cursor, 0, this.library.length), 0, item);
    }
    this.invalidateNext();
    return true;
  }

  // Quita todo lo que venía después de la canción actual.
  clearUpcoming() {
    if (this.trans) return false;
    if (this.running) this.library.splice(this.index + 1);
    else this.library.length = 0;
    this.invalidateNext();
    return true;
  }

  // Reemplaza la cola (p. ej. "reproducir carpeta") y empieza por `startIdx`.
  replaceQueue(items, startIdx = 0) {
    this.stopTransitions();
    this.library.length = 0;
    this.library.push(...items);
    this.ready = -1;
    this.loadTok++;
    this.loadingIdx = -1;
    if (items.length) this.start(startIdx);
    else this.stop();
  }

  /* ── carga de la siguiente canción en el deck libre ── */

  preloadNext() {
    if (!this.running || this.trans) return;
    const n = this.nextIndex();
    if (n < 0 || n === this.ready || n === this.loadingIdx) return;
    this.load(n);
  }

  async load(i) {
    const d = this.idle;
    if (d.playing) return false;
    const tok = ++this.loadTok;
    this.ready = -1;
    this.loadingIdx = i;
    d.setSync(false);
    const ok = await d.load(this.library[i]);
    if (tok !== this.loadTok) return false;
    if (!ok) {
      // archivo ilegible: se quita de la cola para no bloquear la mezcla
      this.loadingIdx = -1;
      const at = this.library.indexOf(this.library[i]);
      if (at > this.index) this.library.splice(at, 1);
      this.changed();
      return false;
    }
    d.setTempoPct(0, true);
    this.loadingIdx = -1;
    this.ready = i;
    this.changed();
    return true;
  }

  /* ── transición ── */

  async begin(i) {
    if (this.trans) return;
    const t = { idx: i, phase: 'load' };
    this.trans = t;
    this.changed();
    if (this.ready !== i) {
      const ok = await this.load(i);
      if (this.trans !== t) return;
      if (!ok) { this.trans = null; this.changed(); return; }
    }
    t.phase = 'wait';
    t.since = performance.now();
    t.bar = null;
  }

  // Llamado en cada cuadro de animación.
  tick() {
    if (!this.running || this.held) return;
    const a = this.active;
    if (!a || !a.loaded) return;
    const now = performance.now();
    const dt = this.lastTick ? Math.min(0.1, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const t = this.trans;

    if (this.ramp) {
      const r = this.ramp;
      const p = clamp((now - r.t0) / r.dur, 0, 1);
      r.deck.setTempoPct(r.from * (1 - p), true);
      if (p >= 1) this.ramp = null;
    } else if (this.tempoMode === 'fixed') {
      // Durante una mezcla, la que entra va en SYNC y sigue a esta.
      this.glide(a, this.targetPct(a), dt);
    }

    if (t) {
      if (t.phase === 'wait') this.waitForBar(t, now);
      else if (t.phase === 'fade') this.stepFade(t, now);
      return;
    }

    const remain = this.remaining(a);
    const ended = !a.playing && a.position >= a.len - 2;
    const n = this.nextIndex();
    if (n < 0) {
      if (ended && !this.finished) { this.finished = true; this.changed(); }
      return;
    }
    this.finished = false;
    if (this.ready !== n) { this.preloadNext(); return; }
    const bar = this.canMatch(a, a.other) ? (4 * 60) / (a.bpm * a.tempo) : 0;
    if (ended || (a.playing && remain <= this.fade + bar + 0.3)) this.begin(n);
  }

  // Espera al inicio del siguiente compás para que la mezcla entre a tiempo.
  waitForBar(t, now) {
    const a = this.active;
    let go = !a.playing || !a.bpm || !this.beatmatch;
    if (!go) {
      const beats = (a.position - a.firstBeat * a.sr) / a.beatLen();
      const bar = Math.floor(beats / 4);
      if (t.bar != null && bar !== t.bar) go = true;
      t.bar = bar;
      if (now - t.since > 6000) go = true;
    }
    if (go) this.startFade(t, now);
  }

  startFade(t, now) {
    const a = this.active;
    const b = a.other;
    this.ramp = null;
    this.mixer.curve = 'smooth';
    const match = a.playing && this.canMatch(a, b);
    a.setSync(false);
    b.setSync(false);
    if (match) {
      b.setSync(true);
      b.matchTempo();
    } else {
      this.applyTempo(b, this.targetPct(b));
    }
    b.seek(b.cue);
    t.bassSwap = a.playing && this.fade > 0;
    if (t.bassSwap) this.setLow(b, -1);
    b.play(); // con SYNC activo, play() alinea la fase con el deck que suena
    t.phase = 'fade';
    t.from = a;
    t.to = b;
    t.t0 = now;
    t.dur = a.playing ? this.fade * 1000 : 0;
    t.p = 0;
    this.changed();
  }

  stepFade(t, now) {
    const p = t.dur ? clamp((now - t.t0) / t.dur, 0, 1) : 1;
    t.p = p;
    this.xfader.set(this.side(t.from) === 0 ? p : 1 - p);
    if (t.bassSwap) {
      const s = clamp((p - 0.4) / 0.2, 0, 1);
      this.setLow(t.from, -s);
      this.setLow(t.to, s - 1);
    }
    if (p >= 1) this.finish(t, now);
  }

  finish(t, now) {
    const a = t.from;
    const b = t.to;
    a.pause();
    a.setSync(false);
    b.setSync(false);
    this.setLow(a, 0);
    this.setLow(b, 0);
    this.active = b;
    this.index = t.idx;
    this.trans = null;
    this.ready = -1;
    if (this.tempoMode === 'match' && Math.abs(b.tempoPct) > 1e-4) this.ramp = { deck: b, from: b.tempoPct, t0: now, dur: RAMP_MS };
    this.changed();
    this.preloadNext();
  }
}
