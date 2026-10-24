import { Knob, Fader, press } from './ui.js';
import { analyzeBuffer, renderOverview, FPS, LAYERS } from './analysis.js';
import { AutoMix, fitPct } from './automix.js';

const SEC_PER_REV = 1.8; // 33⅓ rpm: una vuelta de jog = 1,8 s de audio
const RANGES = [0.06, 0.10, 0.16, 0.50];
const ZOOMS = [6, 10, 16, 3]; // segundos visibles en la forma de onda grande
const HOT_COLORS = ['#28e214', '#ff127b', '#00d8ff', '#ffa400', '#a64dff', '#ff4141', '#30ffb0', '#ffe600'];
const LOOP_PADS = [1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32];
const ROLL_PADS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
const JUMP_PADS = [-1, 1, -4, 4, -8, 8, -16, 16];
const DPR = Math.min(2, window.devicePixelRatio || 1);

let ctx, mixer, automix, xfaderCtl;
const decks = [];
const settings = { quantize: true, zoom: 0 };
const library = [];
let libTarget = null;

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtBeats = (b) => (b >= 1 ? String(b) : '1/' + Math.round(1 / b));
const smooth = (param, v) => param.setTargetAtTime(v, ctx.currentTime, 0.012);

function fmtTime(sec, sign) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const t = Math.floor((sec * 10) % 10);
  return `${sign}${m}:${String(s).padStart(2, '0')}.${t}`;
}

function fit(cv) {
  const w = Math.round(cv.clientWidth * DPR);
  const h = Math.round(cv.clientHeight * DPR);
  if (w && h && (cv.width !== w || cv.height !== h)) {
    cv.width = w;
    cv.height = h;
    return true;
  }
  return false;
}

function setText(cache, key, el, text) {
  if (cache[key] !== text) { cache[key] = text; el.textContent = text; }
}

/* ───────────────────────────── Mezclador ───────────────────────────── */

class Channel {
  constructor(dest) {
    this.input = ctx.createGain();
    this.hi = ctx.createBiquadFilter();
    this.hi.type = 'highshelf';
    this.hi.frequency.value = 3200;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.7;
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 220;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 10;
    this.fader = ctx.createGain();
    this.xf = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.level = 0;

    this.input.connect(this.low);
    this.low.connect(this.mid);
    this.mid.connect(this.hi);
    this.hi.connect(this.lp);
    this.lp.connect(this.hp);
    this.hp.connect(this.fader);
    this.fader.connect(this.xf);
    this.fader.connect(this.analyser);
    this.xf.connect(dest);
  }

  setTrim(v) { smooth(this.input.gain, Math.pow(10, (v * 12) / 20)); }

  // -1 = corte total (kill), 0 = plano, +1 = +6 dB
  setEq(band, v) {
    const db = v >= 0 ? v * 6 : v <= -0.98 ? -60 : v * 30;
    smooth(this[band].gain, db);
  }

  // Filtro tipo "COLOR FX": izquierda pasa-bajos, derecha pasa-altos.
  setFilter(v) {
    const q = 0.707 + Math.abs(v) * 3;
    if (v < 0) {
      smooth(this.lp.frequency, 20000 * Math.pow(0.003, -v));
      smooth(this.hp.frequency, 10);
    } else {
      smooth(this.lp.frequency, 20000);
      smooth(this.hp.frequency, 10 * Math.pow(1500, v));
    }
    smooth(this.lp.Q, v < 0 ? q : 0.707);
    smooth(this.hp.Q, v > 0 ? q : 0.707);
  }

  setFader(v) { smooth(this.fader.gain, v * v); }

  meter() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let pk = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const a = Math.abs(this.buf[i]);
      if (a > pk) pk = a;
    }
    const db = 20 * Math.log10(pk + 1e-9);
    const l = clamp((db + 42) / 42, 0, 1);
    this.level = Math.max(l, this.level - 0.025);
    return this.level;
  }
}

class Mixer {
  constructor() {
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.recDest = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
    if (this.recDest) this.limiter.connect(this.recDest);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.limiter.connect(this.analyser);
    this.channels = [new Channel(this.master), new Channel(this.master)];
    this.curve = 'smooth';
    this.x = 0.5;
    this.masterLevel = { analyser: this.analyser, buf: new Float32Array(1024), level: 0 };
    this.setCrossfader(0.5);
  }

  setCrossfader(x) {
    this.x = x;
    let a, b;
    if (this.curve === 'smooth') {
      a = Math.cos((x * Math.PI) / 2);
      b = Math.sin((x * Math.PI) / 2);
    } else {
      // curva de corte rápido para scratch
      a = clamp((1 - x) / 0.06, 0, 1);
      b = clamp(x / 0.06, 0, 1);
    }
    smooth(this.channels[0].xf.gain, a);
    smooth(this.channels[1].xf.gain, b);
  }

  setMaster(v) { smooth(this.master.gain, v * v * 1.2); }
}

/* ─────────────────────────────── Deck ─────────────────────────────── */

