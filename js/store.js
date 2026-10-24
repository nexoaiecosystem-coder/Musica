// Biblioteca guardada en el teléfono (IndexedDB): canciones, carpetas,
// análisis de BPM/forma de onda y el estado de la cola. Así nada se pierde al
// cerrar la app.

const DB_NAME = 'musica-dj';
const DB_VERSION = 1;

let db = null;

function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('tracks', { keyPath: 'id' });   // datos de cada canción
      d.createObjectStore('files');                        // el archivo de audio
      d.createObjectStore('analysis');                     // BPM + forma de onda
      d.createObjectStore('folders', { keyPath: 'id' });
      d.createObjectStore('state');                        // cola, ajustes…
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function os(name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

const put = (name, value, key) => request(os(name, 'readwrite').put(value, key));
const get = (name, key) => request(os(name).get(key));
const del = (name, key) => request(os(name, 'readwrite').delete(key));

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
export const byName = (a, b) => collator.compare(a.name, b.name);

// Para buscar sin importar mayúsculas ni tildes.
export function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const AUDIO_EXT = /\.(mp3|m4a|aac|mp4|wav|flac|ogg|oga|opus|aif|aiff|webm|wma)$/i;
export const isAudio = (f) => (f.type || '').startsWith('audio') || AUDIO_EXT.test(f.name);

class Store {
  constructor() {
    this.tracks = new Map();
    this.folders = new Map();
    this.listeners = new Set();
    this.persistent = false; // false = solo en memoria (sin IndexedDB)
  }

  async init() {
    try {
      db = await openDb();
      const [tracks, folders] = await Promise.all([request(os('tracks').getAll()), request(os('folders').getAll())]);
      for (const t of tracks) this.tracks.set(t.id, t);
      for (const f of folders) this.folders.set(f.id, f);
      this.persistent = true;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch {
      db = null; // navegador sin IndexedDB: la biblioteca dura lo que la sesión
    }
  }

  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(); }

  /* ── canciones ── */

  async addFiles(files, folderId = null) {
    const added = [];
    const byKey = new Map([...this.tracks.values()].map((t) => [`${t.fileName}|${t.size}`, t]));
    for (const f of files) {
      if (!isAudio(f)) continue;
      let t = byKey.get(`${f.name}|${f.size}`); // ya importada: no se duplica
      if (!t) {
        t = { id: uid(), name: f.name.replace(/\.[^.]+$/, ''), fileName: f.name, size: f.size, addedAt: Date.now(), bpm: null, duration: null };
        this.tracks.set(t.id, t);
        byKey.set(`${f.name}|${f.size}`, t);
        if (db) {
          await put('files', f, t.id);
          await put('tracks', t);
        } else {
          t.file = f;
        }
      }
      added.push(t);
    }
    if (folderId && added.length) await this.addToFolder(folderId, added.map((t) => t.id), true);
    this.emit();
    return added;
  }

  async getFile(track) {
    if (track.file) return track.file;
    return db ? get('files', track.id) : null;
  }

  async getAnalysis(id) {
    return db ? get('analysis', id) : null;
  }

  async saveAnalysis(id, info) {
    const t = this.tracks.get(id);
    if (t) {
      t.bpm = info.bpm;
      t.duration = info.duration;
      if (db) await put('tracks', t);
    }
    if (db) await put('analysis', info, id);
    this.emit();
  }

  async markUnreadable(id) {
    const t = this.tracks.get(id);
    if (!t) return;
    t.bpm = 0;
    t.unreadable = true;
    if (db) await put('tracks', t);
    this.emit();
  }

  async deleteTrack(id) {
    this.tracks.delete(id);
    for (const f of this.folders.values()) {
      const i = f.trackIds.indexOf(id);
      if (i >= 0) {
        f.trackIds.splice(i, 1);
        if (db) await put('folders', f);
      }
    }
    if (db) await Promise.all([del('tracks', id), del('files', id), del('analysis', id)]);
    this.emit();
  }

  allTracks() {
    return [...this.tracks.values()].sort(byName);
  }

  /* ── carpetas ── */

  async createFolder(name, parentId = null) {
    const f = { id: uid(), name: name.trim() || 'Carpeta', parentId, trackIds: [], createdAt: Date.now() };
    this.folders.set(f.id, f);
    if (db) await put('folders', f);
    this.emit();
    return f;
  }

  async renameFolder(id, name) {
    const f = this.folders.get(id);
    if (!f || !name.trim()) return;
    f.name = name.trim();
    if (db) await put('folders', f);
    this.emit();
  }

  // Borra la carpeta y sus subcarpetas. Las canciones siguen en la biblioteca.
  async deleteFolder(id) {
    for (const child of this.childFolders(id)) await this.deleteFolder(child.id);
    this.folders.delete(id);
    if (db) await del('folders', id);
    this.emit();
  }

  async addToFolder(folderId, trackIds, silent) {
    const f = this.folders.get(folderId);
    if (!f) return 0;
    let n = 0;
    for (const id of trackIds) {
      if (!f.trackIds.includes(id)) { f.trackIds.push(id); n++; }
    }
    if (db) await put('folders', f);
    if (!silent) this.emit();
    return n;
  }

  async removeFromFolder(folderId, trackId) {
    const f = this.folders.get(folderId);
    if (!f) return;
    f.trackIds = f.trackIds.filter((id) => id !== trackId);
    if (db) await put('folders', f);
    this.emit();
  }

  childFolders(parentId = null) {
    return [...this.folders.values()].filter((f) => (f.parentId || null) === parentId).sort(byName);
  }

  tracksIn(folderId) {
    const f = this.folders.get(folderId);
    return f ? f.trackIds.map((id) => this.tracks.get(id)).filter(Boolean) : [];
  }

  // Canciones de la carpeta y de todas sus subcarpetas (sin repetir).
  tracksDeep(folderId) {
    const seen = new Set();
    const out = [];
    const walk = (id) => {
      for (const t of this.tracksIn(id)) if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
      for (const c of this.childFolders(id)) walk(c.id);
    };
    walk(folderId);
    return out;
  }

  folderPath(id) {
    const parts = [];
    for (let f = this.folders.get(id); f; f = this.folders.get(f.parentId)) parts.unshift(f.name);
    return parts.join(' › ');
  }

  /* ── estado (cola, ajustes) ── */

  async saveState(key, value) {
    if (db) await put('state', value, key);
  }

  async loadState(key) {
    return db ? get('state', key) : null;
  }
}

export const store = new Store();
