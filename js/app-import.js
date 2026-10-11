/* app-import.js — aplica dados importados (ZIP, pasta ou GitHub) ao estado. */
(function (root) {
  'use strict';
  const App = root.App;
  const { S, now } = App;

  const joinPath = (dir, name) => (dir.length ? dir.join('/') + '/' : '') + name;
  const sameAnn = (a, b) => a.length === b.length && a.every((x, i) => x.text === b[i].text && x.quote === b[i].quote && !!x.done === !!b[i].done);
  const sameNote = (a, b) => a.title === b.title && a.content === b.content && a.tags.join('\u0001') === b.tags.join('\u0001') && sameAnn(a.annotations, b.annotations);

  function unionAnn(local, remote) {
    const out = local.slice();
    for (const r of remote) if (!out.some((l) => l.text === r.text && l.quote === r.quote)) out.push(r);
    return out;
  }

  async function sameBytes(blob, bytes) {
    if (blob.size !== bytes.length) return false;
    const a = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
    return true;
  }

  /* mode: 'merge' | 'replace'
     opts.remotePaths: Set dos caminhos existentes no repositório (para saber o que não mudou)
     opts.conflicts:   Set dos caminhos alterados dos dois lados (a cópia local é preservada) */
  async function applyImport(parsed, mode, opts) {
    opts = opts || {};
    const ops = [];
    const stat = { folders: 0, notes: 0, updated: 0, images: 0, conflicts: 0 };
    const conflicts = opts.conflicts || new Set();

    const pathToFolder = new Map();
    const pathToNote = new Map();
    const pathToImage = new Map();
    if (mode === 'replace') {
      Array.from(S.images.keys()).forEach(App.forgetImageUrl);
      S.folders.clear(); S.notes.clear(); S.images.clear();
      S.open = null; S.selFolder = null;
      App.pendingNotes.clear();
      ops.push(['clear', 'folders'], ['clear', 'notes'], ['clear', 'images']);
    } else {
      const snap = root.Fmt.buildSnapshot(App.snapshotData());
      snap.paths.folders.forEach((p, id) => pathToFolder.set(p.toLowerCase(), id));
      snap.paths.notes.forEach((p, id) => pathToNote.set(p.toLowerCase(), S.notes.get(id)));
      snap.paths.images.forEach((p, id) => pathToImage.set(p.toLowerCase(), S.images.get(id)));
    }
    App.invalidate();

    function ensureDir(segs) {
      let parent = null;
      let key = '';
      for (const seg of segs) {
        key = key ? key + '/' + seg : seg;
        const k = key.toLowerCase();
        let id = pathToFolder.get(k);
        if (!id) {
          const f = { id: root.Fmt.makeId(), parentId: parent, name: seg, createdAt: now(), updatedAt: now() };
          S.folders.set(f.id, f);
          ops.push(['put', 'folders', f]);
          id = f.id;
          pathToFolder.set(k, id);
          stat.folders++;
        }
        parent = id;
      }
      return parent;
    }

    for (const segs of parsed.folders) ensureDir(segs);

    for (const n of parsed.notes) {
      const folderId = ensureDir(n.dir);
      const p = joinPath(n.dir, n.base + '.md');
      const annPath = joinPath(n.dir, n.base + '.anotacoes.md');
      const ex = pathToNote.get(p.toLowerCase());
      let ann;
      if (n.annKnown) ann = ex && conflicts.has(annPath) ? unionAnn(ex.annotations, n.annotations) : n.annotations;
      else if (opts.remotePaths && opts.remotePaths.has(annPath)) ann = ex ? ex.annotations : [];
      else ann = [];
      const next = { title: n.title, content: n.content, tags: n.tags, annotations: ann };
      if (ex) {
        if (sameNote(ex, next)) continue;
        if (conflicts.has(p)) {
          const copy = Object.assign({}, ex, {
            id: root.Fmt.makeId(), title: (ex.title || 'Sem título') + ' (conflito local ' + new Date().toLocaleDateString('pt-BR') + ')',
            tags: ex.tags.slice(), annotations: ex.annotations.map((a) => Object.assign({}, a, { id: root.Fmt.makeId() })), createdAt: now(),
          });
          S.notes.set(copy.id, copy);
          ops.push(['put', 'notes', copy]);
          stat.conflicts++;
        }
        Object.assign(ex, next);
        ex.updatedAt = n.updated || now();
        App.pendingNotes.delete(ex.id);
        ops.push(['put', 'notes', ex]);
        stat.updated++;
      } else {
        const note = Object.assign({ id: root.Fmt.makeId(), folderId, createdAt: n.created || now(), updatedAt: n.updated || now() }, next);
        S.notes.set(note.id, note);
        pathToNote.set(p.toLowerCase(), note);
        ops.push(['put', 'notes', note]);
        stat.notes++;
      }
    }

    for (const o of parsed.orphanAnn || []) {
      const ex = pathToNote.get(joinPath(o.dir, o.base + '.md').toLowerCase());
      if (!ex) continue;
      const annPath = joinPath(o.dir, o.base + '.anotacoes.md');
      const merged = conflicts.has(annPath) ? unionAnn(ex.annotations, o.annotations) : o.annotations;
      if (sameAnn(ex.annotations, merged)) continue;
      ex.annotations = merged;
      ex.updatedAt = now();
      App.pendingNotes.delete(ex.id);
      ops.push(['put', 'notes', ex]);
      stat.updated++;
    }

    for (const im of parsed.images) {
      const folderId = ensureDir(im.dir);
      const p = joinPath(im.dir, im.name);
      const ex = pathToImage.get(p.toLowerCase());
      const blob = new Blob([im.bytes], { type: im.mime || '' });
      if (ex) {
        if (await sameBytes(ex.blob, im.bytes)) continue;
        if (conflicts.has(p)) {
          const ext = root.Fmt.extOf(im.name);
          const stem = im.name.slice(0, im.name.length - ext.length - 1);
          App.invalidate();
          const copy = { id: root.Fmt.makeId(), folderId, name: App.uniqueImageName(folderId, stem + '-remoto.' + ext), mime: im.mime, size: blob.size, blob, version: 0, createdAt: now(), updatedAt: now() };
          S.images.set(copy.id, copy);
          ops.push(['put', 'images', copy]);
          stat.conflicts++;
        } else {
          App.forgetImageUrl(ex.id);
          Object.assign(ex, { blob, size: blob.size, mime: im.mime, version: (ex.version || 0) + 1, updatedAt: now() });
          ops.push(['put', 'images', ex]);
          stat.updated++;
        }
      } else {
        const img = { id: root.Fmt.makeId(), folderId, name: im.name, mime: im.mime, size: blob.size, blob, version: 0, createdAt: now(), updatedAt: now() };
        S.images.set(img.id, img);
        pathToImage.set(p.toLowerCase(), img);
        ops.push(['put', 'images', img]);
        stat.images++;
      }
    }

    App.invalidate();
    await root.Banco.batch(ops);
    App.renderSidebar();
    App.refreshOpen();
    return stat;
  }

  App.applyImport = applyImport;
})(typeof globalThis !== 'undefined' ? globalThis : this);