function deckTemplate(id) {
  const pads = Array.from({ length: 8 }, (_, i) => `<button class="pad" data-pad="${i}"><span></span></button>`).join('');
  return `
  <div class="deck-info">
    <div class="deck-id">${id}</div>
    <div class="track">
      <div class="title" data-ref="title">Toca aquí para cargar una canción</div>
      <div class="slot"><canvas class="overview" data-ref="overview"></canvas></div>
    </div>
    <div class="readout">
      <div class="time" data-ref="time">-0:00.0</div>
      <div class="bpm" data-ref="bpm">---.-</div>
      <div class="pitch" data-ref="pitch">0.0%</div>
    </div>
  </div>
  <div class="deck-body">
    <div class="transport">
      <button class="btn mini" data-ref="sync">SYNC</button>
      <button class="btn round cue" data-ref="cue">CUE</button>
      <button class="btn round play" data-ref="play">▶︎ ❚❚</button>
    </div>
    <div class="jog-wrap" data-ref="jogWrap">
      <div class="jog" data-ref="jog">
        <div class="jog-ring"></div>
        <div class="platter" data-ref="platter"><div class="marker"></div></div>
        <div class="jog-progress" data-ref="progress"></div>
        <div class="jog-center"><b>${id}</b><span data-ref="jogInfo">VINYL</span></div>
      </div>
    </div>
    <div class="tempo">
      <button class="btn mini" data-ref="range">±10%</button>
      <span class="tempo-sign">−</span>
      <div class="tempo-fader" data-ref="tempoFader"></div>
      <span class="tempo-sign">+</span>
      <button class="btn mini on" data-ref="vinyl">VINYL</button>
    </div>
  </div>
  <div class="loop-row">
    <button class="btn mini shift" data-ref="shift">SHIFT</button>
    <button class="btn mini" data-ref="loopIn">IN</button>
    <button class="btn mini" data-ref="loopOut">OUT</button>
    <button class="btn mini" data-ref="loopAuto">4 BEAT</button>
    <button class="btn mini" data-ref="loopHalf">½X</button>
    <button class="btn mini" data-ref="loopDouble">2X</button>
  </div>
  <div class="pad-modes" data-ref="padModes">
    <button class="on" data-mode="hotcue">HOT CUE</button>
    <button data-mode="loop">BEAT LOOP</button>
    <button data-mode="roll">ROLL</button>
    <button data-mode="jump">BEAT JUMP</button>
  </div>
  <div class="pads">${pads}</div>`;
}

class Deck {
  constructor(id, root, channel, waveCanvas) {
    this.id = id;
    this.root = root;
    this.channel = channel;
    this.waveCanvas = waveCanvas;
    this.color = id === 'A' ? '#2c8cff' : '#ff8a1f';
    root.style.setProperty('--deck', this.color);
    root.innerHTML = deckTemplate(id);
    this.ui = {};
    root.querySelectorAll('[data-ref]').forEach((el) => { this.ui[el.dataset.ref] = el; });
    this.pads = [...root.querySelectorAll('.pad')];

    this.node = new AudioWorkletNode(ctx, 'deck-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.connect(channel.input);
    this.node.port.onmessage = (e) => this.onWorklet(e.data);

    this.sr = ctx.sampleRate;
    this.seq = 0;
    this.range = 0.10;
    this.tempoPct = 0;
    this.vinyl = true;
    this.sync = false;
    this.shift = false;
    this.padMode = 'hotcue';
    this.autoBeats = 4;
    this.showRemain = true;
    this.cache = {};
    this.jogTouch = null;
    this.clear();
    this.bindUI();
    this.renderPads();
  }

  clear() {
    this.loaded = false;
    this.len = 0;
    this.pos = 0;
    this.rate = 0;
    this.stamp = 0;
    this.playing = false;
    this.previewing = false;
    this.hotPreview = null;
    this.latched = false;
    this.cue = 0;
    this.hot = new Array(8).fill(null);
    this.loop = { in: null, out: null, on: false };
    this.loopPad = null;
    this.roll = null;
    this.wave = null;
    this.bpm = 0;
    this.baseBpm = 0;
    this.firstBeat = 0;
    this.ovBase = null;
  }

  post(msg, transfer) { this.node.port.postMessage(msg, transfer || []); }

  get tempo() { return 1 + this.tempoPct; }

  get position() {
    if (!this.loaded) return 0;
    const dt = Math.min(0.06, (performance.now() - this.stamp) / 1000);
    return clamp(this.pos + this.rate * this.sr * dt, 0, this.len - 1);
  }

  onWorklet(m) {
    if (m.type !== 'pos' || m.seq !== this.seq) return;
    this.pos = m.pos;
    this.rate = m.rate;
    this.stamp = performance.now();
    if (m.ended) {
      this.playing = false;
      this.previewing = false;
      this.hotPreview = null;
    }
  }

  /* ── carga ── */

  async load(item) {
    this.pause();
    this.ui.title.textContent = 'Cargando… ' + item.name;
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(await item.file.arrayBuffer());
    } catch (err) {
      this.ui.title.textContent = 'No se pudo leer: ' + item.name;
      return;
    }
    if (!item.info) {
      this.ui.title.textContent = 'Analizando BPM… ' + item.name;
      await new Promise((r) => setTimeout(r, 30));
      item.info = analyzeBuffer(buffer);
      item.bpm = item.info.bpm;
      renderLibrary();
    }
    const info = item.info;
    const left = buffer.getChannelData(0).slice();
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left;
    const transfer = right === left ? [left.buffer] : [left.buffer, right.buffer];

    this.clear();
    this.sr = buffer.sampleRate;
    this.len = left.length;
    this.loaded = true;
    this.item = item;
    this.wave = info;
    this.bpm = info.bpm;
    this.baseBpm = info.bpm;
    this.firstBeat = info.firstBeat;
    this.cue = Math.round(this.firstBeat * this.sr);
    this.pos = this.cue;
    this.stamp = performance.now();
    this.seq++;
    this.post({ type: 'load', left, right, pos: this.cue, seq: this.seq }, transfer);
    this.post({ type: 'tempo', value: this.tempo });
    this.ui.title.textContent = item.name;
    if (this.sync) this.matchTempo();
    this.renderPads();
  }

  /* ── transporte ── */

  play() {
    if (!this.loaded || this.position >= this.len - 2) return;
    this.playing = true;
    this.post({ type: 'play' });
    if (this.sync) this.alignPhase();
    keepAwake();
  }

  pause() {
    this.playing = false;
    this.post({ type: 'pause' });
  }

  seek(s) {
    if (!this.loaded) return;
    s = clamp(s, 0, this.len - 2);
    this.seq++;
    this.pos = s;
    this.stamp = performance.now();
    this.post({ type: 'seek', pos: s, seq: this.seq });
  }

  onPlay() {
    if (!this.loaded) { openLibrary(this); return; }
    if (this.previewing || this.hotPreview != null) { this.latched = true; return; }
    if (this.playing) this.pause(); else this.play();
  }

  // Comportamiento de CUE estilo CDJ.
  onCueDown() {
    if (!this.loaded) return;
    if (this.shift) { this.seek(0); return; }
    if (this.playing) {
      this.pause();
      this.seek(this.cue);
      return;
    }
    const p = this.position;
    if (Math.abs(p - this.cue) > this.sr * 0.01) {
      this.cue = this.quantized(p);
      this.seek(this.cue);
    }
    this.previewing = true;
    this.latched = false;
    this.play();
  }

