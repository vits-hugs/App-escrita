/* app-core.js — estado, persistência e ações sobre pastas/notas/imagens. Global: App */
(function (root) {
  'use strict';
  const { toast, confirmBox, promptBox, modal, h } = root.UI;
  const App = (root.App = {});

  const store = {
    get(k, d) { try { const v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignora */ } },
  };
  const now = () => Date.now();
  const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

  const S = {
    folders: new Map(), notes: new Map(), images: new Map(),
    open: null,                      // { type: 'note'|'image', id }
    selFolder: null,
    expanded: new Set(store.get('ea.expanded', [])),
    mode: store.get('ea.mode', 'write'),
    sort: store.get('ea.sort', 'name'),
    query: '', tags: new Set(), hideDone: false,
  };
  Object.assign(App, { S, store, now, collator });

  /* ---------- índice da árvore ---------- */
  let idx = null;
  const EMPTY = { folders: [], notes: [], images: [] };
  function index() {
    if (idx) return idx;
    idx = new Map();
    const b = (id) => {
      const k = id && S.folders.has(id) ? id : '';
      let o = idx.get(k);
      if (!o) { o = { folders: [], notes: [], images: [] }; idx.set(k, o); }
      return o;
    };
    S.folders.forEach((f) => b(f.parentId).folders.push(f));
    S.notes.forEach((n) => b(n.folderId).notes.push(n));
    S.images.forEach((i) => b(i.folderId).images.push(i));
    return idx;
  }
  const invalidate = () => { idx = null; };
  const kidsOf = (id) => index().get(id || '') || EMPTY;

  function sortedKids(id) {
    const k = kidsOf(id);
    const nameCmp = (a, b) => collator.compare(a.name, b.name);
    const noteCmp = S.sort === 'recent' ? (a, b) => b.updatedAt - a.updatedAt : (a, b) => collator.compare(a.title || '', b.title || '');
    return { folders: k.folders.slice().sort(nameCmp), notes: k.notes.slice().sort(noteCmp), images: k.images.slice().sort(nameCmp) };
  }

  function folderChain(id) {
    const out = [];
    const seen = new Set();
    let cur = id;
    while (cur && S.folders.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const f = S.folders.get(cur);
      out.unshift(f);
      cur = f.parentId;
    }
    return out;
  }
  const pathLabel = (folderId) => ['raiz'].concat(folderChain(folderId).map((f) => f.name)).join(' / ');

  function descendantFolderIds(id) {
    const out = new Set([id]);
    const walk = (p) => kidsOf(p).folders.forEach((f) => { if (!out.has(f.id)) { out.add(f.id); walk(f.id); } });
    walk(id);
    return out;
  }

  function folderOptions(exclude) {
    const out = [{ id: '', label: '(raiz)' }];
    const walk = (pid, depth) => {
      for (const f of sortedKids(pid).folders) {
        if (exclude && exclude.has(f.id)) continue;
        out.push({ id: f.id, label: '  '.repeat(depth) + (depth ? '↳ ' : '') + f.name });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  /* ---------- caminhos relativos (imagens e links) ---------- */
  function relPath(target, fromFolderId) {
    const from = folderChain(fromFolderId).map((f) => f.id);
    const to = folderChain(target.folderId).map((f) => f.id);
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    const segs = Array(from.length - i).fill('..')
      .concat(to.slice(i).map((id) => root.Fmt.sanitizeName(S.folders.get(id).name, 'pasta')), [target.name]);
    return segs.map((s) => (s === '..' ? s : encodeURIComponent(s))).join('/');
  }

  function resolvePath(fromFolder, rel) {
    let p = String(rel).split('#')[0].split('?')[0];
    try { p = decodeURIComponent(p); } catch (e) { /* mantém */ }
    let cur = p.startsWith('/') ? null : (fromFolder || null);
    const parts = p.split('/').filter((s) => s !== '' && s !== '.');
    const name = parts.pop();
    if (!name) return null;
    for (const s of parts) {
      if (s === '..') { const f = cur && S.folders.get(cur); cur = (f && f.parentId) || null; continue; }
      const low = s.toLowerCase();
      const f = kidsOf(cur).folders.find((x) => x.name.toLowerCase() === low || root.Fmt.sanitizeName(x.name, 'pasta').toLowerCase() === low);
      if (!f) return null;
      cur = f.id;
    }
    return { folderId: cur, name };
  }

  const findImage = (fid, name) => kidsOf(fid).images.find((i) => i.name.toLowerCase() === name.toLowerCase()) || null;
  function findNoteByFile(fid, fileName) {
    const base = root.Busca.fold(fileName.replace(/\.(md|markdown)$/i, ''));
    return kidsOf(fid).notes.find((n) => root.Busca.fold(n.title) === base || root.Busca.fold(root.Fmt.sanitizeName(n.title)) === base) || null;
  }
  function findNoteByTitle(title, near) {
    const f = root.Busca.fold(title.trim());
    const all = [];
    S.notes.forEach((n) => { if (root.Busca.fold(n.title.trim()) === f) all.push(n); });
    return all.find((n) => (n.folderId || null) === (near || null)) || all[0] || null;
  }
  Object.assign(App, { index, invalidate, kidsOf, sortedKids, folderChain, pathLabel, descendantFolderIds, folderOptions, relPath, resolvePath, findImage, findNoteByFile, findNoteByTitle });

  /* ---------- URLs de imagem ---------- */
  const imageUrls = new Map();
  function imageUrl(img) {
    let u = imageUrls.get(img.id);
    if (!u) { u = URL.createObjectURL(img.blob); imageUrls.set(img.id, u); }
    return u;
  }
  function forgetImageUrl(id) {
    const u = imageUrls.get(id);
    if (u) { URL.revokeObjectURL(u); imageUrls.delete(id); }
  }
  App.imageUrl = imageUrl;
  App.forgetImageUrl = forgetImageUrl;

  /* ---------- salvar ---------- */
  const pendingNotes = new Set();
  function setStatus(t) { const el = document.getElementById('status'); if (el) el.textContent = t; }
  async function flush() {
    if (!pendingNotes.size) return;
    const ops = [];
    for (const id of Array.from(pendingNotes)) { const n = S.notes.get(id); if (n) ops.push(['put', 'notes', n]); }
    pendingNotes.clear();
    try {
      await root.Banco.batch(ops);
      setStatus('Salvo');
      const u = document.getElementById('updated');
      if (u && S.open && S.notes.get(S.open.id)) u.textContent = 'Atualizada em ' + root.UI.fmtDate(S.notes.get(S.open.id).updatedAt);
    } catch (e) {
      setStatus('Erro ao salvar');
      toast('Não consegui salvar: ' + e.message, 'error');
    }
  }
  const saveSoon = root.UI.debounce(flush, 500);
  function touch(n) {
    n.updatedAt = now();
    pendingNotes.add(n.id);
    setStatus('Salvando…');
    saveSoon();
  }
  const persistExpanded = () => store.set('ea.expanded', Array.from(S.expanded));
  const snapshotData = () => ({ folders: Array.from(S.folders.values()), notes: Array.from(S.notes.values()), images: Array.from(S.images.values()) });
  Object.assign(App, { flush, touch, setStatus, persistExpanded, snapshotData, pendingNotes });

  /* ---------- criar ---------- */
  async function createFolder(parentId) {
    const name = await promptBox({ title: 'Nova pasta', label: 'Nome da pasta', placeholder: 'Ex.: Contos' });
    if (!name) return;
    const f = { id: root.Fmt.makeId(), parentId: parentId || null, name, createdAt: now(), updatedAt: now() };
    S.folders.set(f.id, f);
    invalidate();
    if (parentId) S.expanded.add(parentId);
    S.expanded.add(f.id);
    S.selFolder = f.id;
    persistExpanded();
    await root.Banco.batch([['put', 'folders', f]]);
    App.renderSidebar();
  }

  async function createNote(folderId, init) {
    init = init || {};
    const n = {
      id: root.Fmt.makeId(), folderId: folderId || null, title: init.title || '', content: init.content || '',
      annotations: [], tags: init.tags || [], createdAt: now(), updatedAt: now(),
    };
    S.notes.set(n.id, n);
    invalidate();
    if (folderId) S.expanded.add(folderId);
    persistExpanded();
    await root.Banco.batch([['put', 'notes', n]]);
    App.openNote(n.id, { focusTitle: true });
    return n;
  }

  async function duplicateNote(id) {
    const o = S.notes.get(id);
    if (!o) return;
    const n = Object.assign({}, o, {
      id: root.Fmt.makeId(), title: (o.title || 'Sem título') + ' (cópia)', createdAt: now(), updatedAt: now(),
      tags: o.tags.slice(), annotations: o.annotations.map((a) => Object.assign({}, a, { id: root.Fmt.makeId() })),
    });
    S.notes.set(n.id, n);
    invalidate();
    await root.Banco.batch([['put', 'notes', n]]);
    App.openNote(n.id);
  }

  /* ---------- imagens ---------- */
  function uniqueImageName(folderId, name, exceptId) {
    const taken = new Set(kidsOf(folderId).images.filter((i) => i.id !== exceptId).map((i) => i.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    const ext = root.Fmt.extOf(name);
    const stem = name.slice(0, name.length - ext.length - 1);
    let i = 2;
    while (taken.has((stem + '-' + i + '.' + ext).toLowerCase())) i++;
    return stem + '-' + i + '.' + ext;
  }
  const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})/, '$1-');

  async function addImages(files, folderId) {
    const list = Array.from(files).filter((f) => (f.type || '').startsWith('image/') || root.Fmt.mimeOf(f.name || ''));
    if (!list.length) { toast('Nenhuma imagem válida encontrada.', 'error'); return []; }
    const ops = [];
    const out = [];
    for (const f of list) {
      let name = f.name || '';
      if (!name || /^image\.\w+$/i.test(name)) name = 'imagem-' + stamp() + '.' + ((f.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      name = uniqueImageName(folderId, root.Fmt.sanitizeImageName(name));
      const img = {
        id: root.Fmt.makeId(), folderId: folderId || null, name, mime: f.type || root.Fmt.mimeOf(name),
        size: f.size, blob: f, version: 0, createdAt: now(), updatedAt: now(),
      };
      S.images.set(img.id, img);
      invalidate();
      ops.push(['put', 'images', img]);
      out.push(img);
    }
    if (folderId) { S.expanded.add(folderId); persistExpanded(); }
    await root.Banco.batch(ops);
    App.renderSidebar();
    return out;
  }
  async function pickAndAddImages(folderId) {
    const files = await root.UI.pickFiles({ accept: 'image/*', multiple: true });
    if (files.length) {
      const imgs = await addImages(files, folderId);
      if (imgs.length) toast(imgs.length + ' imagem(ns) adicionada(s).');
    }
  }
  const mdImage = (img, fromFolderId) => '![' + img.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') + '](' + relPath(img, fromFolderId) + ')';
  Object.assign(App, { addImages, pickAndAddImages, mdImage, uniqueImageName });

  // Atualiza referências ![..](caminho) quando uma imagem muda de nome/pasta.
  function rewriteImageRefs(before, after) {
    const ops = [];
    let openChanged = false;
    for (const n of S.notes.values()) {
      const a = relPath(before, n.folderId);
      const b = relPath(after, n.folderId);
      if (a === b) continue;
      const needle = '](' + a + ')';
      if (!n.content.includes(needle)) continue;
      n.content = n.content.split(needle).join('](' + b + ')');
      n.updatedAt = now();
      ops.push(['put', 'notes', n]);
      if (S.open && S.open.id === n.id) openChanged = true;
    }
    return { ops, openChanged };
  }

  // Atualiza [[Título]] quando uma nota é renomeada.
  function renameLinks(oldTitle, newTitle, skipId) {
    const ops = [];
    if (!oldTitle || oldTitle === newTitle) return ops;
    for (const n of S.notes.values()) {
      if (n.id === skipId) continue;
      if (!n.content.includes('[[' + oldTitle)) continue;
      const c = n.content.split('[[' + oldTitle + ']]').join('[[' + newTitle + ']]').split('[[' + oldTitle + '|').join('[[' + newTitle + '|');
      if (c !== n.content) { n.content = c; n.updatedAt = now(); ops.push(['put', 'notes', n]); }
    }
    return ops;
  }
  App.renameLinks = renameLinks;

  /* ---------- renomear ---------- */
  async function renameEntity(type, id) {
    if (type === 'folder') {
      const f = S.folders.get(id);
      const name = await promptBox({ title: 'Renomear pasta', label: 'Novo nome', value: f.name });
      if (!name || name === f.name) return;
      f.name = name; f.updatedAt = now();
      invalidate();
      await root.Banco.batch([['put', 'folders', f]]);
    } else if (type === 'note') {
      const n = S.notes.get(id);
      const title = await promptBox({ title: 'Renomear nota', label: 'Novo título', value: n.title });
      if (title == null || title === n.title) return;
      const old = n.title;
      n.title = title; touch(n);
      const ops = renameLinks(old, title, n.id).concat([['put', 'notes', n]]);
      pendingNotes.delete(n.id);
      await root.Banco.batch(ops);
      if (ops.length > 1) toast('Links [[…]] atualizados em ' + (ops.length - 1) + ' nota(s).');
    } else {
      const img = S.images.get(id);
      let name = await promptBox({ title: 'Renomear imagem', label: 'Novo nome (sem espaços)', value: img.name });
      if (!name || name === img.name) return;
      if (!root.Fmt.mimeOf(name)) name += '.' + root.Fmt.extOf(img.name);
      name = uniqueImageName(img.folderId, root.Fmt.sanitizeImageName(name), img.id);
      const before = { folderId: img.folderId, name: img.name };
      img.name = name; img.updatedAt = now();
      invalidate();
      const r = rewriteImageRefs(before, img);
      await root.Banco.batch(r.ops.concat([['put', 'images', img]]));
      if (r.ops.length) toast('Referências atualizadas em ' + r.ops.length + ' nota(s).');
    }
    App.renderSidebar();
    App.refreshOpen();
  }

  /* ---------- mover ---------- */
  async function moveEntity(type, id, target) {
    target = target || null;
    const ops = [];
    if (type === 'folder') {
      const f = S.folders.get(id);
      if (!f || (f.parentId || null) === target) return;
      if (target && descendantFolderIds(id).has(target)) { toast('Não dá para mover uma pasta para dentro dela mesma.', 'error'); return; }
      f.parentId = target; f.updatedAt = now();
      ops.push(['put', 'folders', f]);
    } else if (type === 'note') {
      const n = S.notes.get(id);
      if (!n || (n.folderId || null) === target) return;
      n.folderId = target; touch(n);
      pendingNotes.delete(n.id);
      ops.push(['put', 'notes', n]);
    } else {
      const img = S.images.get(id);
      if (!img || (img.folderId || null) === target) return;
      const before = { folderId: img.folderId, name: img.name };
      img.folderId = target;
      invalidate();
      img.name = uniqueImageName(target, img.name, img.id);
      img.updatedAt = now();
      const r = rewriteImageRefs(before, img);
      ops.push(['put', 'images', img], ...r.ops);
      if (r.ops.length) toast('Referências atualizadas em ' + r.ops.length + ' nota(s).');
    }
    invalidate();
    if (target) { S.expanded.add(target); persistExpanded(); }
    await root.Banco.batch(ops);
    App.renderSidebar();
    App.refreshOpen();
  }

  async function moveDialog(type, id) {
    const exclude = type === 'folder' ? descendantFolderIds(id) : null;
    const cur = type === 'folder' ? S.folders.get(id).parentId : type === 'note' ? S.notes.get(id).folderId : S.images.get(id).folderId;
    const sel = h('select', { 'aria-label': 'Pasta de destino' }, App.folderOptions(exclude).map((o) => h('option', { value: o.id, selected: o.id === (cur || '') }, o.label)));
    const r = await modal({
      title: 'Mover para…', body: [h('label', { class: 'field' }, h('span', null, 'Pasta de destino'), sel)],
      buttons: [{ label: 'Cancelar', value: null }, { label: 'Mover', value: 'ok', kind: 'primary' }],
    });
    if (r === 'ok') await moveEntity(type, id, sel.value || null);
  }

  /* ---------- excluir ---------- */
  async function deleteEntity(type, id) {
    const ops = [];
    if (type === 'note') {
      const n = S.notes.get(id);
      if (!(await confirmBox('Excluir a nota “' + (n.title || 'Sem título') + '”? Isso não pode ser desfeito.', { danger: true, okLabel: 'Excluir', title: 'Excluir nota' }))) return;
      S.notes.delete(id); pendingNotes.delete(id);
      ops.push(['del', 'notes', id]);
    } else if (type === 'image') {
      const img = S.images.get(id);
      if (!(await confirmBox('Excluir a imagem “' + img.name + '”? As notas que a usam vão mostrar “imagem não encontrada”.', { danger: true, okLabel: 'Excluir', title: 'Excluir imagem' }))) return;
      forgetImageUrl(id); S.images.delete(id);
      ops.push(['del', 'images', id]);
    } else {
      const ids = descendantFolderIds(id);
      let nn = 0; let ni = 0;
      S.notes.forEach((n) => { if (ids.has(n.folderId)) nn++; });
      S.images.forEach((i) => { if (ids.has(i.folderId)) ni++; });
      const f = S.folders.get(id);
      if (!(await confirmBox('Excluir a pasta “' + f.name + '” e tudo dentro dela?\n' + (ids.size - 1) + ' subpasta(s), ' + nn + ' nota(s) e ' + ni + ' imagem(ns) serão apagadas.\nIsso não pode ser desfeito.', { danger: true, okLabel: 'Excluir', title: 'Excluir pasta' }))) return;
      ids.forEach((fid) => { S.folders.delete(fid); ops.push(['del', 'folders', fid]); });
      for (const n of Array.from(S.notes.values())) if (ids.has(n.folderId)) { S.notes.delete(n.id); pendingNotes.delete(n.id); ops.push(['del', 'notes', n.id]); if (S.open && S.open.id === n.id) S.open = null; }
      for (const i of Array.from(S.images.values())) if (ids.has(i.folderId)) { forgetImageUrl(i.id); S.images.delete(i.id); ops.push(['del', 'images', i.id]); if (S.open && S.open.id === i.id) S.open = null; }
      if (ids.has(S.selFolder)) S.selFolder = null;
    }
    if (S.open && S.open.id === id) S.open = null;
    invalidate();
    await root.Banco.batch(ops);
    App.renderSidebar();
    App.renderMain();
  }

  Object.assign(App, { createFolder, createNote, duplicateNote, renameEntity, moveEntity, moveDialog, deleteEntity });
})(typeof globalThis !== 'undefined' ? globalThis : this);
