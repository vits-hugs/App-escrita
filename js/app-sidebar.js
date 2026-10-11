/* app-sidebar.js — barra lateral: árvore de pastas, tags, resultados de busca, arrastar e soltar. */
(function (root) {
  'use strict';
  const App = root.App;
  const { S, store } = App;
  const { h, icon, menu } = root.UI;
  const $ = (s) => document.querySelector(s);
  const searchCache = new Map();

  function hasFilter() {
    if (S.tags.size) return true;
    const q = root.Busca.parseQuery(S.query);
    return !!(q.phrases.length || q.words.length || q.tags.length);
  }

  /* ---------- tags ---------- */
  function tagCounts() {
    const c = new Map();
    S.notes.forEach((n) => n.tags.forEach((t) => c.set(t, (c.get(t) || 0) + 1)));
    return c;
  }

  function renderTagsPanel() {
    const counts = tagCounts();
    for (const t of Array.from(S.tags)) if (!counts.has(t)) S.tags.delete(t);
    $('#taglist').replaceChildren(...Array.from(counts.keys()).sort().map((t) => h('option', { value: t })));
    const box = $('#tags-body');
    box.replaceChildren();
    $('#tags-count').textContent = counts.size ? String(counts.size) : '';
    if (!counts.size) { box.append(h('p', { class: 'hint' }, 'As tags que você criar nas notas aparecem aqui para filtrar.')); return; }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
    box.append(h('div', { class: 'chips' }, sorted.map(([t, n]) => h('button', {
      type: 'button', class: 'chip tag' + (S.tags.has(t) ? ' on' : ''), 'aria-pressed': S.tags.has(t),
      onclick: () => { if (S.tags.has(t)) S.tags.delete(t); else S.tags.add(t); renderSidebar(); },
    }, '#' + t, h('small', null, n)))));
    if (S.tags.size) box.append(h('button', { type: 'button', class: 'link-btn', onclick: () => { S.tags.clear(); renderSidebar(); } }, 'limpar filtros de tag'));
  }

  /* ---------- árvore ---------- */
  function row(type, id, depth, kids) {
    const sel = (type === 'folder' && S.selFolder === id && !S.open) || (S.open && S.open.id === id);
    return h('div', {
      class: 'row ' + type + (sel ? ' selected' : ''), role: 'treeitem', tabindex: '0', draggable: 'true',
      dataset: { type, id }, style: { paddingLeft: (8 + depth * 16) + 'px' },
    }, kids);
  }

  function renderTree(box) {
    const rows = [];
    const walk = (fid, depth) => {
      const k = App.sortedKids(fid);
      for (const f of k.folders) {
        const open = S.expanded.has(f.id);
        const c = App.kidsOf(f.id);
        rows.push(row('folder', f.id, depth, [
          h('span', { class: 'caret' + (open ? ' open' : '') }), icon(open ? 'folderOpen' : 'folder', 17),
          h('span', { class: 'name' }, f.name), h('span', { class: 'count' }, c.folders.length + c.notes.length + c.images.length || ''),
          h('button', { type: 'button', class: 'row-more', dataset: { act: 'menu' }, 'aria-label': 'Mais ações' }, icon('more', 16)),
        ]));
        if (open) walk(f.id, depth + 1);
      }
      for (const n of k.notes) {
        rows.push(row('note', n.id, depth, [
          h('span', { class: 'caret none' }), icon('note', 17), h('span', { class: 'name' }, n.title || 'Sem título'),
          h('button', { type: 'button', class: 'row-more', dataset: { act: 'menu' }, 'aria-label': 'Mais ações' }, icon('more', 16)),
        ]));
      }
      for (const im of k.images) {
        rows.push(row('image', im.id, depth, [
          h('span', { class: 'caret none' }), icon('image', 17), h('span', { class: 'name' }, im.name),
          h('button', { type: 'button', class: 'row-more', dataset: { act: 'menu' }, 'aria-label': 'Mais ações' }, icon('more', 16)),
        ]));
      }
    };
    walk(null, 0);
    if (!rows.length) box.append(h('p', { class: 'hint pad' }, 'Nada por aqui ainda. Crie uma pasta ou uma nota para começar.'));
    box.append(...rows);
  }

  /* ---------- resultados de busca ---------- */
  function snippetEl(sn) {
    const span = h('span', { class: 'snippet' }, sn.before + sn.match + sn.after);
    App.highlightTerms(span, S.query);
    return span;
  }

  function renderResults(box) {
    const res = root.Busca.search(Array.from(S.notes.values()), S.query, { tags: S.tags, cache: searchCache });
    box.append(h('div', { class: 'results-head' },
      h('strong', null, res.length === 1 ? '1 resultado' : res.length + ' resultados'),
      h('button', { type: 'button', class: 'link-btn', onclick: App.clearSearch }, 'limpar busca')));
    if (!res.length) { box.append(h('p', { class: 'hint pad' }, 'Nada encontrado. A busca ignora maiúsculas e acentos; use "aspas" para uma frase exata.')); return; }
    for (const r of res.slice(0, 100)) {
      const n = r.note;
      box.append(h('div', {
        class: 'result' + (S.open && S.open.id === n.id ? ' selected' : ''), role: 'button', tabindex: '0', dataset: { id: n.id },
        onclick: () => App.openNote(n.id, r.field ? { field: r.field, start: r.start, len: r.len } : null),
        onkeydown: (e) => { if (e.key === 'Enter') App.openNote(n.id, r.field ? { field: r.field, start: r.start, len: r.len } : null); },
      },
      h('div', { class: 'result-title' }, icon('note', 16), h('span', null, n.title || 'Sem título')),
      h('div', { class: 'result-path' }, App.pathLabel(n.folderId) + (r.field === 'annotations' ? ' · nas anotações' : '')),
      r.snippet ? snippetEl(r.snippet) : h('span', { class: 'snippet dim' }, r.excerpt || '(vazia)'),
      n.tags.length ? h('div', { class: 'result-tags' }, n.tags.map((t) => '#' + t).join(' ')) : null));
    }
    if (res.length > 100) box.append(h('p', { class: 'hint pad' }, 'Mostrando os 100 primeiros. Refine a busca para ver o resto.'));
  }

  function renderSidebar() {
    renderTagsPanel();
    $('#ctx-path').textContent = App.pathLabel(S.selFolder);
    const box = $('#tree');
    box.replaceChildren();
    box.classList.toggle('filtering', hasFilter());
    if (hasFilter()) renderResults(box); else renderTree(box);
    $('#search-clear').hidden = !S.query;
  }
  const renderSidebarSoon = root.UI.debounce(renderSidebar, 250);

  /* ---------- ações ---------- */
  function activate(type, id) {
    if (type === 'folder') {
      S.selFolder = id;
      if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id);
      App.persistExpanded();
      renderSidebar();
    } else if (type === 'note') App.openNote(id);
    else App.openImage(id);
  }

  function openRowMenu(type, id, anchor) {
    const items = type === 'folder' ? [
      { label: 'Nova nota aqui', icon: 'note', onClick: () => App.createNote(id) },
      { label: 'Nova subpasta', icon: 'folder', onClick: () => App.createFolder(id) },
      { label: 'Adicionar imagem…', icon: 'image', onClick: () => App.pickAndAddImages(id) },
      { sep: true },
      { label: 'Renomear', icon: 'edit', onClick: () => App.renameEntity('folder', id) },
      { label: 'Mover para…', onClick: () => App.moveDialog('folder', id) },
      { sep: true },
      { label: 'Excluir pasta', icon: 'trash', danger: true, onClick: () => App.deleteEntity('folder', id) },
    ] : type === 'note' ? [
      { label: 'Abrir', icon: 'note', onClick: () => App.openNote(id) },
      { label: 'Renomear', icon: 'edit', onClick: () => App.renameEntity('note', id) },
      { label: 'Duplicar', onClick: () => App.duplicateNote(id) },
      { label: 'Mover para…', onClick: () => App.moveDialog('note', id) },
      { sep: true },
      { label: 'Excluir nota', icon: 'trash', danger: true, onClick: () => App.deleteEntity('note', id) },
    ] : [
      { label: 'Abrir', icon: 'image', onClick: () => App.openImage(id) },
      { label: 'Copiar código markdown', icon: 'link', onClick: async () => {
        const i = S.images.get(id);
        const from = S.open && S.open.type === 'note' && S.notes.get(S.open.id) ? S.notes.get(S.open.id).folderId : i.folderId;
        await root.UI.copyText(App.mdImage(i, from));
        root.UI.toast('Código copiado. Cole no texto da nota.');
      } },
      { label: 'Renomear', icon: 'edit', onClick: () => App.renameEntity('image', id) },
      { label: 'Mover para…', onClick: () => App.moveDialog('image', id) },
      { sep: true },
      { label: 'Excluir imagem', icon: 'trash', danger: true, onClick: () => App.deleteEntity('image', id) },
    ];
    menu(items, anchor);
  }

  function initSidebar() {
    const tree = $('#tree');
    tree.addEventListener('click', (e) => {
      const r = e.target.closest('.row');
      if (!r) { if (!hasFilter() && e.target === tree) { S.selFolder = null; renderSidebar(); } return; }
      const more = e.target.closest('[data-act=menu]');
      if (more) { e.stopPropagation(); openRowMenu(r.dataset.type, r.dataset.id, more); return; }
      activate(r.dataset.type, r.dataset.id);
    });
    tree.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.row');
      if (!r) return;
      e.preventDefault();
      openRowMenu(r.dataset.type, r.dataset.id, { x: e.clientX, y: e.clientY });
    });
    tree.addEventListener('keydown', (e) => {
      const r = e.target.closest('.row');
      if (!r || e.target !== r) return;
      const { type, id } = r.dataset;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(type, id); }
      else if (e.key === 'F2') { e.preventDefault(); App.renameEntity(type, id); }
      else if (e.key === 'Delete') { e.preventDefault(); App.deleteEntity(type, id); }
    });

    /* arrastar e soltar: mover itens ou soltar imagens do computador */
    tree.addEventListener('dragstart', (e) => {
      const r = e.target.closest('.row');
      if (!r) return;
      e.dataTransfer.setData('text/x-escrita', JSON.stringify({ type: r.dataset.type, id: r.dataset.id }));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    const targetOf = (e) => {
      const r = e.target.closest('.row');
      if (!r) return { id: null, el: tree };
      if (r.dataset.type === 'folder') return { id: r.dataset.id, el: r };
      const it = r.dataset.type === 'note' ? S.notes.get(r.dataset.id) : S.images.get(r.dataset.id);
      return { id: it ? it.folderId : null, el: tree };
    };
    const clearDrop = () => document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    tree.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (hasFilter() || !(t.includes('text/x-escrita') || t.includes('Files'))) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = t.includes('Files') ? 'copy' : 'move';
      clearDrop();
      targetOf(e).el.classList.add('drop-target');
    });
    tree.addEventListener('dragleave', (e) => { if (!tree.contains(e.relatedTarget)) clearDrop(); });
    tree.addEventListener('drop', async (e) => {
      e.preventDefault();
      clearDrop();
      const target = targetOf(e).id;
      if (e.dataTransfer.files && e.dataTransfer.files.length) { await App.addImages(e.dataTransfer.files, target); return; }
      const raw = e.dataTransfer.getData('text/x-escrita');
      if (!raw) return;
      try { const d = JSON.parse(raw); await App.moveEntity(d.type, d.id, target); } catch (err) { /* ignora */ }
    });
    tree.addEventListener('dragend', clearDrop);
  }

  Object.assign(App, { renderSidebar, renderSidebarSoon, initSidebar, hasFilter, renderTagsPanel });
})(typeof globalThis !== 'undefined' ? globalThis : this);