  onCueUp() {
    if (!this.previewing) return;
    this.previewing = false;
    if (this.latched) { this.latched = false; return; }
    this.pause();
    this.seek(this.cue);
  }

  /* ── tempo y sync ── */

  setTempoPct(pct, moveFader) {
    this.tempoPct = pct;
    this.post({ type: 'tempo', value: this.tempo });
    if (moveFader) this.tempoFader.set(0.5 - pct / (2 * this.range), true);
  }

  onTempoFader(v) {
    if (this.sync) this.setSync(false);
    this.setTempoPct((0.5 - v) * 2 * this.range, false);
  }

  cycleRange() {
    const i = (RANGES.indexOf(this.range) + 1) % RANGES.length;
    this.setRange(RANGES[i]);
  }

  setRange(r) {
    this.range = r;
    this.ui.range.textContent = r >= 0.5 ? 'WIDE' : `±${Math.round(r * 100)}%`;
    this.setTempoPct(clamp(this.tempoPct, -r, r), true);
  }

  setSync(on) {
    this.sync = on;
    this.ui.sync.classList.toggle('on', on);
  }

  toggleSync() {
    if (this.sync) { this.setSync(false); return; }
    const o = this.other;
    if (!this.loaded || !this.bpm || !o.loaded || !o.bpm) {
      this.ui.sync.classList.add('deny');
      setTimeout(() => this.ui.sync.classList.remove('deny'), 400);
      return;
    }
    this.setSync(true);
    o.setSync(false);
    this.matchTempo();
    if (this.playing && o.playing) this.alignPhase();
  }

