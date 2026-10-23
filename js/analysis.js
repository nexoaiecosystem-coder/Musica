// Análisis de pistas: forma de onda de 3 bandas (estilo rekordbox) y detección
// de BPM + rejilla de beats (beat grid).

export const FPS = 150; // columnas de forma de onda por segundo

// Capas que se dibujan una encima de otra: graves, medios, agudos.
export const LAYERS = [
  ['low', '#1f6fff', 1.0],
  ['mid', '#ffa526', 0.8],
  ['high', '#ffffff', 0.5],
];

export function analyzeBuffer(buffer) {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const c0 = buffer.getChannelData(0);
  const c1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : c0;
  const hop = sr / FPS;
  const nBins = Math.max(1, Math.ceil(len / hop));

  const low = new Float32Array(nBins);
  const mid = new Float32Array(nBins);
  const high = new Float32Array(nBins);
  const env = new Float32Array(nBins);

  // Filtros de un polo para separar bandas (≈180 Hz y ≈2,2 kHz).
  const aL = Math.exp((-2 * Math.PI * 180) / sr);
  const aH = Math.exp((-2 * Math.PI * 2200) / sr);
  let lp1 = 0, lp2 = 0;
  let b = 0, next = hop, lo = 0, mi = 0, hi = 0, eL = 0, eA = 0, cnt = 0;

  for (let i = 0; i < len; i++) {
    const x = (c0[i] + c1[i]) * 0.5;
    lp1 = x + aL * (lp1 - x);
    lp2 = x + aH * (lp2 - x);
    const m = lp2 - lp1;
    const h = x - lp2;
    const al = lp1 < 0 ? -lp1 : lp1;
    const am = m < 0 ? -m : m;
    const ah = h < 0 ? -h : h;
    if (al > lo) lo = al;
    if (am > mi) mi = am;
    if (ah > hi) hi = ah;
    eL += lp1 * lp1;
    eA += x * x;
    cnt++;
    if (i + 1 >= next || i === len - 1) {
      if (b < nBins) {
        low[b] = lo;
        mid[b] = mi;
        high[b] = hi;
        env[b] = (eL + 0.3 * eA) / cnt;
      }
      b++;
      next += hop;
      lo = mi = hi = eL = eA = 0;
      cnt = 0;
    }
  }

  normalize(low);
  normalize(mid);
  normalize(high);

  // Curva de "ataques" (onsets): subidas de energía, sobre todo en graves.
  const onset = new Float32Array(nBins);
  let prev = 0;
  for (let i = 0; i < nBins; i++) {
    const v = Math.log(1 + 1e4 * env[i]);
    onset[i] = Math.max(0, v - prev);
    prev = v;
  }
  const smooth = new Float32Array(nBins);
  for (let i = 1; i < nBins - 1; i++) smooth[i] = 0.25 * onset[i - 1] + 0.5 * onset[i] + 0.25 * onset[i + 1];

  let bpm = 0;
  let firstBeat = 0;
  const rough = estimateBpm(smooth);
  if (rough) {
    const grid = refineGrid(smooth, rough);
    bpm = (60 * FPS) / grid.P;
    let ph = grid.ph;
    const rounded = Math.round(bpm);
    if (Math.abs(bpm - rounded) < 0.06) {
      bpm = rounded;
      ph = bestPhase(smooth, (60 * FPS) / bpm, 0, nBins).ph;
    }
    firstBeat = ph / FPS;
  }

  return { low, mid, high, bpm, firstBeat, duration: len / sr };
}

function normalize(arr) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (max > 0) for (let i = 0; i < arr.length; i++) arr[i] /= max;
}

