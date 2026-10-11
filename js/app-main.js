/* app-main.js — área principal (editor/imagem/boas-vindas), busca e inicialização. */
(function (root) {
  'use strict';
  const App = root.App;
  const { S, store } = App;
  const { h, icon, toast, modal } = root.UI;
  const $ = (s) => document.querySelector(s);
  let post = [];

  /* ---------- abrir ---------- */
  function expandTo(folderId) {
    App.folderChain(folderId).forEach((f) => S.expanded.add(f.id));
    App.persistExpanded();
  }

  function openNote(id, opts) {
    opts = opts || {};
    const n = S.notes.get(id);
    if (!n) return;
    App.flush();
    S.open = { type: 'note', id };
    S.selFolder = n.folderId;
    expandTo(n.folderId);
    store.set('ea.last', { type: 'note', id });
    const j = opts.field ? { field: opts.field, start: opts.start, len: opts.len } : null;
    if (j && j.field === 'content' && S.mode === 'notes') { S.mode = 'split'; store.set('ea.mode', S.mode); }
    if (j && j.field === 'annotations' && (S.mode === 'write' || S.mode === 'read')) { S.mode = 'split'; store.set('ea.mode', S.mode); }
    renderMain({ jump: j, focusTitle: opts.focusTitle });
    App.renderSidebar();
    document.body.classList.remove('sidebar-open');
  }

  function openImage(id) {
    if (!S.images.get(id)) return;
    App.flush();
    S.open = { type: 'image', id };
    S.selFolder = S.images.get(id).folderId;
    expandTo(S.selFolder);
    store.set('ea.last', { type: 'image', id });
    renderMain();
    App.renderSidebar();
    document.body.classList.remove('sidebar-open');
  }

  function showImage(id) {
    const img = S.images.get(id);
    if (!img) return;
    modal({ title: img.name, wide: true, body: h('img', { class: 'lightbox', src: App.imageUrl(img), alt: img.name }), buttons: [{ label: 'Fechar', value: true, kind: 'primary' }] });
  }

  function refreshOpen() {
    if (S.open) renderMain({ caret: App.captureCaret() });
  }

  /* ---------- telas ---------- */
  function buildEmpty() {
    return h('div', { class: 'empty' }, h('div', { class: 'empty-card' },
      h('h1', null, 'Escrita'),
      h('p', { class: 'lead' }, 'Seu caderno de textos e ideias.'),
      h('p', null, 'Escolha uma nota na lista ao lado ou comece algo novo.'),
      h('div', { class: 'empty-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => App.createNote(S.selFolder) }, 'Nova nota'),
        h('button', { type: 'button', class: 'btn', onclick: () => App.createFolder(S.selFolder) }, 'Nova pasta')),
      h('p', { class: 'hint' }, 'Dica: Ctrl+K busca qualquer trecho de texto, em todas as notas.')));
  }

  function buildImageView(img) {
    const code = App.mdImage(img, S.selFolder);
    return h('div', { class: 'editor image-view' },
      h('div', { class: 'doc-head' },
        h('h1', { class: 'title-static' }, img.name),
        h('div', { class: 'crumbs' }, App.pathLabel(img.folderId) + ' · ' + root.UI.fmtBytes(img.size || 0))),
      h('div', { class: 'image-stage' }, h('img', { src: App.imageUrl(img), alt: img.name })),
      h('div', { class: 'image-actions' },
        h('code', { class: 'snippet-code' }, code),
        h('button', { type: 'button', class: 'btn small', onclick: async () => { await root.UI.copyText(code); toast('Código copiado.'); } }, 'Copiar código'),
        h('button', { type: 'button', class: 'btn small', onclick: () => App.renameEntity('image', img.id) }, 'Renomear'),
        h('button', { type: 'button', class: 'btn small', onclick: () => App.moveDialog('image', img.id) }, 'Mover'),
        h('button', { type: 'button', class: 'btn small danger', onclick: () => App.deleteEntity('image', img.id) }, 'Excluir')));
  }

  function buildEditor(n, opts) {
    const MODES = [['write', 'Escrever'], ['read', 'Ler'], ['notes', 'Anotações'], ['split', 'Escrever + Anotações']];

    const titleInput = h('input', { class: 'title-input', value: n.title, placeholder: 'Sem título', 'aria-label': 'Título da nota' });
    let titleAtFocus = n.title;
    titleInput.addEventListener('focus', () => { titleAtFocus = n.title; });
    titleInput.addEventListener('input', () => { n.title = titleInput.value; App.touch(n); App.invalidate(); App.renderSidebarSoon(); document.title = (n.title || 'Sem título') + ' — Escrita'; });
    titleInput.addEventListener('change', async () => {
      const ops = App.renameLinks(titleAtFocus, n.title, n.id);
      if (ops.length) { await root.Banco.batch(ops); toast('Links [[…]] atualizados em ' + ops.length + ' nota(s).'); }
      titleAtFocus = n.title;
    });
    titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (App.ui.ta || titleInput).focus(); } });

    const chips = h('span', { class: 'chips' });
    const tagInput = h('input', { class: 'tag-input', list: 'taglist', placeholder: '+ tag', 'aria-label': 'Adicionar tag', autocomplete: 'off' });
    function renderChips() {
      chips.replaceChildren(...n.tags.map((t) => h('span', { class: 'chip' }, '#' + t,
        h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remover tag ' + t, onclick: () => {
          n.tags = n.tags.filter((x) => x !== t);
          App.touch(n); renderChips(); App.renderSidebar();
        } }, '×'))));
    }
    function addTags() {
      let changed = false;
      for (const p of tagInput.value.split(/[,;]+/)) {
        const t = root.Fmt.normalizeTag(p);
        if (t && !n.tags.includes(t)) { n.tags.push(t); changed = true; }
      }
      tagInput.value = '';
      if (changed) { App.touch(n); renderChips(); App.renderSidebar(); }
    }
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTags(); }
      else if (e.key === 'Backspace' && !tagInput.value && n.tags.length) { n.tags.pop(); App.touch(n); renderChips(); App.renderSidebar(); }
    });
    tagInput.addEventListener('change', addTags);
    tagInput.addEventListener('blur', addTags);
    renderChips();

    const modeBar = h('div', { class: 'modes', role: 'tablist', 'aria-label': 'Modo' }, MODES.map(([m, label]) => h('button', {
      type: 'button', role: 'tab', class: 'mode' + (S.mode === m ? ' active' : ''), 'aria-selected': S.mode === m,
      onclick: () => App.setMode(m),
    }, label, m === 'notes' || m === 'split' ? h('span', { id: m === 'notes' ? 'ann-badge' : null, class: 'badge', hidden: true }) : null)));

    const body = h('div', { class: 'doc-body mode-' + S.mode });
    if (S.mode === 'write' || S.mode === 'split') body.append(App.buildWritePane(n, opts, post));
    if (S.mode === 'read') body.append(App.buildReadPane(n, opts, post));
    if (S.mode === 'notes' || S.mode === 'split') body.append(App.buildNotesPane(n, opts, post));

    post.push(() => {
      App.updateBadge(n);
      if (opts.focusTitle) titleInput.focus();
    });

    return h('div', { class: 'editor' },
      h('div', { class: 'doc-head' },
        titleInput,
        h('div', { class: 'crumbs' }, App.pathLabel(n.folderId)),
        h('div', { class: 'tagbar' }, chips, tagInput),
        modeBar),
      body,
      h('div', { class: 'doc-foot' },
        h('span', { id: 'status' }, 'Salvo'),
        h('span', { id: 'words' }, App.wordCount(n.content) + ' palavras'),
        h('span', { id: 'updated' }, 'Atualizada em ' + root.UI.fmtDate(n.updatedAt))));
  }

  function renderMain(opts) {
    opts = opts || {};
    const main = $('#main');
    App.ui = {};
    post = [];
    main.replaceChildren();
    document.title = 'Escrita';
    if (!S.open) { main.append(buildEmpty()); return; }
    if (S.open.type === 'image') {
      const img = S.images.get(S.open.id);
      if (!img) { S.open = null; renderMain(); return; }
      main.append(buildImageView(img));
      return;
    }
    const n = S.notes.get(S.open.id);
    if (!n) { S.open = null; renderMain(); return; }
    document.title = (n.title || 'Sem título') + ' — Escrita';
    main.append(buildEditor(n, opts));
    const run = post;
    post = [];
    run.forEach((fn) => fn());
  }

  /* ---------- busca ---------- */
  function clearSearch() {
    S.query = '';
    S.tags.clear();
    $('#search').value = '';
    App.renderSidebar();
  }

  function initSearch() {
    const input = $('#search');
    input.addEventListener('input', root.UI.debounce(() => { S.query = input.value; App.renderSidebar(); }, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { clearSearch(); input.blur(); }
      else if (e.key === 'Enter') {
        const first = document.querySelector('#tree .result');
        if (first) first.click();
      }
    });
    $('#search-clear').addEventListener('click', () => { clearSearch(); input.focus(); });
  }

  /* ---------- boas-vindas ---------- */
  const WELCOME = [
    '# Bem-vindo à Escrita', '',
    'Este é o seu caderno de textos e ideias. Tudo fica salvo **neste navegador**; para guardar com segurança use o menu **Arquivo** (exportar ZIP) ou **GitHub** (seu repositório privado).', '',
    '## O básico', '',
    '- **Pastas e subpastas**: botão “+ Pasta” ou o menu ⋯ de cada pasta. Arraste itens para mover.',
    '- **Notas**: escreva em *markdown* (modo **Escrever**) e veja o resultado em **Ler**.',
    '- **Anotações**: no modo **Anotações** você registra o que quer mudar sem mexer no texto. Selecione um trecho e use **Anotar seleção** para guardar a citação junto.',
    '- **Tags**: digite no campo “+ tag” da nota; clique numa tag na lateral para filtrar.',
    '- **Busca**: `Ctrl+K`. Aceita palavras, "frase exata" e `#tag`. Ignora acentos e maiúsculas.',
    '- **Imagens**: cole (`Ctrl+V`), arraste para o texto ou use o botão. Elas ficam na pasta da nota e são referenciadas assim: `![legenda](foto.png)`.',
    '- **Links entre notas**: escreva `[[Título de outra nota]]`.', '',
    '> Dica: apague esta nota quando quiser — ela é só um ponto de partida.', '',
  ].join('\n');

  async function boot() {
    const I = root.UI.icon;
    $('#btn-sidebar').append(I('menu'));
    $('#btn-help').append(I('help'));
    $('.search-ico').append(I('search', 17));
    $('#search-clear').append(I('close', 16));
    $('#new-folder').prepend(I('folder', 16));
    $('#new-note').prepend(I('note', 16));
    $('#new-image').prepend(I('image', 16));
    $('#btn-file').prepend(I('file', 17));
    $('#btn-github').prepend(I('cloud', 17));
    $('.brand-ico').append(I('book', 26));

    try {
      const data = await root.Banco.load();
      data.folders.forEach((f) => S.folders.set(f.id, f));
      data.notes.forEach((n) => { n.tags = n.tags || []; n.annotations = n.annotations || []; S.notes.set(n.id, n); });
      data.images.forEach((i) => S.images.set(i.id, i));
    } catch (e) {
      $('#main').append(h('div', { class: 'empty' }, h('div', { class: 'empty-card' }, h('h1', null, 'Armazenamento indisponível'),
        h('p', null, 'Não consegui abrir o armazenamento local do navegador (janela anônima ou bloqueio de dados do site?). ' + e.message))));
      return;
    }

    if (!S.notes.size && !S.folders.size && !store.get('ea.welcomed', false)) {
      store.set('ea.welcomed', true);
      const n = { id: root.Fmt.makeId(), folderId: null, title: 'Bem-vindo', content: WELCOME, annotations: [], tags: ['ajuda'], createdAt: App.now(), updatedAt: App.now() };
      S.notes.set(n.id, n);
      await root.Banco.batch([['put', 'notes', n]]);
      store.set('ea.last', { type: 'note', id: n.id });
      S.mode = 'read';
    }

    App.initSidebar();
    initSearch();
    App.initTopbar();

    $('#new-folder').addEventListener('click', () => App.createFolder(S.selFolder));
    $('#new-note').addEventListener('click', () => App.createNote(S.selFolder));
    $('#new-image').addEventListener('click', () => App.pickAndAddImages(S.selFolder));
    $('#sort').value = S.sort;
    $('#sort').addEventListener('change', (e) => { S.sort = e.target.value; store.set('ea.sort', S.sort); App.renderSidebar(); });
    const det = $('#tags-panel');
    det.open = store.get('ea.tagsOpen', true);
    det.addEventListener('toggle', () => store.set('ea.tagsOpen', det.open));
    $('#btn-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
    $('#sidebar-backdrop').addEventListener('click', () => document.body.classList.remove('sidebar-open'));

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key || '').toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
      else if (mod && k === 's') { e.preventDefault(); App.flush().then(() => toast('Salvo.')); }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') App.flush(); });
    root.addEventListener('pagehide', () => App.flush());

    const last = store.get('ea.last', null);
    if (last && last.type === 'note' && S.notes.has(last.id)) { S.open = last; S.selFolder = S.notes.get(last.id).folderId; expandTo(S.selFolder); }
    else if (last && last.type === 'image' && S.images.has(last.id)) { S.open = last; S.selFolder = S.images.get(last.id).folderId; }
    App.renderSidebar();
    renderMain();

    if (root.navigator.storage && root.navigator.storage.persist) root.navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in root.navigator && /^https?:$/.test(root.location.protocol)) root.navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  Object.assign(App, { openNote, openImage, showImage, refreshOpen, renderMain, clearSearch, boot });
  document.addEventListener('DOMContentLoaded', boot);
})(typeof globalThis !== 'undefined' ? globalThis : this);