  // Ratio de tempo para igualar al otro deck (admite doble/mitad de BPM).
  syncRatio() {
    const target = this.other.bpm * this.other.tempo;
    const r = target / this.bpm;
    return [r, r * 2, r / 2].reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a));
  }

  matchTempo() {
    if (!this.other.loaded || !this.other.bpm || !this.bpm) return;
    const pct = this.syncRatio() - 1;
    if (Math.abs(pct) > this.range) {
      const fit = RANGES.find((r) => r >= Math.abs(pct));
      if (!fit) { this.setSync(false); return; }
      this.setRange(fit);
    }
    if (Math.abs(pct - this.tempoPct) > 1e-6) this.setTempoPct(pct, true);
  }

  beatPhase() {
    const beat = (60 / this.bpm) * this.sr;
    const x = (this.position - this.firstBeat * this.sr) / beat;
    return x - Math.floor(x);
  }

  alignPhase() {
    const o = this.other;
    if (!o.loaded || !o.bpm || !this.bpm || !o.playing) return;
    let diff = o.beatPhase() - this.beatPhase();
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    this.seek(this.position + diff * this.beatLen());
  }

  /* ── beats, quantize y loops ── */

  beatLen() { return (60 / (this.bpm || 120)) * this.sr; }

  nearestBeat(s, unit = 1) {
    const step = this.beatLen() * unit;
    const fb = this.firstBeat * this.sr;
    return fb + Math.round((s - fb) / step) * step;
  }

  floorBeat(s, unit = 1) {
    const step = this.beatLen() * unit;
    const fb = this.firstBeat * this.sr;
    return fb + Math.floor((s - fb) / step + 1e-6) * step;
  }

  quantized(s) {
    return settings.quantize && this.bpm ? Math.max(0, this.nearestBeat(s)) : s;
  }

  setLoop(start, end) {
    this.loop = { in: start, out: end, on: true };
    this.post({ type: 'loop', on: true, start, end });
  }

  exitLoop() {
    this.loop.on = false;
    this.loopPad = null;
    this.post({ type: 'loop', on: false });
  }

  beatLoop(beats) {
    const p = this.position;
    const start = settings.quantize && this.bpm ? Math.max(0, this.floorBeat(p, Math.min(1, beats))) : p;
    this.setLoop(start, start + beats * this.beatLen());
  }

  onLoopIn() {
    if (!this.loaded) return;
    if (this.loop.on) this.exitLoop();
    this.loop.in = this.quantized(this.position);
    this.loop.out = null;
  }

  onLoopOut() {
    if (!this.loaded) return;
    if (this.loop.on) { this.exitLoop(); return; }
    if (this.loop.in == null) return;
    const out = this.quantized(this.position);
    if (out > this.loop.in + this.sr * 0.02) this.setLoop(this.loop.in, out);
  }

  onLoopAuto() {
    if (!this.loaded) return;
    if (this.shift) { this.reloop(); return; }
    if (this.loop.on) { this.exitLoop(); return; }
    this.beatLoop(this.autoBeats);
  }

  reloop() {
    if (this.loop.in == null || this.loop.out == null) return;
    this.setLoop(this.loop.in, this.loop.out);
    this.seek(this.loop.in);
  }

  resizeLoop(f) {
    if (this.loop.on) {
      const len = (this.loop.out - this.loop.in) * f;
      if (len < this.beatLen() / 32 || len > this.beatLen() * 64) return;
      this.setLoop(this.loop.in, this.loop.in + len);
    } else {
      this.autoBeats = clamp(this.autoBeats * f, 1 / 32, 32);
      this.ui.loopAuto.textContent = `${fmtBeats(this.autoBeats)} BEAT`;
    }
  }

  jumpTo(t) {
    if (settings.quantize && this.bpm && this.playing) {
      const p = this.position;
      t = this.nearestBeat(t) + (p - this.nearestBeat(p));
    }
    if (this.loop.on && (t < this.loop.in || t >= this.loop.out)) this.exitLoop();
    this.seek(t);
  }

  beatJump(beats) {
    const d = beats * this.beatLen();
    if (this.loop.on) this.setLoop(this.loop.in + d, this.loop.out + d);
    this.seek(this.position + d);
  }

  /* ── pads ── */

  setPadMode(mode) {
    if (this.roll) this.rollEnd();
    this.padMode = mode;
    this.ui.padModes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    this.renderPads();
  }

  padDown(i) {
    if (!this.loaded) { openLibrary(this); return; }
    switch (this.padMode) {
      case 'hotcue':
        if (this.shift) { this.hot[i] = null; break; }
        if (this.hot[i] == null) { this.hot[i] = this.quantized(this.position); break; }
        if (this.playing && this.hotPreview == null) {
          this.jumpTo(this.hot[i]);
        } else {
          // en pausa: suena mientras se mantiene pulsado
          if (this.loop.on) this.exitLoop();
          this.seek(this.hot[i]);
          this.hotPreview = i;
          this.latched = false;
          this.play();
        }
        break;
      case 'loop':
        if (this.loop.on && this.loopPad === i) { this.exitLoop(); break; }
        this.beatLoop(LOOP_PADS[i]);
        this.loopPad = i;
        break;
      case 'roll':
        this.rollStart(i);
        break;
      case 'jump':
        this.beatJump(JUMP_PADS[i]);
        break;
    }
    this.renderPads();
  }

  padUp(i) {
    if (this.padMode === 'hotcue' && this.hotPreview === i) {
      this.hotPreview = null;
      if (this.latched) this.latched = false;
      else { this.pause(); this.seek(this.hot[i]); }
    }
    if (this.padMode === 'roll' && this.roll && this.roll.pad === i) this.rollEnd();
    this.renderPads();
  }

  // Loop roll: al soltar, la pista sigue donde habría estado (como "slip").
  rollStart(i) {
    if (this.roll) this.rollEnd();
    this.roll = { pad: i, pos: this.position, t: performance.now(), prev: { ...this.loop }, playing: this.playing };
    this.beatLoop(ROLL_PADS[i]);
  }

  rollEnd() {
    const r = this.roll;
    this.roll = null;
    const elapsed = (performance.now() - r.t) / 1000;
    const back = r.pos + (this.playing ? elapsed * this.tempo * this.sr : 0);
    if (r.prev.on) this.setLoop(r.prev.in, r.prev.out);
    else { this.exitLoop(); this.loop = r.prev; }
    this.seek(back);
  }

  renderPads() {
    this.pads.forEach((pad, i) => {
      const label = pad.firstElementChild;
      let text = '', color = null, active = false;
      switch (this.padMode) {
        case 'hotcue':
          text = 'ABCDEFGH'[i];
          if (this.hot[i] != null) color = HOT_COLORS[i];
          active = this.hotPreview === i;
          break;
        case 'loop':
          text = fmtBeats(LOOP_PADS[i]);
          color = '#ff9a1f';
          active = this.loop.on && this.loopPad === i;
          break;
        case 'roll':
          text = fmtBeats(ROLL_PADS[i]);
          color = '#00d8ff';
          active = this.roll && this.roll.pad === i;
          break;
        case 'jump': {
          const b = JUMP_PADS[i];
          text = (b < 0 ? '◀ ' : '▶ ') + Math.abs(b);
          color = '#a64dff';
          break;
        }
      }
      label.textContent = text;
      pad.classList.toggle('set', !!color);
      pad.classList.toggle('active', !!active);
      if (color) {
        pad.style.setProperty('--c', color);
        pad.style.setProperty('--c-dim', color + '40');
      }
    });
  }

  /* ── interfaz ── */

  bindUI() {
    const u = this.ui;
    press(u.play, () => this.onPlay());
    press(u.cue, () => this.onCueDown(), () => this.onCueUp());
    press(u.sync, () => this.toggleSync());
    press(u.vinyl, () => {
      this.vinyl = !this.vinyl;
      u.vinyl.classList.toggle('on', this.vinyl);
      u.jogInfo.textContent = this.vinyl ? 'VINYL' : 'CDJ';
    });
    press(u.shift, () => { this.shift = true; u.shift.classList.add('on'); }, () => { this.shift = false; u.shift.classList.remove('on'); });
    press(u.range, () => this.cycleRange());
    press(u.loopIn, () => this.onLoopIn());
    press(u.loopOut, () => this.onLoopOut());
    press(u.loopAuto, () => this.onLoopAuto());
    press(u.loopHalf, () => this.resizeLoop(0.5));
    press(u.loopDouble, () => this.resizeLoop(2));
    u.padModes.querySelectorAll('button').forEach((b) => press(b, () => this.setPadMode(b.dataset.mode)));
    this.pads.forEach((pad, i) => press(pad, () => this.padDown(i), () => this.padUp(i)));
    press(u.title, () => openLibrary(this));
    press(u.time, () => { this.showRemain = !this.showRemain; });
    // SHIFT + toque en el BPM: alterna doble / mitad (por si el análisis se equivocó de octava)
    press(u.bpm, () => {
      if (!this.shift || !this.baseBpm) return;
      const opts = [this.baseBpm, this.baseBpm * 2, this.baseBpm / 2];
      const i = (opts.indexOf(this.bpm) + 1) % opts.length;
      this.bpm = opts[i];
    });

    this.tempoFader = new Fader(u.tempoFader, {
      vertical: true, value: 0.5, def: 0.5, mode: 'relative', detent: 0.5, resettable: true,
      onChange: (v) => this.onTempoFader(v),
    });

    // Needle search sobre la vista general
    const ov = u.overview;
    let needle = null;
    const seekFromX = (e) => {
      const r = ov.getBoundingClientRect();
      const t = clamp((e.clientX - r.left) / r.width, 0, 1) * this.len;
      if (this.loop.on && (t < this.loop.in || t >= this.loop.out)) this.exitLoop();
      this.seek(t);
    };
    ov.addEventListener('pointerdown', (e) => {
      if (!this.loaded) return;
      e.preventDefault();
      ov.setPointerCapture(e.pointerId);
      needle = e.pointerId;
      seekFromX(e);
    });
    ov.addEventListener('pointermove', (e) => { if (needle === e.pointerId) seekFromX(e); });
    ov.addEventListener('pointerup', () => { needle = null; });
    ov.addEventListener('pointercancel', () => { needle = null; });

    this.bindJog();

    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      u.jog.style.setProperty('--jog', `${Math.floor(Math.min(width, height))}px`);
    }).observe(u.jogWrap);
  }

  bindJog() {
    const jog = this.ui.jog;
    const angleOf = (e, t) => Math.atan2(e.clientY - t.cy, e.clientX - t.cx);

    jog.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.jogTouch || !this.loaded) return;
      jog.setPointerCapture(e.pointerId);
      const r = jog.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy) / (r.width / 2);
      // VINYL: tocar la superficie = scratch; el aro exterior = pitch bend.
      const mode = !this.playing || (this.vinyl && dist < 0.8) ? 'scratch' : 'bend';
      const t = { id: e.pointerId, cx, cy, mode, accum: 0, vel: 0 };
      t.angle = angleOf(e, t);
      this.jogTouch = t;
      if (mode === 'scratch') this.post({ type: 'scratch', on: true });
      jog.classList.add('touched');
    });

    jog.addEventListener('pointermove', (e) => {
      const t = this.jogTouch;
      if (!t || t.id !== e.pointerId) return;
      const a = angleOf(e, t);
      let d = a - t.angle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      t.angle = a;
      if (t.mode === 'scratch') {
        const mult = this.shift ? 8 : 1; // SHIFT + jog = búsqueda rápida
        this.post({ type: 'scratchMove', delta: (d / (2 * Math.PI)) * SEC_PER_REV * this.sr * mult });
      } else {
        t.accum += d;
      }
    });

    const end = (e) => {
      const t = this.jogTouch;
      if (!t || t.id !== e.pointerId) return;
      if (t.mode === 'scratch') this.post({ type: 'scratch', on: false });
      else this.post({ type: 'bend', value: 0 });
      this.jogTouch = null;
      jog.classList.remove('touched');
    };
    jog.addEventListener('pointerup', end);
    jog.addEventListener('pointercancel', end);
  }

  /* ── cuadro de animación ── */

  frame(dt, draw) {
    const u = this.ui;
    const c = this.cache;
    const t = this.jogTouch;
    if (t && t.mode === 'bend' && dt > 0) {
      const revPerSec = t.accum / (2 * Math.PI) / dt;
      t.accum = 0;
      t.vel = t.vel * 0.6 + revPerSec * 0.4;
      this.post({ type: 'bend', value: clamp(t.vel * 0.12, -0.5, 0.5) });
    }
    if (this.sync) this.matchTempo();
    if (!draw) return;

    const p = this.position;
    const sec = p / this.sr;
    u.platter.style.transform = `rotate(${((sec / SEC_PER_REV) * 360) % 360}deg)`;

    if (this.loaded) {
      const dur = this.len / this.sr;
      const remain = dur - sec;
      setText(c, 'time', u.time, this.showRemain ? fmtTime(remain, '-') : fmtTime(sec, ''));
      setText(c, 'bpm', u.bpm, this.bpm ? (this.bpm * this.tempo).toFixed(1) : '---.-');
      u.progress.style.setProperty('--p', (sec / dur).toFixed(4));
      const warn = remain < 30 && remain > 0;
      if (c.warn !== warn) { c.warn = warn; this.root.classList.toggle('ending', warn); }
    }
    const pct = this.tempoPct * 100;
    setText(c, 'pitch', u.pitch, `${pct > 0.005 ? '+' : ''}${pct.toFixed(Math.abs(pct) < 10 ? 2 : 1)}%`);

    const playLit = this.playing ? 'lit' : this.loaded ? 'blink' : '';
    if (c.play !== playLit) { c.play = playLit; u.play.classList.remove('lit', 'blink'); if (playLit) u.play.classList.add(playLit); }
    const atCue = Math.abs(p - this.cue) < this.sr * 0.01;
    const cueLit = !this.loaded ? '' : this.playing && !this.previewing ? '' : atCue ? 'lit' : 'blink';
    if (c.cue !== cueLit) { c.cue = cueLit; u.cue.classList.remove('lit', 'blink'); if (cueLit) u.cue.classList.add(cueLit); }
    const loopOn = this.loop.on;
    if (c.loop !== loopOn) {
      c.loop = loopOn;
      u.loopAuto.classList.toggle('on', loopOn);
      u.loopOut.classList.toggle('on', loopOn);
      this.renderPads();
    }
    const inSet = this.loop.in != null && !loopOn;
    if (c.inSet !== inSet) { c.inSet = inSet; u.loopIn.classList.toggle('blink-on', inSet); }

    this.drawOverview(p);
    this.drawZoom(p);
  }

  drawOverview(p) {
    const cv = this.ui.overview;
    const resized = fit(cv);
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    if (!this.loaded) return;
    if (resized || !this.ovBase) {
      this.ovBase = document.createElement('canvas');
      this.ovBase.width = W;
      this.ovBase.height = H;
      renderOverview(this.ovBase, this.wave);
    }
    c.drawImage(this.ovBase, 0, 0);
    const x = (p / this.len) * W;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, 0, x, H);
    if (this.loop.on) {
      c.fillStyle = 'rgba(255,170,0,0.35)';
      const a = (this.loop.in / this.len) * W;
      c.fillRect(a, 0, Math.max(2, ((this.loop.out - this.loop.in) / this.len) * W), H);
    }
    this.hot.forEach((h, i) => {
      if (h == null) return;
      c.fillStyle = HOT_COLORS[i];
      c.fillRect((h / this.len) * W - DPR, 0, 2 * DPR, H * 0.35);
    });
    c.fillStyle = '#ff8c00';
    const cx = (this.cue / this.len) * W;
    c.beginPath();
    c.moveTo(cx, H * 0.62);
    c.lineTo(cx + 4 * DPR, H);
    c.lineTo(cx - 4 * DPR, H);
    c.fill();
    c.fillStyle = '#ff2b2b';
    c.fillRect(x - DPR, 0, 2 * DPR, H);
  }

  drawZoom(p) {
    const cv = this.waveCanvas;
    fit(cv);
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    c.fillStyle = '#050607';
    c.fillRect(0, 0, W, H);
    c.font = `700 ${Math.round(H * 0.28)}px system-ui, sans-serif`;
    c.textBaseline = 'top';
    if (!this.loaded) {
      c.fillStyle = '#39404a';
      c.textAlign = 'center';
      c.fillText(`DECK ${this.id} · sin canción`, W / 2, H * 0.36);
      return;
    }
    const w = this.wave;
    const n = w.low.length;
    const span = ZOOMS[settings.zoom];
    const spp = span / W;
    const t0 = p / this.sr - span / 2;
    const midY = H / 2;

    if (this.loop.on) {
      const a = (this.loop.in / this.sr - t0) / spp;
      const b = (this.loop.out / this.sr - t0) / spp;
      c.fillStyle = 'rgba(255,170,0,0.2)';
      c.fillRect(a, 0, b - a, H);
    }

    for (const [key, color, scale] of LAYERS) {
      const arr = w[key];
      c.beginPath();
      for (let x = 0; x < W; x++) {
        const b = Math.floor((t0 + x * spp) * FPS);
        if (b < 0 || b >= n) continue;
        const h = arr[b] * scale * midY * 0.94;
        if (h > 0.4) c.rect(x, midY - h, 1, h * 2);
      }
      c.fillStyle = color;
      c.fill();
    }

    if (this.bpm) {
      const bs = 60 / this.bpm;
      for (let k = Math.ceil((t0 - this.firstBeat) / bs); ; k++) {
        const tb = this.firstBeat + k * bs;
        if (tb > t0 + span) break;
        const x = Math.round((tb - t0) / spp);
        const bar = ((k % 4) + 4) % 4 === 0;
        c.fillStyle = bar ? 'rgba(255,60,60,0.85)' : 'rgba(255,255,255,0.35)';
        c.fillRect(x, 0, bar ? 2 * DPR : DPR, H);
      }
    }

    const mark = (s, color, label) => {
      const x = (s / this.sr - t0) / spp;
      if (x < -20 || x > W + 20) return;
      c.fillStyle = color;
      c.fillRect(x - DPR, 0, 2 * DPR, H);
      if (label) {
        c.textAlign = 'left';
        c.fillRect(x, 0, H * 0.3, H * 0.3);
        c.fillStyle = '#000';
        c.font = `800 ${Math.round(H * 0.24)}px system-ui, sans-serif`;
        c.fillText(label, x + H * 0.06, H * 0.03);
      }
    };
    mark(this.cue, '#ff8c00', '');
    this.hot.forEach((h, i) => { if (h != null) mark(h, HOT_COLORS[i], 'ABCDEFGH'[i]); });

    c.fillStyle = '#ffffff';
    c.fillRect(W / 2 - DPR, 0, 2 * DPR, H);

    c.textAlign = 'left';
    c.font = `800 ${Math.round(H * 0.26)}px system-ui, sans-serif`;
    c.fillStyle = this.color;
    c.fillText(this.id, 6 * DPR, H - H * 0.32);
  }
}

