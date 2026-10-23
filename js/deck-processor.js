// Motor de reproducción de un deck. Corre en el hilo de audio (AudioWorklet).
// Lee el audio decodificado a una velocidad variable (también negativa), lo que
// permite tempo, pitch bend, scratch estilo vinilo y loops sin cortes.

class DeckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null;
    this.R = null;
    this.len = 0;
    this.pos = 0;          // posición en muestras (con decimales)
    this.rate = 0;         // velocidad actual suavizada (1 = normal)
    this.playing = false;
    this.tempo = 1;
    this.bend = 0;
    this.scratching = false;
    this.target = 0;       // posición objetivo del plato mientras se hace scratch
    this.looping = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.seq = 0;
    this.tick = 0;
    this.port.onmessage = (e) => this.handle(e.data);
  }

  handle(m) {
    switch (m.type) {
      case 'load':
        this.L = m.left;
        this.R = m.right || m.left;
        this.len = this.L.length;
        this.pos = m.pos || 0;
        this.rate = 0;
        this.playing = false;
        this.scratching = false;
        this.looping = false;
        this.bend = 0;
        this.seq = m.seq;
        break;
      case 'play': this.playing = true; break;
      case 'pause': this.playing = false; break;
      case 'seek':
        this.pos = Math.max(0, Math.min(m.pos, this.len - 2));
        this.target = this.pos;
        this.seq = m.seq;
        break;
      case 'tempo': this.tempo = m.value; break;
      case 'bend': this.bend = m.value; break;
      case 'scratch':
        if (m.on && !this.scratching) this.target = this.pos;
        this.scratching = m.on;
        break;
      case 'scratchMove':
        this.target = Math.max(0, Math.min(this.target + m.delta, this.len - 2));
        break;
      case 'loop':
        this.looping = m.on;
        if (m.on) { this.loopStart = m.start; this.loopEnd = m.end; }
        break;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    if (!this.L) return true;

    let goal;
    if (this.scratching) {
      // El plato persigue la posición del dedo en ~4 bloques (≈12 ms).
      goal = (this.target - this.pos) / (n * 4);
      if (goal > 6) goal = 6; else if (goal < -6) goal = -6;
    } else {
      goal = this.playing ? this.tempo + this.bend : 0;
    }
    const k = this.scratching ? 0.4 : (this.playing ? 0.35 : 0.22);
    const r0 = this.rate;
    let r1 = r0 + (goal - r0) * k;
    if (goal === 0 && Math.abs(r1) < 1e-4) r1 = 0;

    const L = this.L, R = this.R, last = this.len - 1;
    const loopLen = this.loopEnd - this.loopStart;
    const wrap = this.looping && !this.scratching && loopLen > 16;
    let pos = this.pos;
    let ended = false;

    for (let i = 0; i < n; i++) {
      const i0 = pos | 0;
      if (i0 < last) {
        const f = pos - i0;
        const a = L[i0], b = R[i0];
        oL[i] = a + (L[i0 + 1] - a) * f;
        oR[i] = b + (R[i0 + 1] - b) * f;
      } else {
        oL[i] = 0;
        oR[i] = 0;
      }
      pos += r0 + (r1 - r0) * (i / n);
      if (wrap && pos >= this.loopEnd) {
        while (pos >= this.loopEnd) pos -= loopLen;
      }
      if (pos < 0) {
        pos = 0;
      } else if (pos >= last) {
        pos = last;
        if (this.playing && !this.scratching) { this.playing = false; ended = true; }
      }
    }

    this.pos = pos;
    this.rate = r1;
    if (++this.tick >= 4 || ended) {
      this.tick = 0;
      this.port.postMessage({ type: 'pos', pos, rate: r1, seq: this.seq, ended });
    }
    return true;
  }
}

registerProcessor('deck-processor', DeckProcessor);
