// Reproducción automática de la lista con transiciones suaves (crossfade).
// Usa los dos decks por turnos: mientras uno suena, el otro prepara la
// siguiente canción. Al final de cada tema, la siguiente entra a tiempo con el
// compás, al mismo BPM, y se intercambian los graves a mitad de la mezcla
// para que los dos bombos no choquen.

const MAX_TEMPO_CHANGE = 0.08; // no se fuerza más de ±8 % para igualar BPM
const RAMP_MS = 20000;         // tras la mezcla, vuelve poco a poco a su tempo original

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class AutoMix {
  constructor({ decks, mixer, xfader, library, onChange }) {
    this.decks = decks;
    this.mixer = mixer;
    this.xfader = xfader;
    this.library = library;
    this.onChange = onChange;
    this.fade = 12;
    this.beatmatch = true;
    this.active = null;
    this.index = -1;
    this.ready = -1;
    this.loadingIdx = -1;
    this.loadTok = 0;
    this.startTok = 0;
    this.trans = null;
    this.ramp = null;
    this.held = null;
  }

  get running() { return this.index >= 0; }
  get idle() { return this.active ? this.active.other : this.decks[1]; }
  get isPlaying() { return this.running && !this.held && this.decks.some((d) => d.playing); }
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
    if (!this.beatmatch || !a.bpm || !b.bpm) return false;
    return Math.abs(b.syncRatio() - 1) <= MAX_TEMPO_CHANGE;
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
    const tok = ++this.startTok;
    await d.load(this.library[i]);
    if (tok !== this.startTok) return;
    d.setTempoPct(0, true);
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
      if (this.library.length) this.start(0);
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
    this.ready = -1;
    this.loadTok++;
    this.loadingIdx = -1;
    this.changed();
    this.preloadNext();
    return true;
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
    await d.load(this.library[i]);
    if (tok !== this.loadTok) return false;
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

    if (this.ramp) {
      const r = this.ramp;
      const p = clamp((now - r.t0) / r.dur, 0, 1);
      r.deck.setTempoPct(r.from * (1 - p), true);
      if (p >= 1) this.ramp = null;
    }

    const t = this.trans;
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
      b.setTempoPct(0, true);
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
    if (Math.abs(b.tempoPct) > 1e-4) this.ramp = { deck: b, from: b.tempoPct, t0: now, dur: RAMP_MS };
    this.changed();
    this.preloadNext();
  }
}
