// Actualizaciones de la app de Android sin reinstalar.
//
// La interfaz (todo lo que hay en esta carpeta js/, css/, index.html) se
// publica en GitHub Pages. Al abrir la app se compara la versión instalada con
// la publicada; si hay una nueva, se descarga en segundo plano y se aplica (al
// momento si no suena música, o en el próximo arranque). Solo cuando cambia la
// parte nativa hace falta un APK nuevo, y la app lo ofrece con un botón.

import { BUILD } from './build-info.js';
import { isNative } from './native.js';

const SITE = 'https://nexoaiecosystem-coder.github.io/Musica/';
const CHECK_EVERY = 30 * 60 * 1000;

const cap = window.Capacitor;
const call = (method, opts) => cap.nativePromise('AppUpdater', method, opts);

export class Updater {
  constructor({ isPlaying, toast, onState }) {
    this.isPlaying = isPlaying;
    this.toast = toast;
    this.onState = onState;
    this.native = null;     // { versionCode, versionName, badVersion }
    this.remote = null;     // version.json publicado
    this.pending = null;    // interfaz descargada esperando aplicarse
    this.apk = false;       // hay un APK más nuevo
    this.busy = false;
    this.lastCheck = 0;
  }

  get enabled() { return isNative; }

  async start() {
    if (!isNative) return;
    try {
      this.native = await call('info');
      await call('confirm'); // esta interfaz arrancó bien
    } catch { return; }
    this.emit();
    setTimeout(() => this.check(), 3000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - this.lastCheck > CHECK_EVERY) this.check();
    });
  }

  emit() {
    if (this.onState) this.onState(this.state());
  }

  state() {
    return {
      web: BUILD.web,
      native: this.native ? this.native.versionCode : null,
      pending: !!this.pending,
      apk: this.apk,
      busy: this.busy,
    };
  }

  async check(manual = false) {
    if (!isNative || this.busy) return;
    this.lastCheck = Date.now();
    this.busy = true;
    this.emit();
    try {
      const res = await fetch(`${SITE}version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const v = await res.json();
      this.remote = v;
      const nativeCode = this.native.versionCode;
      this.apk = v.native > nativeCode;
      const newerWeb = v.web > BUILD.web && String(v.web) !== this.native.badVersion;
      if (newerWeb && nativeCode >= v.minNative && (!this.pending || this.pending.version < v.web)) {
        const { path } = await call('downloadBundle', { url: `${SITE}bundle.zip?v=${v.web}`, version: String(v.web) });
        this.pending = { path, version: v.web };
        if (this.isPlaying()) {
          // No cortar la música: queda lista para el próximo arranque.
          await call('applyBundle', { path, now: false });
        } else {
          this.toast('Actualizando la app…');
          await call('applyBundle', { path, now: true });
          return; // la página se recarga con la versión nueva
        }
      } else if (manual) {
        this.toast(this.apk ? 'Hay una versión nueva de la app para instalar' : 'La app está al día');
      }
    } catch {
      if (manual) this.toast('No se pudo buscar actualizaciones (¿sin conexión?)');
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  // Aplica ya la interfaz descargada (recarga la app).
  async applyNow() {
    if (!this.pending) return;
    await call('applyBundle', { path: this.pending.path, now: true });
  }

  // Descarga el APK nuevo y abre el instalador de Android.
  async installApk() {
    if (!this.remote || !this.remote.apk) return;
    this.toast('Descargando la nueva versión…');
    try {
      const r = await call('installApk', { url: this.remote.apk });
      if (r && r.needsPermission) {
        this.toast('Permite "instalar apps" para Musica DJ y vuelve a tocar Actualizar');
      }
    } catch {
      this.toast('No se pudo descargar la nueva versión');
    }
  }
}