// Autocorrelación de la curva de onsets sobre (máx.) 2 minutos centrales.
function estimateBpm(onset) {
  const n = onset.length;
  const maxLen = FPS * 120;
  const s = n > maxLen ? Math.floor((n - maxLen) / 2) : 0;
  const e = Math.min(n, s + maxLen);
  const L = e - s;
  if (L < FPS * 5) return 0;

  let mean = 0;
  for (let i = s; i < e; i++) mean += onset[i];
  mean /= L;
  const x = new Float32Array(L);
  for (let i = 0; i < L; i++) x[i] = onset[s + i] - mean;

  const minLag = Math.floor((60 * FPS) / 200);
  const maxLag = Math.ceil((60 * FPS) / 60);
  const ac = new Float32Array(2 * maxLag + 2);
  for (let lag = minLag; lag < ac.length; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < L; i++) sum += x[i] * x[i + lag];
    ac[lag] = sum / (L - lag);
  }

  const score = new Float32Array(maxLag + 2);
  let best = -Infinity, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * FPS) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2));
    score[lag] = (ac[lag] + 0.5 * ac[2 * lag]) * w;
    if (score[lag] > best) { best = score[lag]; bestLag = lag; }
  }
  if (!bestLag || best <= 0) return 0;

  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = score[bestLag - 1], b = score[bestLag], c = score[bestLag + 1];
    const d = a - 2 * b + c;
    if (d < 0) lag += (0.5 * (a - c)) / d;
  }
  let bpm = (60 * FPS) / lag;
  while (bpm < 78) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  return bpm;
}

// Ajusta el periodo y la fase del beat grid para que caiga sobre los golpes.
function refineGrid(onset, bpm) {
  const n = onset.length;
  const P0 = (60 * FPS) / bpm;
  // 1) búsqueda gruesa sobre un tramo de 60 s
  const segLen = Math.min(n, FPS * 60);
  const s0 = Math.max(0, Math.floor((n - segLen) / 2));
  let best = { score: -1, P: P0, ph: 0 };
  for (let k = -40; k <= 40; k++) {
    const P = P0 * (1 + k * 0.0003);
    const r = bestPhase(onset, P, s0, s0 + segLen);
    if (r.score > best.score) best = { score: r.score, P, ph: r.ph };
  }
  // 2) búsqueda fina sobre toda la pista
  const Pc = best.P;
  best = { score: -1, P: Pc, ph: 0 };
  for (let k = -20; k <= 20; k++) {
    const P = Pc * (1 + k * 0.00003);
    const r = bestPhase(onset, P, 0, n);
    if (r.score > best.score) best = { score: r.score, P, ph: r.ph };
  }
  return best;
}

function bestPhase(onset, P, start, end) {
  let bs = -1, bp = 0;
  for (let ph = 0; ph < P; ph += 0.5) {
    // primera posición de la rejilla dentro del tramo, alineada con el origen
    let t = ph + Math.ceil((start - ph) / P) * P;
    let sum = 0, count = 0;
    for (; t < end - 1; t += P) {
      const i = t | 0;
      const f = t - i;
      sum += onset[i] + (onset[i + 1] - onset[i]) * f;
      count++;
    }
    const sc = count ? sum / count : 0;
    if (sc > bs) { bs = sc; bp = ph; }
  }
  return { score: bs, ph: bp };
}

// Dibuja la vista general (pista completa) en un canvas.
export function renderOverview(canvas, wave) {
  const W = canvas.width, H = canvas.height;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, W, H);
  const n = wave.low.length;
  const midY = H / 2;
  for (const [key, color, scale] of LAYERS) {
    const arr = wave[key];
    c.beginPath();
    for (let x = 0; x < W; x++) {
      const b0 = Math.floor((x / W) * n);
      const b1 = Math.max(b0 + 1, Math.floor(((x + 1) / W) * n));
      let m = 0;
      for (let i = b0; i < b1 && i < n; i++) if (arr[i] > m) m = arr[i];
      const h = m * scale * midY;
      if (h > 0.3) c.rect(x, midY - h, 1, h * 2);
    }
    c.fillStyle = color;
    c.fill();
  }
}