/* ───────────────────────────── Biblioteca ───────────────────────────── */

const AUDIO_EXT = /\.(mp3|m4a|aac|mp4|wav|flac|ogg|oga|opus|aif|aiff|webm|wma)$/i;

function addFiles(files) {
  const added = [];
  for (const f of files) {
    if (!(f.type.startsWith('audio') || AUDIO_EXT.test(f.name))) continue;
    const item = { file: f, name: f.name.replace(/\.[^.]+$/, ''), bpm: null, info: null };
    library.push(item);
    added.push(item);
  }
  renderLibrary();
  if (added.length && libTarget) {
    const target = libTarget;
    closeLibrary();
    automix.stop();
    target.load(added[0]);
  }
}

function renderLibrary() {
  if (automix) {
    renderPlayerList();
    automix.preloadNext();
  }
  const list = $('#lib-list');
  $('#library').classList.toggle('empty', library.length === 0);
  list.innerHTML = library.map((it, i) => `
    <li data-i="${i}">
      <span class="lib-name">${escapeHtml(it.name)}</span>
      <span class="lib-bpm">${it.bpm ? it.bpm.toFixed(1) : ''}</span>
      <button class="btn mini deck-a" data-load="0" data-i="${i}">A</button>
      <button class="btn mini deck-b" data-load="1" data-i="${i}">B</button>
    </li>`).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function openLibrary(deck) {
  libTarget = deck || null;
  $('#lib-target').textContent = deck ? `→ cargar en DECK ${deck.id}` : '';
  $('#library').hidden = false;
}

function closeLibrary() {
  $('#library').hidden = true;
  libTarget = null;
}

function bindLibrary() {
  $('#file-input').addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
  $('#lib-close').addEventListener('click', closeLibrary);
  $('#lib-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-load]');
    const li = e.target.closest('li');
    if (!li) return;
    const item = library[+li.dataset.i];
    const deck = btn ? decks[+btn.dataset.load] : libTarget;
    if (!deck) return;
    automix.stop();
    closeLibrary();
    deck.load(item);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

/* ─────────────────────────── Reproductor simple ─────────────────────────── */

const playerCache = {};

function loadPrefs() {
  try {
    const fade = localStorage.getItem('musica.fade');
    const mode = localStorage.getItem('musica.tempoMode');
    const bpm = localStorage.getItem('musica.masterBpm');
    if (fade != null) automix.fade = +fade;
    if (mode) automix.tempoMode = mode;
    if (bpm != null) automix.masterBpm = +bpm;
  } catch { /* sin almacenamiento */ }
}

function savePrefs() {
  try {
    localStorage.setItem('musica.fade', String(automix.fade));
    localStorage.setItem('musica.tempoMode', automix.tempoMode);
    localStorage.setItem('musica.masterBpm', String(automix.masterBpm));
  } catch { /* sin almacenamiento */ }
}

const MODE_HELP = {
  original: 'Cada canción a su BPM. Solo se mezcla el volumen.',
  match: 'La siguiente entra al BPM de la anterior y luego vuelve poco a poco a su BPM real.',
  fixed: 'Todas las canciones se ajustan al BPM del set (hasta ±16 %).',
};

function renderPrefs() {
  $('#p-fade').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === automix.fade));
  $('#p-mode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === automix.tempoMode));
  $('#player').classList.toggle('fixed', automix.tempoMode === 'fixed');
  $('#p-mode-help').textContent = MODE_HELP[automix.tempoMode];
  const input = $('#p-bpm');
  if (document.activeElement !== input) input.value = automix.masterBpm.toFixed(1);
}

function showPlayer(on) {
  $('#player').hidden = !on;
}

function bindPlayer() {
  loadPrefs();
  renderPrefs();
  $('#player-input').addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
  $('#p-play').addEventListener('click', () => automix.toggle());
  $('#p-next').addEventListener('click', () => automix.next());
  $('#p-prev').addEventListener('click', () => automix.prev());
  $('#p-fade').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    automix.fade = +b.dataset.s;
    savePrefs();
    renderPrefs();
  });
  $('#p-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    automix.setTempoMode(b.dataset.m);
    savePrefs();
    renderPrefs();
  });
  const setBpm = (v) => {
    automix.setMasterBpm(v);
    savePrefs();
    renderPrefs();
  };
  $('#p-master').querySelectorAll('.p-step').forEach((b) => {
    b.addEventListener('click', () => setBpm(automix.masterBpm + +b.dataset.d));
  });
  $('#p-bpm').addEventListener('change', (e) => setBpm(parseFloat(String(e.target.value).replace(',', '.'))));
  $('#p-bpm').addEventListener('blur', () => renderPrefs());
  $('#p-list').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const i = +li.dataset.i;
    if (e.target.closest('.p-del')) {
      if (automix.remove(i)) renderLibrary();
      return;
    }
    automix.playIndex(i);
  });
  $('#p-bar').addEventListener('pointerdown', (e) => {
    const a = automix.active;
    if (!a || !a.loaded || automix.trans) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * a.len);
  });
  $('#btn-djmode').addEventListener('click', () => showPlayer(false));
  $('#btn-player').addEventListener('click', () => showPlayer(true));
  renderPlayerList();
}

