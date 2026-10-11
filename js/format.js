/* format.js — funções puras (sem DOM): nomes de arquivo, front matter, anotações,
   montagem da árvore de arquivos (para exportar/sincronizar) e leitura de volta.
   Funciona no navegador (global `Fmt`) e no Node (require). */
(function (root) {
  'use strict';

  const IMAGE_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  };

  function makeId() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /* ---------- nomes ---------- */

  function extOf(name) {
    const i = String(name).lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  }
  function mimeOf(name) {
    return IMAGE_EXT[extOf(name)] || null;
  }

  // Nome seguro para arquivo/pasta (vale em Linux, macOS, Windows e Git).
  function sanitizeName(name, fallback) {
    let s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
    if (s.length > 100) s = s.slice(0, 100).trim();
    return s || (fallback == null ? 'sem-titulo' : fallback);
  }

  // Imagens: igual ao anterior, mas sem espaços (facilita referenciar no markdown).
  function sanitizeImageName(name) {
    let s = sanitizeName(name, 'imagem').replace(/\s+/g, '-');
    if (!mimeOf(s)) s += '.png';
    return s;
  }

  function normalizeTag(t) {
    return String(t == null ? '' : t)
      .trim()
      .replace(/^#+/, '')
      .toLowerCase()
      .replace(/[\s,;]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  function normalizeTags(list) {
    const out = [];
    for (const t of list || []) {
      const n = normalizeTag(t);
      if (n && !out.includes(n)) out.push(n);
    }
    return out;
  }

  /* ---------- nota <-> texto .md (com front matter) ---------- */

  function parseScalar(v) {
    v = v.trim();
    if (v === '') return '';
    if (v[0] === '"') {
      try { return JSON.parse(v); } catch (e) { return v.replace(/^"|"$/g, ''); }
    }
    if (v[0] === "'") return v.replace(/^'|'$/g, '').replace(/''/g, "'");
    return v;
  }

  function parseList(v) {
    v = v.trim();
    if (v[0] === '[') {
      try {
        const a = JSON.parse(v);
        if (Array.isArray(a)) return a.map(String);
      } catch (e) { /* cai para o formato simples */ }
      v = v.replace(/^\[|\]$/g, '');
    }
    return v.split(',').map(parseScalar).filter((s) => s !== '');
  }

  function parseFrontMatter(block) {
    const meta = {};
    const lines = block.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2];
      if (val === '') {
        const items = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          items.push(parseScalar(lines[++i].replace(/^\s*-\s+/, '')));
        }
        meta[key] = items.length ? items : '';
      } else if (key === 'tags' || key === 'tag') {
        meta[key] = parseList(val);
      } else {
        meta[key] = parseScalar(val);
      }
    }
    return meta;
  }

  function parseDate(v) {
    if (!v) return null;
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? null : t;
  }

  function isoOf(ms) {
    return new Date(ms || Date.now()).toISOString();
  }

  function serializeNote(note) {
    const head = [
      '---',
      'title: ' + JSON.stringify(note.title || ''),
      'tags: ' + JSON.stringify(note.tags || []),
      'created: ' + isoOf(note.createdAt),
      'updated: ' + isoOf(note.updatedAt),
      '---',
    ].join('\n');
    return head + '\n\n' + (note.content || '');
  }

  function parseNote(text, fileBase) {
    text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const out = { title: fileBase || 'Sem título', tags: [], created: null, updated: null, content: text };
    const m = text.match(/^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/);
    if (!m) return out;
    const body = text.slice(m[0].length);
    out.content = body.startsWith('\n') ? body.slice(1) : body;
    const meta = parseFrontMatter(m[1] || '');
    if (typeof meta.title === 'string' && meta.title.trim()) out.title = meta.title.trim();
    let tags = meta.tags != null ? meta.tags : meta.tag;
    if (typeof tags === 'string') tags = parseList(tags);
    out.tags = normalizeTags(Array.isArray(tags) ? tags : []);
    out.created = parseDate(meta.created || meta.date || meta.criado);
    out.updated = parseDate(meta.updated || meta.modified || meta.atualizado);
    return out;
  }

  /* ---------- anotações <-> texto .anotacoes.md ---------- */

  function serializeAnnotations(list) {
    if (!list || !list.length) return '';
    const out = ['# Anotações', ''];
    for (const a of list) {
      const lines = String(a.text || '').split('\n');
      out.push('- [' + (a.done ? 'x' : ' ') + '] ' + lines[0]);
      for (const l of lines.slice(1)) out.push('  ' + l);
      if (a.quote) for (const q of String(a.quote).split('\n')) out.push('  > ' + q);
    }
    return out.join('\n') + '\n';
  }

  function parseAnnotations(text) {
    const items = [];
    let cur = null;
    for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      let m;
      if ((m = raw.match(/^[-*] \[([ xX])\][ \t]?(.*)$/))) {
        cur = { id: makeId(), text: m[2], quote: '', done: m[1].toLowerCase() === 'x', _q: false };
        items.push(cur);
      } else if (cur && (m = raw.match(/^ {2}> ?(.*)$/))) {
        cur.quote += (cur.quote ? '\n' : '') + m[1];
        cur._q = true;
      } else if (cur && !cur._q && /^ {2}/.test(raw)) {
        cur.text += '\n' + raw.slice(2);
      } else if (/^#{1,6}\s/.test(raw) || raw.trim() === '') {
        // títulos e linhas em branco entre itens são ignorados
      } else {
        cur = { id: makeId(), text: raw.trim(), quote: '', done: false, _q: false };
        items.push(cur);
      }
    }
    return items.map((a) => ({ id: a.id, text: a.text.replace(/\s+$/, ''), quote: a.quote, done: a.done }));
  }

  /* ---------- árvore de arquivos ---------- */

  function classify(path) {
    const parts = String(path).split('/');
    const name = parts[parts.length - 1];
    if (parts.some((p) => p === '.git' || p === '.github' || p === 'node_modules')) return null;
    if (name === '.gitkeep') return 'keep';
    const low = name.toLowerCase();
    if (low.endsWith('.anotacoes.md')) return 'annotations';
    if (low.endsWith('.md') || low.endsWith('.markdown')) return 'note';
    if (mimeOf(low)) return 'image';
    return null;
  }

  function isManaged(path) {
    return classify(path) !== null;
  }

  function byAge(a, b) {
    return (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : 1);
  }

  function uniqueName(base, taken, ext) {
    ext = ext || '';
    let name = base;
    let i = 2;
    while (taken.has((name + ext).toLowerCase())) name = base + ' (' + i++ + ')';
    taken.add((name + ext).toLowerCase());
    return name;
  }

  function uniqueNoteBase(base, taken) {
    let name = base;
    let i = 2;
    while (taken.has((name + '.md').toLowerCase()) || taken.has((name + '.anotacoes.md').toLowerCase())) {
      name = base + ' (' + i++ + ')';
    }
    taken.add((name + '.md').toLowerCase());
    taken.add((name + '.anotacoes.md').toLowerCase());
    return name;
  }

  // Monta a lista de arquivos (caminho relativo + conteúdo) que representa os dados.
  function buildSnapshot(data) {
    const folders = data.folders || [];
    const notes = data.notes || [];
    const images = data.images || [];
    const folderIds = new Set(folders.map((f) => f.id));
    const kids = new Map();
    const bucket = (id) => {
      const k = id && folderIds.has(id) ? id : '';
      if (!kids.has(k)) kids.set(k, { folders: [], notes: [], images: [] });
      return kids.get(k);
    };
    folders.forEach((f) => bucket(f.parentId).folders.push(f));
    notes.forEach((n) => bucket(n.folderId).notes.push(n));
    images.forEach((i) => bucket(i.folderId).images.push(i));

    const entries = [];
    const paths = { folders: new Map(), notes: new Map(), images: new Map() };

    function walk(id, dir) {
      const b = kids.get(id || '');
      if (!b) {
        if (id) entries.push({ path: dir + '.gitkeep', kind: 'keep', text: '' });
        return;
      }
      const takenDirs = new Set();
      const takenFiles = new Set();
      for (const f of b.folders.slice().sort(byAge)) {
        const name = uniqueName(sanitizeName(f.name, 'pasta'), takenDirs);
        paths.folders.set(f.id, dir + name);
        walk(f.id, dir + name + '/');
      }
      for (const n of b.notes.slice().sort(byAge)) {
        const base = uniqueNoteBase(sanitizeName(n.title), takenFiles);
        paths.notes.set(n.id, dir + base + '.md');
        entries.push({ path: dir + base + '.md', kind: 'note', text: serializeNote(n), note: n });
        if (n.annotations && n.annotations.length) {
          entries.push({ path: dir + base + '.anotacoes.md', kind: 'annotations', text: serializeAnnotations(n.annotations), note: n });
        }
      }
      for (const img of b.images.slice().sort(byAge)) {
        const clean = sanitizeImageName(img.name);
        const ext = extOf(clean);
        const stem = clean.slice(0, clean.length - ext.length - 1);
        const name = uniqueName(stem, takenFiles, '.' + ext) + '.' + ext;
        paths.images.set(img.id, dir + name);
        entries.push({ path: dir + name, kind: 'image', image: img });
      }
    }
    walk(null, '');
    return { entries, paths };
  }

  // Interpreta uma lista de arquivos {path, text?, bytes?} e devolve a estrutura de dados.
  function parseFiles(items) {
    const res = { folders: [], notes: [], images: [], skipped: 0 };
    const ann = new Map();
    const dirSeen = new Set();
    const addDir = (segs) => {
      for (let i = 1; i <= segs.length; i++) {
        const k = segs.slice(0, i).join('/');
        if (!dirSeen.has(k)) { dirSeen.add(k); res.folders.push(segs.slice(0, i)); }
      }
    };
    for (const it of items) {
      const path = String(it.path).replace(/\\/g, '/').replace(/^\/+/, '');
      const kind = path.split('/').some((p) => p === '' || p === '.' || p === '..') ? null : classify(path);
      if (!kind) { res.skipped++; continue; }
      const segs = path.split('/');
      const name = segs.pop();
      addDir(segs);
      if (kind === 'keep') continue;
      if (kind === 'image') {
        res.images.push({ dir: segs, name: sanitizeImageName(name), mime: mimeOf(name), bytes: it.bytes });
      } else if (kind === 'annotations') {
        const base = name.replace(/\.anotacoes\.md$/i, '');
        ann.set(segs.join('/') + '/' + base.toLowerCase(), parseAnnotations(it.text));
      } else {
        const base = name.replace(/\.(md|markdown)$/i, '');
        res.notes.push(Object.assign({ dir: segs, base }, parseNote(it.text, base)));
      }
    }
    const used = new Set();
    for (const n of res.notes) {
      const key = n.dir.join('/') + '/' + n.base.toLowerCase();
      n.annKnown = ann.has(key);
      n.annotations = ann.get(key) || [];
      used.add(key);
    }
    // anotações cujo arquivo .md não veio no mesmo lote (ex.: só elas mudaram no GitHub)
    res.orphanAnn = [];
    ann.forEach((list, key) => {
      if (used.has(key)) return;
      const i = key.lastIndexOf('/');
      res.orphanAnn.push({ dir: key.slice(0, i) ? key.slice(0, i).split('/') : [], base: key.slice(i + 1), annotations: list });
    });
    return res;
  }

  const api = {
    IMAGE_EXT, makeId, extOf, mimeOf, sanitizeName, sanitizeImageName, normalizeTag, normalizeTags,
    serializeNote, parseNote, serializeAnnotations, parseAnnotations,
    classify, isManaged, buildSnapshot, parseFiles,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fmt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
