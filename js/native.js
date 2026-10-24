// Integración con la app nativa de Android (Capacitor). En el navegador todo
// esto no hace nada.

const cap = window.Capacitor;
export const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

let last = '';

// Informa al servicio de reproducción qué suena: mantiene la música con la
// pantalla bloqueada y actualiza la notificación con los controles.
export function nativeNowPlaying(state) {
  if (!isNative) return;
  const key = JSON.stringify(state);
  if (key === last) return;
  last = key;
  cap.nativePromise('PlaybackService', 'update', state).catch(() => {});
}

// Botones de la notificación, pantalla de bloqueo y auriculares.
export function onNativeAction(fn) {
  if (!isNative) return;
  cap.addListener('PlaybackService', 'action', (data) => fn(data && data.action));
}