function bpmLabel(it) {
  if (!it.bpm) return '<span class="p-bpm"></span>';
  const own = Number.isInteger(it.bpm) ? it.bpm : it.bpm.toFixed(1);
  if (automix.tempoMode !== 'fixed') return `<span class="p-bpm">${own} BPM</span>`;
  if (fitPct(it.bpm, automix.masterBpm) == null) return `<span class="p-bpm out">${own} · fuera de rango</span>`;
  return `<span class="p-bpm">${own} → ${automix.masterBpm.toFixed(1)}</span>`;
}

function renderPlayerList() {
  const list = $('#p-list');
  const t = automix.trans;
  const nextIdx = t ? t.idx : automix.nextIndex();
  $('#player').classList.toggle('empty', library.length === 0);
  list.innerHTML = library.map((it, i) => {
    const cls = i === automix.index ? 'current' : i === nextIdx && automix.running ? 'next' : '';
    return `
    <li data-i="${i}" class="${cls}">
      <span class="p-num">${i === automix.index ? '♪' : i + 1}</span>
      <span class="p-name">${escapeHtml(it.name)}</span>
      ${bpmLabel(it)}
      <button class="p-del" aria-label="Quitar">✕</button>
    </li>`;
  }).join('');
}

function updatePlayer() {
  const c = playerCache;
  const a = automix.active;
  const t = automix.trans;
  const item = automix.running ? library[automix.index] : null;
  const fading = t && t.phase === 'fade';
  const incoming = t ? library[t.idx] : null;

  let status = 'LISTO';
  if (!library.length) status = 'SIN CANCIONES';
  else if (fading) status = `MEZCLANDO · ${Math.round(automix.progress * 100)}%`;
  else if (t) status = 'PREPARANDO LA MEZCLA…';
  else if (automix.held) status = 'EN PAUSA';
  else if (automix.isPlaying) status = 'AHORA SUENA';
  else if (automix.finished) status = 'FIN DE LA LISTA';
  setText(c, 'status', $('#p-status'), status);

  const title = fading && automix.progress > 0.5 ? incoming : item;
  setText(c, 'title', $('#p-title'), title ? title.name : library.length ? 'Pulsa ▶ para empezar' : 'Añade canciones para empezar');

  const deck = fading && automix.progress > 0.5 ? t.to : a;
  let meta = '';
  if (deck && deck.loaded && deck.bpm) {
    const pct = deck.tempoPct * 100;
    meta = `${(deck.bpm * deck.tempo).toFixed(1)} BPM` + (Math.abs(pct) >= 0.05 ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)} %)` : '');
  }
  setText(c, 'meta', $('#p-meta'), meta);

  const nextItem = t ? incoming : automix.running && automix.nextIndex() >= 0 ? library[automix.nextIndex()] : null;
  setText(c, 'next', $('#p-nexttitle'), fading && automix.progress > 0.5 ? (item ? `${item.name} (saliendo)` : '—') : nextItem ? nextItem.name : '—');

  setText(c, 'play', $('#p-play'), automix.isPlaying ? '❚❚' : '▶');

  const bar = $('#p-bar');
  if (deck && deck.loaded) {
    const sec = deck.position / deck.sr;
    const dur = deck.len / deck.sr;
    bar.style.setProperty('--p', (sec / dur).toFixed(4));
    const mixStart = Math.max(0, 1 - (automix.fade * deck.tempo) / dur);
    bar.style.setProperty('--m', automix.nextIndex() >= 0 || t ? mixStart.toFixed(4) : '1');
    setText(c, 'el', $('#p-elapsed'), fmtTime(sec, '').slice(0, -2));
    setText(c, 'rem', $('#p-remain'), fmtTime(dur - sec, '-').slice(0, -2));
  } else {
    bar.style.setProperty('--p', '0');
    bar.style.setProperty('--m', '1');
    setText(c, 'el', $('#p-elapsed'), '0:00');
    setText(c, 'rem', $('#p-remain'), '-0:00');
  }
}

/* ─────────────────────────── Barra superior ─────────────────────────── */

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* no soportado */ }
}

let recorder = null;
let recStart = 0;
function toggleRec(btn) {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  if (!mixer.recDest || !window.MediaRecorder) { alert('Tu navegador no permite grabar la mezcla.'); return; }
  const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(mixer.recDest.stream, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    btn.classList.remove('on');
    btn.textContent = '● REC';
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mezcla-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  recorder.start(1000);
  recStart = performance.now();
  btn.classList.add('on');
}

function bindTopbar() {
  $('#btn-library').addEventListener('click', () => openLibrary(null));
  const q = $('#btn-quantize');
  q.classList.toggle('on', settings.quantize);
  press(q, () => { settings.quantize = !settings.quantize; q.classList.toggle('on', settings.quantize); });
  const curve = $('#btn-curve');
  press(curve, () => {
    mixer.curve = mixer.curve === 'smooth' ? 'sharp' : 'smooth';
    mixer.setCrossfader(mixer.x);
  });
  const rec = $('#btn-rec');
  rec.addEventListener('click', () => toggleRec(rec));
  $('#btn-fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
    } catch { /* iOS no permite pantalla completa en Safari: usa "Añadir a inicio" */ }
  });
  new Fader($('#master-fader'), { vertical: false, value: 0.85, def: 0.85, resettable: true, onChange: (v) => mixer.setMaster(v) });
  press($('#wave-a'), () => { settings.zoom = (settings.zoom + 1) % ZOOMS.length; });
  press($('#wave-b'), () => { settings.zoom = (settings.zoom + 1) % ZOOMS.length; });
}

/* ─────────────────────────────── Mezclador UI ─────────────────────────────── */

function buildMixer() {
  const strip = (id) => `
    <div class="strip" data-ch="${id}">
      <div class="knobs">
        <div data-k="trim"></div><div data-k="hi"></div><div data-k="mid"></div><div data-k="low"></div><div data-k="cfx"></div>
      </div>
      <div class="chan">
        <div class="meter v" data-meter="${id}"><i></i></div>
        <div class="ch-fader" data-fader="${id}"></div>
      </div>
    </div>`;
  const root = $('#mixer');
  root.innerHTML = `
    <div class="strips">${strip('A')}${strip('B')}</div>
    <div class="xf-wrap"><b class="xa">A</b><div class="xfader" id="xfader"></div><b class="xb">B</b></div>`;

  mixer.channels.forEach((ch, i) => {
    const id = 'AB'[i];
    const s = root.querySelector(`.strip[data-ch="${id}"]`);
    const k = (name) => s.querySelector(`[data-k="${name}"]`);
    ch.knobs = {
      trim: new Knob(k('trim'), { label: 'TRIM', onChange: (v) => ch.setTrim(v) }),
      hi: new Knob(k('hi'), { label: 'HI', onChange: (v) => ch.setEq('hi', v) }),
      mid: new Knob(k('mid'), { label: 'MID', onChange: (v) => ch.setEq('mid', v) }),
      low: new Knob(k('low'), { label: 'LOW', onChange: (v) => ch.setEq('low', v) }),
      cfx: new Knob(k('cfx'), { label: 'FILTER', onChange: (v) => ch.setFilter(v) }),
    };
    ch.setFader(0.85);
    new Fader(s.querySelector('[data-fader]'), { vertical: true, value: 0.85, onChange: (v) => ch.setFader(v) });
    ch.meterEl = s.querySelector('[data-meter]');
  });
  xfaderCtl = new Fader($('#xfader'), { vertical: false, value: 0.5, def: 0.5, detent: 0.5, resettable: true, onChange: (v) => mixer.setCrossfader(v) });
}

/* ─────────────────────────────── Arranque ─────────────────────────────── */

let lastFrame = 0;
let masterBuf = null;
let masterLevel = 0;
function loop(now) {
  const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
  lastFrame = now;
  automix.tick();
  const djVisible = $('#player').hidden;
  for (const d of decks) d.frame(dt, djVisible);
  if (!djVisible) {
    updatePlayer();
    requestAnimationFrame(loop);
    return;
  }
  const curveText = mixer.curve === 'smooth' ? 'X-FADER: SUAVE' : 'X-FADER: CORTE';
  const curveBtn = $('#btn-curve');
  if (curveBtn.textContent !== curveText) curveBtn.textContent = curveText;
  for (const ch of mixer.channels) ch.meterEl.style.setProperty('--l', ch.meter().toFixed(3));
  mixer.analyser.getFloatTimeDomainData(masterBuf);
  let pk = 0;
  for (let i = 0; i < masterBuf.length; i++) pk = Math.max(pk, Math.abs(masterBuf[i]));
  masterLevel = Math.max(clamp((20 * Math.log10(pk + 1e-9) + 42) / 42, 0, 1), masterLevel - 0.025);
  $('#master-meter').style.setProperty('--l', masterLevel.toFixed(3));
  if (recorder && recorder.state === 'recording') {
    const s = Math.floor((now - recStart) / 1000);
    const txt = `■ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const btn = $('#btn-rec');
    if (btn.textContent !== txt) btn.textContent = txt;
  }
  requestAnimationFrame(loop);
}

