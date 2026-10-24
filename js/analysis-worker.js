// Analiza canciones (BPM, beat grid, forma de onda) fuera del hilo principal
// para que la interfaz no se trabe mientras suena la música.
import { analyzeChannels } from './analysis.js';

self.onmessage = (e) => {
  const { id, c0, c1, sr } = e.data;
  try {
    const info = analyzeChannels(c0, c1 || c0, sr);
    self.postMessage({ id, info }, [info.low.buffer, info.mid.buffer, info.high.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
