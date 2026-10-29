// Prepara www/: la interfaz que va dentro del APK y la que se publica en
// GitHub Pages (desde donde la app instalada se actualiza sola).
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons'];

// Versión de la interfaz: la fecha del último commit (segundos). Así la copia
// del APK y la de GitHub Pages tienen el mismo número si salen del mismo commit.
function webVersion() {
  if (process.env.WEB_VERSION) return Number(process.env.WEB_VERSION);
  try {
    return Number(execSync('git log -1 --format=%ct', { encoding: 'utf8' }).trim());
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

const nv = JSON.parse(readFileSync('native-version.json', 'utf8'));
const info = { web: webVersion(), native: nv.native, minNative: nv.minNativeForWeb };

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
writeFileSync('www/js/build-info.js', `export const BUILD = ${JSON.stringify(info)};\n`);
writeFileSync('www/version.json', JSON.stringify({
  ...info,
  apk: 'https://github.com/nexoaiecosystem-coder/Musica/releases/download/android-latest/MusicaDJ.apk',
}, null, 2));
// El service worker cambia de nombre de caché con cada versión publicada.
const sw = readFileSync('www/sw.js', 'utf8').replace(/const CACHE = '[^']*';/, `const CACHE = 'musica-dj-${info.web}';`);
writeFileSync('www/sw.js', sw);
console.log('www/ listo', info);
