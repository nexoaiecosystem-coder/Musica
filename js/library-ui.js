// Panel de "Lista de reproducción": la cola (qué suena y qué sigue) y la
// biblioteca (canciones importadas del teléfono, carpetas y búsqueda).

import { store, fold, byName } from './store.js';
import { fitPct } from './automix.js';

const $ = (s, r = document) => r.querySelector(s);

const ICON = {
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2.2h7A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
  all: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v10.6A3.5 3.5 0 1 0 11 18V8h7V4z"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.4 6-1.4 1.4 4.6 4.6-4.6 4.6L9.4 18l6-6z"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 6 14 4.6 6.6 12l7.4 7.4 1.4-1.4-6-6z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h4v4l-1.5-1.5-3.6 3.6-1.4-1.4 3.6-3.6zM4 6h3.5l9.1 10.5L18.5 15l1.5 1.5V20h-4l1.5-1.5L16 17l-.5.5L6.6 8H4zm0 12h2.6l2.9-3.4 1.3 1.6L7.5 20H4z"/></svg>',
  addq: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="12" height="2" rx="1"/><rect x="3" y="11" width="12" height="2" rx="1"/><rect x="3" y="17" width="7" height="2" rx="1"/><path d="M17 13h2v3h3v2h-3v3h-2v-3h-3v-2h3z"/></svg>',
  import: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v10.2l3.3-3.3 1.4 1.4L12 17l-5.7-5.7 1.4-1.4 3.3 3.3z"/><path d="M4 19h16v2H4z"/></svg>',
  newfolder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2.2h7A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5zM11 10v2.5H8.5v2H11V17h2v-2.5h2.5v-2H13V10z"/></svg>',
};

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function fmtDur(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function hue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

const canPickFolders = 'webkitdirectory' in document.createElement('input') && !/iPhone|iPad|iPod/.test(navigator.userAgent);

export class LibraryUI {
  constructor({ automix, queue, onImported }) {
    this.automix = automix;
    this.queue = queue;
    this.onImported = onImported;
    this.tab = 'queue';
    this.view = null; // null = raíz, 'all' = todas, o id de carpeta
    this.bind();
  }

  /* ───────────── utilidades de interfaz ───────────── */

  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  actions(title, items) {
    const back = $('#actions');
    $('#action-title').textContent = title;
    $('#action-title').hidden = !title;
    const list = $('#action-list');
    list.innerHTML = items.map((it, i) => `<button class="action${it.danger ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('');
    const close = () => {
      back.classList.remove('open');
      this.actionTimer = setTimeout(() => { back.hidden = true; }, 220);
    };
    list.onclick = (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      close();
      items[+b.dataset.i].run();
    };
    $('#action-cancel').onclick = close;
    back.onclick = (e) => { if (e.target === back) close(); };
    clearTimeout(this.actionTimer); // por si el menú anterior aún se estaba cerrando
    back.hidden = false;
    requestAnimationFrame(() => back.classList.add('open'));
  }

  // Diálogo con texto (input = true) o de confirmación. Devuelve el texto, true o null.
  ask({ title, message = '', value = '', placeholder = '', ok = 'OK', danger = false, input = true }) {
    return new Promise((resolve) => {
      const back = $('#dialog');
      const field = $('#dialog-input');
      $('#dialog-title').textContent = title;
      $('#dialog-msg').textContent = message;
      $('#dialog-msg').hidden = !message;
      field.hidden = !input;
      field.value = value;
      field.placeholder = placeholder;
      const okBtn = $('#dialog-ok');
      okBtn.textContent = ok;
      okBtn.classList.toggle('danger', danger);
      const done = (v) => {
        back.classList.remove('open');
        this.dialogTimer = setTimeout(() => { back.hidden = true; }, 200);
        field.blur();
        resolve(v);
      };
      $('#dialog-form').onsubmit = (e) => {
        e.preventDefault();
        if (input && !field.value.trim()) return;
        done(input ? field.value.trim() : true);
      };
      $('#dialog-cancel').onclick = () => done(null);
      clearTimeout(this.dialogTimer);
      back.hidden = false;
      requestAnimationFrame(() => {
        back.classList.add('open');
        if (input) { field.focus(); field.select(); }
      });
    });
  }

  openSheet(el) {
    clearTimeout(el.closeTimer);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('open'));
  }

  closeSheet(el) {
    el.classList.remove('open');
    const sheet = el.querySelector('.sheet');
    sheet.style.transform = '';
    el.closeTimer = setTimeout(() => { el.hidden = true; }, 300);
  }

  // Arrastrar la parte superior del panel hacia abajo lo cierra (como en iOS).
  draggable(back) {
    const sheet = back.querySelector('.sheet');
    const handles = [sheet.querySelector('.sheet-grab'), sheet.querySelector('.sheet-head')];
    let drag = null;
    for (const h of handles) {
      h.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, input, label')) return;
        drag = { id: e.pointerId, y: e.clientY, dy: 0 };
        h.setPointerCapture(e.pointerId);
        sheet.style.transition = 'none';
      });
      h.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        drag.dy = Math.max(0, e.clientY - drag.y);
        sheet.style.transform = `translateY(${drag.dy}px)`;
      });
      const end = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        sheet.style.transition = '';
        if (drag.dy > 110) this.closeSheet(back);
        else sheet.style.transform = '';
        drag = null;
      };
      h.addEventListener('pointerup', end);
      h.addEventListener('pointercancel', end);
    }
    back.addEventListener('click', (e) => { if (e.target === back) this.closeSheet(back); });
  }

  /* ───────────── apertura y pestañas ───────────── */

  open(tab) {
    this.openSheet($('#sheet'));
    this.setTab(tab || (this.queue.length ? 'queue' : 'library'));
  }

  setTab(tab) {
    this.tab = tab;
    $('#sheet-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#tab-queue').hidden = tab !== 'queue';
    $('#tab-library').hidden = tab !== 'library';
    this.render();
  }

  render() {
    if ($('#sheet').hidden) return;
    if (this.tab === 'queue') this.renderQueue();
    else this.renderLibrary();
  }

  bind() {
    const sheet = $('#sheet');
    this.draggable(sheet);
    this.draggable($('#settings'));
    $('#btn-queue').addEventListener('click', () => this.open());
    $('#sheet-close').addEventListener('click', () => this.closeSheet(sheet));
    $('#sheet-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.setTab(b.dataset.tab);
    });
    $('#lib-search').addEventListener('input', () => this.renderLibrary());

    $('#import-files').addEventListener('change', (e) => this.importFiles(e.target));
    $('#import-folder').addEventListener('change', (e) => this.importFolder(e.target));

    $('#tab-queue').addEventListener('click', (e) => this.onQueueClick(e));
    $('#lib-rows').addEventListener('click', (e) => this.onLibraryClick(e));
    $('#lib-nav').addEventListener('click', (e) => this.onNavClick(e));
    $('#lib-actions').addEventListener('click', (e) => this.onChipClick(e));

    store.onChange(() => {
      clearTimeout(this.renderTimer);
      this.renderTimer = setTimeout(() => this.render(), 60);
    });
  }

  /* ───────────── filas ───────────── */

  trackSub(t) {
    const parts = [];
    if (t.unreadable) parts.push('No se puede leer');
    else if (t.bpm == null) parts.push('Analizando BPM…');
    else if (!t.bpm) parts.push('BPM no detectado');
    else if (t.bpm) {
      const own = Number.isInteger(t.bpm) ? t.bpm : t.bpm.toFixed(1);
      if (this.automix.tempoMode === 'fixed') {
        parts.push(fitPct(t.bpm, this.automix.masterBpm) == null
          ? `${own} BPM · <span class="warn">fuera de rango</span>`
          : `${own} → ${this.automix.masterBpm.toFixed(1)} BPM`);
      } else {
        parts.push(`${own} BPM`);
      }
    }
    if (t.duration) parts.push(fmtDur(t.duration));
    return parts.join(' · ');
  }

  isCurrent(t) {
    const a = this.automix;
    return a.running && this.queue[a.index] === t;
  }

  trackRow(t, attrs = '', extraClass = '') {
    const cur = this.isCurrent(t);
    const tile = cur
      ? '<span class="eq"><i></i><i></i><i></i></span>'
      : esc((t.name.trim()[0] || '♫').toUpperCase());
    return `
      <li class="row song${cur ? ' current' : ''} ${extraClass}" data-track="${t.id}" ${attrs}>
        <span class="tile" style="--h:${hue(t.name)}">${tile}</span>
        <span class="row-text"><b>${esc(t.name)}</b><small>${this.trackSub(t)}</small></span>
        <button class="more" data-more aria-label="Opciones">${ICON.more}</button>
      </li>`;
  }

  folderRow(f, showPath) {
    const n = store.tracksDeep(f.id).length;
    const subs = store.childFolders(f.id).length;
    const info = [`${n} ${n === 1 ? 'canción' : 'canciones'}`];
    if (subs) info.push(`${subs} ${subs === 1 ? 'carpeta' : 'carpetas'}`);
    const path = showPath && f.parentId ? `${esc(store.folderPath(f.parentId))} › ` : '';
    return `
      <li class="row folder" data-folder="${f.id}">
        <span class="tile folder-tile">${ICON.folder}</span>
        <span class="row-text"><b>${path}${esc(f.name)}</b><small>${info.join(' · ')}</small></span>
        <button class="more" data-more aria-label="Opciones">${ICON.more}</button>
        ${ICON.chevron}
      </li>`;
  }

  /* ───────────── pestaña Cola ───────────── */

  renderQueue() {
    const el = $('#tab-queue');
    const a = this.automix;
    const q = this.queue;
    if (!q.length) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${ICON.all}</div>
          <b>La cola está vacía</b>
          <p>Ve a la biblioteca y toca una canción para que suene a continuación.</p>
          <button class="btn pill add" data-go="library">Ir a la biblioteca</button>
        </div>`;
      return;
    }
    const t = a.trans;
    const base = a.running ? (t ? t.idx : a.index) : a.cursor - 1;
    const parts = [];
    if (a.running) {
      parts.push('<h4 class="group-title">Sonando</h4><ul class="rows">');
      parts.push(this.trackRow(q[a.index], `data-qi="${a.index}"`));
      if (t && t.idx !== a.index) parts.push(this.trackRow(q[t.idx], `data-qi="${t.idx}"`, 'incoming'));
      parts.push('</ul>');
    }
    const upcoming = [];
    for (let i = base + 1; i < q.length; i++) upcoming.push(i);
    parts.push(`<div class="group-head"><h4 class="group-title">${a.running ? 'A continuación' : 'Pulsa ▶ para empezar'}</h4>${upcoming.length ? '<button class="link-btn" data-clear>Vaciar</button>' : ''}</div>`);
    if (upcoming.length) {
      parts.push('<ul class="rows">');
      upcoming.forEach((i, k) => parts.push(this.trackRow(q[i], `data-qi="${i}"`, k === 0 && a.running ? 'is-next' : '')));
      parts.push('</ul>');
    } else {
      parts.push('<p class="hint">No hay más canciones. Toca una en la biblioteca para que siga.</p>');
    }
    const played = [];
    for (let i = 0; i <= Math.min(base, q.length - 1); i++) if (!(a.running && (i === a.index || (t && i === t.idx)))) played.push(i);
    if (played.length) {
      parts.push('<h4 class="group-title">Ya sonaron</h4><ul class="rows dim">');
      played.reverse().forEach((i) => parts.push(this.trackRow(q[i], `data-qi="${i}"`)));
      parts.push('</ul>');
    }
    parts.push(`<button class="btn pill add-more" data-go="library">${ICON.addq} Añadir canciones</button>`);
    el.innerHTML = parts.join('');
  }

  onQueueClick(e) {
    if (e.target.closest('[data-go]')) { this.setTab('library'); return; }
    if (e.target.closest('[data-clear]')) {
      if (this.automix.clearUpcoming()) this.toast('Cola vaciada');
      return;
    }
    const li = e.target.closest('li[data-qi]');
    if (!li) return;
    const i = +li.dataset.qi;
    const track = this.queue[i];
    const a = this.automix;
    if (e.target.closest('[data-more]')) {
      const items = [];
      if (!(a.running && i === a.index)) {
        items.push({ label: 'Reproducir a continuación', run: () => { if (a.moveToNext(i)) this.toast(`Sonará a continuación: ${track.name}`); } });
        items.push({ label: 'Quitar de la cola', danger: true, run: () => { if (a.remove(i)) this.toast('Quitada de la cola'); } });
      }
      items.push({ label: 'Añadir a carpeta…', run: () => this.pickFolder([track.id]) });
      this.actions(track.name, items);
      return;
    }
    if (a.running && i === a.index) return;
    if (a.running && !a.held) {
      a.playIndex(i);
      this.toast(`Mezclando hacia: ${track.name}`);
    } else {
      a.start(i);
    }
  }

  /* ───────────── pestaña Biblioteca ───────────── */

  renderLibrary() {
    const nav = $('#lib-nav');
    const chips = $('#lib-actions');
    const rows = $('#lib-rows');
    const query = fold($('#lib-search').value.trim());
    const importChip = (label) => `<label class="chip" for="import-files">${ICON.import} ${label}</label>`;
    const folderChip = canPickFolders ? `<label class="chip" for="import-folder">${ICON.folder} Importar carpeta</label>` : '';

    if (query) {
      nav.innerHTML = '<span class="nav-title small">Resultados</span>';
      chips.innerHTML = '';
      const folders = [...store.folders.values()].filter((f) => fold(f.name).includes(query)).sort(byName);
      const tracks = store.allTracks().filter((t) => fold(t.name).includes(query));
      rows.innerHTML = folders.map((f) => this.folderRow(f, true)).join('') + tracks.map((t) => this.trackRow(t)).join('')
        || '<li class="hint">Sin resultados.</li>';
      return;
    }

    if (this.view && this.view !== 'all' && !store.folders.has(this.view)) this.view = null;

    if (this.view === null) {
      const n = store.tracks.size;
      nav.innerHTML = '<span class="nav-title">Biblioteca</span>';
      chips.innerHTML = `${importChip('Importar canciones')}${folderChip}<button class="chip" data-chip="newfolder">${ICON.newfolder} Nueva carpeta</button>`;
      const folders = store.childFolders(null);
      rows.innerHTML = `
        <li class="row folder all" data-folder="all">
          <span class="tile all-tile">${ICON.all}</span>
          <span class="row-text"><b>Todas las canciones</b><small>${n} ${n === 1 ? 'canción' : 'canciones'}</small></span>
          ${ICON.chevron}
        </li>
        ${folders.map((f) => this.folderRow(f)).join('')}
        ${n ? '' : '<li class="hint">Toca <b>Importar canciones</b> para elegir música de los archivos del teléfono. Después puedes ordenarla en carpetas.</li>'}`;
      return;
    }

    if (this.view === 'all') {
      nav.innerHTML = `<button class="back" data-back>${ICON.back} Biblioteca</button><span class="nav-title">Todas las canciones</span>`;
      chips.innerHTML = `<button class="chip primary" data-chip="playall">${ICON.play} Reproducir</button><button class="chip" data-chip="shuffle">${ICON.shuffle} Aleatorio</button>${importChip('Importar')}`;
      const tracks = store.allTracks();
      rows.innerHTML = tracks.map((t) => this.trackRow(t)).join('') || '<li class="hint">Todavía no hay canciones.</li>';
      return;
    }

    const f = store.folders.get(this.view);
    const parent = f.parentId ? store.folders.get(f.parentId) : null;
    nav.innerHTML = `
      <button class="back" data-back>${ICON.back} ${esc(parent ? parent.name : 'Biblioteca')}</button>
      <span class="nav-title">${esc(f.name)}</span>
      <button class="more" data-folder-more aria-label="Opciones de carpeta">${ICON.more}</button>`;
    chips.innerHTML = `<button class="chip primary" data-chip="playall">${ICON.play} Reproducir</button><button class="chip" data-chip="shuffle">${ICON.shuffle} Aleatorio</button><button class="chip" data-chip="queueall">${ICON.addq} A la cola</button>${importChip('Importar aquí')}<button class="chip" data-chip="newfolder">${ICON.newfolder} Subcarpeta</button>`;
    const subs = store.childFolders(f.id);
    const tracks = store.tracksIn(f.id);
    rows.innerHTML = subs.map((s) => this.folderRow(s)).join('') + tracks.map((t) => this.trackRow(t)).join('')
      || '<li class="hint">Carpeta vacía. Importa canciones aquí o usa <b>⋯ → Añadir a carpeta</b> en cualquier canción.</li>';
  }

  currentFolderId() {
    return this.view && this.view !== 'all' ? this.view : null;
  }

  viewTracks() {
    if (this.view === 'all') return store.allTracks();
    return this.view ? store.tracksDeep(this.view) : [];
  }

  onNavClick(e) {
    if (e.target.closest('[data-back]')) {
      const f = store.folders.get(this.view);
      this.view = f && f.parentId ? f.parentId : null;
      this.renderLibrary();
      $('#sheet-body').scrollTop = 0;
      return;
    }
    if (e.target.closest('[data-folder-more]')) this.folderActions(store.folders.get(this.view));
  }

  async onChipClick(e) {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    const a = this.automix;
    const tracks = this.viewTracks().filter((t) => !t.unreadable);
    switch (chip.dataset.chip) {
      case 'newfolder': {
        const name = await this.ask({ title: 'Nueva carpeta', placeholder: 'Nombre', ok: 'Crear' });
        if (name) {
          const f = await store.createFolder(name, this.currentFolderId());
          this.toast(`Carpeta creada: ${f.name}`);
        }
        break;
      }
      case 'playall':
      case 'shuffle': {
        if (!tracks.length) { this.toast('No hay canciones aquí'); break; }
        const list = chip.dataset.chip === 'shuffle' ? shuffle([...tracks]) : tracks;
        a.replaceQueue(list, 0);
        this.toast(`Reproduciendo ${list.length} ${list.length === 1 ? 'canción' : 'canciones'}`);
        this.setTab('queue');
        break;
      }
      case 'queueall':
        for (const t of tracks) a.append(t);
        this.toast(`${tracks.length} añadidas a la cola`);
        break;
    }
  }

  onLibraryClick(e) {
    const li = e.target.closest('li');
    if (!li) return;
    if (li.dataset.folder) {
      if (e.target.closest('[data-more]')) { this.folderActions(store.folders.get(li.dataset.folder)); return; }
      this.view = li.dataset.folder;
      $('#lib-search').value = '';
      this.renderLibrary();
      $('#sheet-body').scrollTop = 0;
      return;
    }
    const track = store.tracks.get(li.dataset.track);
    if (!track) return;
    if (e.target.closest('[data-more]')) { this.trackActions(track); return; }
    this.playNext(track);
  }

  playNext(track) {
    if (track.unreadable) { this.toast('Este archivo no se puede reproducir'); return; }
    if (this.isCurrent(track)) { this.toast('Ya está sonando'); return; }
    const how = this.automix.playNext(track);
    this.toast(how === 'now' ? `Reproduciendo: ${track.name}` : `Sonará a continuación: ${track.name}`);
  }

  trackActions(track) {
    const a = this.automix;
    const folderId = this.currentFolderId();
    const items = [
      { label: 'Reproducir a continuación', run: () => this.playNext(track) },
      { label: 'Añadir al final de la cola', run: () => { a.append(track); this.toast('Añadida a la cola'); } },
      { label: 'Añadir a carpeta…', run: () => this.pickFolder([track.id]) },
    ];
    if (folderId && store.folders.get(folderId).trackIds.includes(track.id)) {
      items.push({ label: 'Quitar de esta carpeta', run: () => store.removeFromFolder(folderId, track.id) });
    }
    items.push({ label: 'Eliminar de la app', danger: true, run: () => this.deleteTrack(track) });
    this.actions(track.name, items);
  }

  folderActions(f) {
    const a = this.automix;
    this.actions(f.name, [
      { label: 'Reproducir carpeta', run: () => { const t = store.tracksDeep(f.id); if (t.length) { a.replaceQueue(t, 0); this.toast(`Reproduciendo ${f.name}`); } } },
      { label: 'Añadir a la cola', run: () => { const t = store.tracksDeep(f.id); t.forEach((x) => a.append(x)); this.toast(`${t.length} añadidas a la cola`); } },
      { label: 'Renombrar', run: async () => { const n = await this.ask({ title: 'Renombrar carpeta', value: f.name, ok: 'Guardar' }); if (n) store.renameFolder(f.id, n); } },
      { label: 'Eliminar carpeta', danger: true, run: () => this.deleteFolder(f) },
    ]);
  }

  // Elegir carpeta destino (con opción de crear una nueva).
  pickFolder(trackIds) {
    const all = [...store.folders.values()].map((f) => ({ f, path: store.folderPath(f.id) })).sort((x, y) => x.path.localeCompare(y.path, 'es'));
    const add = async (folderId, name) => {
      const n = await store.addToFolder(folderId, trackIds);
      this.toast(n ? `Añadida a ${name}` : `Ya estaba en ${name}`);
    };
    this.actions('Añadir a carpeta', [
      { label: '＋ Nueva carpeta…', run: async () => {
        const name = await this.ask({ title: 'Nueva carpeta', placeholder: 'Nombre', ok: 'Crear' });
        if (name) { const f = await store.createFolder(name, null); add(f.id, f.name); }
      } },
      ...all.map(({ f, path }) => ({ label: path, run: () => add(f.id, f.name) })),
    ]);
  }

  async deleteTrack(track) {
    const ok = await this.ask({ title: 'Eliminar canción', message: `"${track.name}" se borrará de la app y de todas sus carpetas. El archivo original del teléfono no se toca.`, ok: 'Eliminar', danger: true, input: false });
    if (!ok) return;
    const a = this.automix;
    if (this.isCurrent(track) || (a.trans && this.queue[a.trans.idx] === track)) { this.toast('No se puede borrar mientras suena'); return; }
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i] === track) a.remove(i);
    await store.deleteTrack(track.id);
    this.toast('Canción eliminada');
  }

  async deleteFolder(f) {
    const ok = await this.ask({ title: 'Eliminar carpeta', message: `Se borrará "${f.name}" y sus subcarpetas. Las canciones seguirán en la biblioteca.`, ok: 'Eliminar', danger: true, input: false });
    if (!ok) return;
    if (this.view === f.id) this.view = f.parentId || null;
    await store.deleteFolder(f.id);
    this.toast('Carpeta eliminada');
  }

  /* ───────────── importar desde el teléfono ───────────── */

  async importFiles(input) {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    this.toast('Importando…');
    const added = await store.addFiles(files, this.currentFolderId());
    this.toast(added.length ? `${added.length} ${added.length === 1 ? 'canción importada' : 'canciones importadas'}` : 'No se encontraron archivos de audio');
    if (this.onImported) this.onImported(added);
  }

  // Importa una carpeta del teléfono y crea una carpeta igual en la app.
  async importFolder(input) {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const top = (files[0].webkitRelativePath || '').split('/')[0] || 'Carpeta importada';
    this.toast('Importando carpeta…');
    const folder = await store.createFolder(top, this.currentFolderId());
    const added = await store.addFiles(files, folder.id);
    this.toast(`${added.length} canciones en "${folder.name}"`);
    if (this.onImported) this.onImported(added);
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
