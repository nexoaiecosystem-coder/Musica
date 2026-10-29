// Prueba de humo de la app en un navegador real (Chromium sin pantalla).
// Se ejecuta en GitHub Actions antes de publicar: si algo se rompe, la versión
// nueva no llega al teléfono.
//
//   npm run build:web && npm test
//
// Recorre lo esencial: importar canciones, detectar BPM, reproducir, elegir la
// siguiente, mezcla automática, BPM fijo, carpetas y que todo se guarde.

import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const ROOT = process.env.TEST_ROOT || 'www';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// ── servidor estático ──
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const URL_BASE = `http://localhost:${server.address().port}/`;

// ── pistas de prueba: bombo + charles a un BPM dado ──
function wav(bpm, seconds, offset) {
  const sr = 44100;
  const n = sr * seconds;
  const data = new Float32Array(n);
  const beat = 60 / bpm;
  for (let t0 = offset; t0 < seconds; t0 += beat) {
    const s = Math.floor(t0 * sr);
    for (let i = 0; i < sr * 0.25 && s + i < n; i++) {
      const t = i / sr;
      data[s + i] += 0.8 * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-t * 30)) * t) * Math.exp(-t * 10);
    }
    const h = Math.floor((t0 + beat / 2) * sr);
    for (let i = 0; i < sr * 0.05 && h + i < n; i++) data[h + i] += 0.15 * (Math.random() * 2 - 1) * Math.exp(-(i / sr) * 80);
  }
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, data[i])) * 32767;
    buf.writeInt16LE(v | 0, 44 + i * 4);
    buf.writeInt16LE(v | 0, 46 + i * 4);
  }
  return buf;
}
const dir = await mkdtemp(join(tmpdir(), 'musica-test-'));
const trackA = join(dir, 'Uno 128.wav');
const trackB = join(dir, 'Dos 124.wav');
await writeFile(trackA, wav(128, 40, 0.37));
await writeFile(trackB, wav(124, 40, 0.12));

// ── utilidades ──
let failed = 0;
function check(cond, msg) {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failed++;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const text = (sel) => page.textContent(sel);

try {
  await page.goto(URL_BASE);
  await page.waitForTimeout(800);
  check(await page.isVisible('#btn-queue'), 'la pantalla principal carga');

  // Importar y analizar
  await page.click('#btn-queue');
  await page.waitForTimeout(400);
  await page.setInputFiles('#import-files', [trackA, trackB]);
  await page.click('#lib-rows li[data-folder="all"]');
  await page.waitForFunction(() => {
    const s = [...document.querySelectorAll('#lib-rows .row-text small')].map((e) => e.textContent);
    return s.length === 2 && s.every((t) => /\d BPM/.test(t));
  }, null, { timeout: 30000 });
  const subs = await page.$$eval('#lib-rows .row-text small', (els) => els.map((e) => e.textContent));
  check(subs.some((t) => t.startsWith('124 BPM')) && subs.some((t) => t.startsWith('128 BPM')), `BPM detectados: ${subs.join(' | ')}`);

  // Tocar una canción la reproduce; la segunda queda "a continuación"
  await page.click('#lib-rows li.song >> nth=1'); // "Uno 128" (orden alfabético: Dos, Uno)
  await page.waitForTimeout(1500);
  await page.click('#lib-rows li.song >> nth=0');
  await page.waitForTimeout(500);
  await page.click('#sheet-close');
  await page.waitForTimeout(800);
  check((await text('#p-title')) === 'Uno 128', 'suena la canción elegida');
  check((await text('#p-nexttitle')).includes('Dos 124'), 'la siguiente es la elegida');

  // BPM fijo a 130: las dos canciones se ajustan
  await page.click('#p-mode button[data-m="fixed"]');
  for (let i = 0; i < 2; i++) await page.click('#p-master .p-step[data-d="1"]');
  await page.waitForTimeout(4000);
  check((await text('#p-meta')).startsWith(`${(await text('#p-bpm')).trim()} BPM`), `tempo fijo aplicado: ${await text('#p-meta')}`);

  // Mezcla automática hacia la siguiente
  const settingsFade = async (s) => {
    await page.click('#btn-settings');
    await page.waitForTimeout(400);
    await page.click(`#p-fade button[data-s="${s}"]`);
    await page.click('#settings [data-close]');
    await page.waitForTimeout(400);
  };
  await settingsFade(6);
  const box = await page.locator('#p-bar').boundingBox();
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height / 2);
  let mixed = false;
  for (let i = 0; i < 25 && !mixed; i++) {
    await page.waitForTimeout(1000);
    mixed = (await text('#p-title')) === 'Dos 124' && (await text('#p-status')) === 'AHORA SUENA';
  }
  check(mixed, 'la mezcla automática pasa a la siguiente canción');
  check((await text('#p-meta')).startsWith(`${(await text('#p-bpm')).trim()} BPM`), `la nueva canción sigue el BPM del set: ${await text('#p-meta')}`);

  // Carpetas
  await page.click('#btn-queue');
  await page.waitForTimeout(400);
  await page.click('#sheet-tabs button[data-tab="library"]');
  if (await page.isVisible('#lib-nav [data-back]')) await page.click('#lib-nav [data-back]');
  await page.click('[data-chip="newfolder"]');
  await page.fill('#dialog-input', 'Set de prueba');
  await page.click('#dialog-ok');
  await page.waitForTimeout(400);
  await page.click('#lib-rows li[data-folder="all"]');
  await page.click('#lib-rows li.song >> nth=0 >> [data-more]');
  await page.waitForTimeout(300);
  await page.click('#action-list button:has-text("Añadir a carpeta")');
  await page.waitForTimeout(300);
  await page.click('#action-list button:has-text("Set de prueba")');
  await page.waitForTimeout(400);
  await page.click('#lib-nav [data-back]');
  await page.waitForTimeout(300);
  check((await page.textContent('#lib-rows')).includes('Set de prueba1 canción'), 'carpeta creada con una canción');

  // Todo queda guardado
  await page.reload();
  await page.waitForTimeout(1500);
  await page.click('#btn-queue');
  await page.waitForTimeout(400);
  await page.click('#sheet-tabs button[data-tab="library"]');
  const lib = await page.textContent('#lib-rows');
  check(lib.includes('2 canciones') && lib.includes('Set de prueba'), 'biblioteca y carpetas siguen tras reabrir');
  await page.click('#sheet-tabs button[data-tab="queue"]');
  check((await page.$$('#tab-queue .row')).length === 2, 'la cola se conserva');

  // Modo DJ
  await page.click('#sheet-close');
  await page.waitForTimeout(400);
  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  await page.click('#btn-djmode');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.click('#btn-library');
  await page.click('#lib-list li >> nth=0 >> button[data-load="0"]');
  await page.waitForFunction(() => document.querySelector('#deck-a .bpm').textContent !== '---.-', null, { timeout: 15000 });
  check(true, 'el modo DJ carga una canción en el deck A');
} catch (err) {
  check(false, `error inesperado: ${err.message.split('\n')[0]}`);
}

check(errors.length === 0, `sin errores en la consola${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
server.close();
if (failed) {
  console.log(`\n${failed} comprobación(es) fallaron`);
  process.exit(1);
}
console.log('\nTodo bien');