async function init() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.AudioWorkletNode) {
    $('#fatal').hidden = false;
    $('#fatal').textContent = 'Tu navegador no soporta Web Audio con AudioWorklet. Usa Chrome, Edge, Firefox o Safari actualizados.';
    return;
  }
  if (navigator.audioSession) {
    try { navigator.audioSession.type = 'playback'; } catch { /* iOS antiguo */ }
  }
  ctx = new AC({ latencyHint: 'interactive' });
  try {
    await ctx.audioWorklet.addModule(new URL('./deck-processor.js', import.meta.url));
  } catch (err) {
    $('#fatal').hidden = false;
    $('#fatal').textContent = 'No se pudo iniciar el motor de audio (se necesita HTTPS o localhost).';
    return;
  }
  mixer = new Mixer();
  masterBuf = new Float32Array(mixer.analyser.fftSize);
  buildMixer();
  const a = new Deck('A', $('#deck-a'), mixer.channels[0], $('#wave-a'));
  const b = new Deck('B', $('#deck-b'), mixer.channels[1], $('#wave-b'));
  a.other = b;
  b.other = a;
  decks.push(a, b);
  automix = new AutoMix({ decks, mixer, xfader: xfaderCtl, library, onChange: renderPlayerList });
  bindTopbar();
  bindLibrary();
  bindPlayer();
  renderLibrary();

  const unlock = () => { if (ctx.state !== 'running') ctx.resume(); };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      unlock();
      if (decks.some((d) => d.playing)) keepAwake();
    }
  });

  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
