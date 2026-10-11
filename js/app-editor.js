/* app-editor.js — painéis do editor: escrever, ler (markdown) e anotações. */
(function (root) {
  'use strict';
  const App = root.App;
  const { S, store } = App;
  const { h, icon, toast } = root.UI;
  App.ui = {};

  /* ---------- destacar termos da busca no texto exibido ---------- */
  function highlightTerms(rootEl, query) {
    const q = root.Busca.parseQuery(query);
    const terms = q.phrases.concat(q.words).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!terms.length) return null;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let first = null;
    for (const node of nodes) {
      if (node.parentElement && node.parentElement.closest('mark')) continue;
      const text = node.nodeValue;
      const f = root.Busca.fold(text);
      const ranges = [];
      for (const t of terms) {
        let i = f.indexOf(t);
        while (i !== -1) { ranges.push([i, i + t.length]); i = f.indexOf(t, i + t.length); }
      }
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
      }
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const [a, b] of merged) {
        if (a > pos) frag.append(text.slice(pos, a));
        const m = document.createElement('mark');
        m.textContent = text.slice(a, b);
        frag.append(m);
        if (!first) first = m;
        pos = b;
      }
      if (pos < text.length) frag.append(text.slice(pos));
      node.replaceWith(frag);
    }
    return first;
  }
  App.highlightTerms = highlightTerms;

  /* ---------- edição no textarea ---------- */
  function replaceRange(ta, start, end, text, selStart, selEnd) {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { /* usa o plano B */ }
    if (!ok) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    const a = selStart == null ? start + text.length : selStart;
    ta.setSelectionRange(a, selEnd == null ? a : selEnd);
  }

  function wrapSel(ta, before, after, placeholder) {
    const s = ta.selectionStart; const e = ta.selectionEnd; const v = ta.value;
    const sel = v.slice(s, e) || placeholder;
    if (s !== e && v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replaceRange(ta, s - before.length, e + after.length, sel, s - before.length, s - before.length + sel.length);
      return;
    }
    replaceRange(ta, s, e, before + sel + after, s + before.length, s + before.length + sel.length);
  }

  function linePrefix(ta, prefix) {
    const s = ta.selectionStart; const e = ta.selectionEnd; const v = ta.value;
    const a = v.lastIndexOf('\n', s - 1) + 1;
    let b = v.indexOf('\n', e);
    if (b < 0) b = v.length;
    const lines = v.slice(a, b).split('\n');
    const all = lines.every((l) => l.startsWith(prefix));
    const out = lines.map((l) => (all ? l.slice(prefix.length) : prefix + (prefix === '## ' ? l.replace(/^#{1,6}\s+/, '') : l))).join('\n');
    replaceRange(ta, a, b, out, a, a + out.length);
  }

  function insertLink(ta) {
    const s = ta.selectionStart; const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || 'texto';
    replaceRange(ta, s, e, '[' + sel + '](https://)', s + sel.length + 3, s + sel.length + 11);
  }

  function insertAtCaret(ta, text) {
    const s = ta.selectionStart; const e = ta.selectionEnd;
    const before = ta.value.slice(0, s);
    const lead = before && !before.endsWith('\n') ? '\n' : '';
    replaceRange(ta, s, e, lead + text + '\n');
  }

  async function insertImages(ta, note, files) {
    const imgs = await App.addImages(files, note.folderId);
    if (imgs.length) insertAtCaret(ta, imgs.map((i) => App.mdImage(i, note.folderId)).join('\n'));
  }

  // Seleciona um trecho e o traz para a área visível.
  function selectInTextarea(ta, start, len) {
    const full = ta.value;
    ta.value = full.slice(0, start);
    ta.scrollTop = ta.scrollHeight;
    const top = ta.scrollTop;
    ta.value = full;
    ta.scrollTop = top > 0 ? top + ta.clientHeight * 0.65 : 0;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, start + len);
  }

  const wordCount = (t) => (t.match(/\S+/g) || []).length;
  function updateCounts(n) {
    const w = document.getElementById('words');
    if (w) w.textContent = wordCount(n.content) + ' palavras';
  }

  /* ---------- painel: escrever ---------- */
  function buildWritePane(n, opts, post) {
    const ta = h('textarea', { class: 'editor-ta', spellcheck: 'true', lang: 'pt-BR', placeholder: 'Escreva aqui… (aceita markdown)', 'aria-label': 'Texto da nota' });
    ta.value = n.content;
    App.ui.ta = ta;
    ta.addEventListener('input', () => { n.content = ta.value; App.touch(n); updateCounts(n); });
    ta.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrapSel(ta, '**', '**', 'texto'); }
      else if (k === 'i') { e.preventDefault(); wrapSel(ta, '*', '*', 'texto'); }
    });
    const imageFiles = (dt) => Array.from(dt.files || []).filter((f) => (f.type || '').startsWith('image/'));
    ta.addEventListener('paste', (e) => {
      const files = imageFiles(e.clipboardData || {});
      if (files.length) { e.preventDefault(); insertImages(ta, n, files); }
    });
    ta.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('Files') || t.includes('text/x-escrita')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    ta.addEventListener('drop', async (e) => {
      const files = imageFiles(e.dataTransfer);
      if (files.length) { e.preventDefault(); await insertImages(ta, n, files); return; }
      const raw = e.dataTransfer.getData('text/x-escrita');
      if (!raw) return;
      e.preventDefault();
      try {
        const d = JSON.parse(raw);
        if (d.type === 'image' && S.images.get(d.id)) insertAtCaret(ta, App.mdImage(S.images.get(d.id), n.folderId));
        else if (d.type === 'note' && S.notes.get(d.id)) replaceRange(ta, ta.selectionStart, ta.selectionEnd, '[[' + (S.notes.get(d.id).title || 'Sem título') + ']]');
      } catch (err) { /* ignora */ }
    });

    const tb = (content, label, fn, cls) => h('button', { type: 'button', class: 'tool ' + (cls || ''), title: label, 'aria-label': label, onclick: fn }, content);
    const tools = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatação' },
      tb(h('b', null, 'N'), 'Negrito (Ctrl+B)', () => wrapSel(ta, '**', '**', 'texto')),
      tb(h('i', null, 'I'), 'Itálico (Ctrl+I)', () => wrapSel(ta, '*', '*', 'texto')),
      tb('Título', 'Título', () => linePrefix(ta, '## ')),
      tb(icon('list', 16), 'Lista', () => linePrefix(ta, '- ')),
      tb(icon('quote', 16), 'Citação', () => linePrefix(ta, '> ')),
      tb(icon('link', 16), 'Link', () => insertLink(ta)),
      tb(icon('image', 16), 'Inserir imagem (ou cole/arraste no texto)', async () => {
        const files = await root.UI.pickFiles({ accept: 'image/*', multiple: true });
        if (files.length) insertImages(ta, n, files);
      }),
      h('span', { class: 'spacer' }),
      tb([icon('pin', 16), h('span', null, 'Anotar seleção')], 'Cria uma anotação com o trecho selecionado', annotateSelection, 'accent'));

    post.push(() => {
      const c = opts.caret;
      if (c) {
        ta.scrollTop = c.scroll;
        ta.setSelectionRange(c.s, c.e);
        if (c.focus) ta.focus({ preventScroll: true });
      }
      if (opts.jump && opts.jump.field === 'content') selectInTextarea(ta, opts.jump.start, opts.jump.len);
    });
    return h('section', { class: 'pane write-pane' }, tools, ta);
  }

  /* ---------- painel: ler ---------- */
  function mdCtx(n) {
    return {
      resolveImage: (src) => { const r = App.resolvePath(n.folderId, src); return r ? App.findImage(r.folderId, r.name) : null; },
      imageUrl: App.imageUrl,
      resolveNote: (href) => { const r = App.resolvePath(n.folderId, href); return r ? App.findNoteByFile(r.folderId, r.name) : null; },
      noteByTitle: (t) => App.findNoteByTitle(t, n.folderId),
    };
  }

  function buildReadPane(n, opts, post) {
    const page = h('article', { class: 'page md' });
    if (n.content.trim()) page.append(root.Md.render(n.content, mdCtx(n)));
    else page.append(h('p', { class: 'hint' }, 'Esta nota está vazia. Mude para “Escrever” para começar.'));
    page.addEventListener('click', async (e) => {
      const a = e.target.closest('a.wikilink');
      if (a) {
        e.preventDefault();
        if (a.dataset.noteId) App.openNote(a.dataset.noteId);
        else if (a.dataset.title && await root.UI.confirmBox('A nota “' + a.dataset.title + '” ainda não existe. Criar agora na mesma pasta?', { okLabel: 'Criar nota' })) {
          App.createNote(n.folderId, { title: a.dataset.title });
        }
        return;
      }
      const img = e.target.closest('img.md-img');
      if (img) App.showImage(img.dataset.imageId);
    });
    post.push(() => {
      if (!App.hasFilter()) return;
      const first = highlightTerms(page, S.query);
      if (first && opts.jump) first.scrollIntoView({ block: 'center' });
    });
    return h('section', { class: 'pane read-pane' }, page);
  }

  /* ---------- painel: anotações ---------- */
  const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

  function updateBadge(n) {
    const b = document.getElementById('ann-badge');
    if (!b) return;
    const open = n.annotations.filter((a) => !a.done).length;
    b.textContent = open || '';
    b.hidden = !open;
  }

  function buildNotesPane(n, opts, post) {
    const list = h('div', { class: 'ann-list' });
    const summary = h('span', { class: 'ann-summary' });
    const newInput = h('textarea', { class: 'ann-new', rows: '2', placeholder: 'O que você quer mudar neste texto? (Ctrl+Enter adiciona)', 'aria-label': 'Nova anotação' });

    function updateSummary() {
      const done = n.annotations.filter((a) => a.done).length;
      summary.textContent = n.annotations.length ? done + ' de ' + n.annotations.length + ' resolvidas' : '';
    }

    function jump(a) {
      const v = n.content;
      let i = v.indexOf(a.quote);
      let len = a.quote.length;
      if (i < 0) { i = root.Busca.fold(v).indexOf(root.Busca.fold(a.quote)); }
      if (i < 0) { toast('Não achei esse trecho: o texto foi alterado desde a anotação.', 'error'); return; }
      if (App.ui.ta) selectInTextarea(App.ui.ta, i, len);
      else App.setMode('split', { jump: { field: 'content', start: i, len } });
    }

    function item(a) {
      const ta = h('textarea', { class: 'ann-text', rows: '1', 'aria-label': 'Anotação', placeholder: 'Escreva o que mudar…' });
      ta.value = a.text;
      ta.addEventListener('input', () => { a.text = ta.value; App.touch(n); autosize(ta); });
      const cb = h('input', { type: 'checkbox', checked: a.done, 'aria-label': 'Marcar como resolvida' });
      const el = h('div', { class: 'ann' + (a.done ? ' done' : ''), dataset: { id: a.id } },
        cb,
        h('div', { class: 'ann-main' },
          a.quote ? h('blockquote', { class: 'ann-quote' }, h('span', null, a.quote),
            h('button', { type: 'button', class: 'link-btn', onclick: () => jump(a) }, 'ver no texto')) : null,
          ta),
        h('button', { type: 'button', class: 'row-more show', title: 'Excluir anotação', 'aria-label': 'Excluir anotação', onclick: () => {
          n.annotations = n.annotations.filter((x) => x !== a);
          App.touch(n); render(); updateBadge(n);
        } }, icon('close', 16)));
      cb.addEventListener('change', () => {
        a.done = cb.checked;
        el.classList.toggle('done', a.done);
        App.touch(n); updateSummary(); updateBadge(n);
        if (S.hideDone) render();
      });
      return el;
    }

    function render(focusId) {
      list.replaceChildren();
      if (!n.annotations.length) {
        list.append(h('p', { class: 'hint' }, 'Nenhuma anotação ainda. Selecione um trecho no texto e clique em “Anotar seleção”, ou escreva abaixo o que quer mudar.'));
      }
      for (const a of n.annotations) if (!S.hideDone || !a.done) list.append(item(a));
      updateSummary();
      requestAnimationFrame(() => {
        list.querySelectorAll('.ann-text').forEach(autosize);
        if (focusId) {
          const el = list.querySelector('.ann[data-id="' + focusId + '"]');
          if (el) { el.scrollIntoView({ block: 'nearest' }); el.querySelector('textarea').focus(); }
        }
      });
    }

    function add() {
      const t = newInput.value.trim();
      if (!t) return;
      n.annotations.push({ id: root.Fmt.makeId(), text: t, quote: '', done: false });
      newInput.value = '';
      App.touch(n); render(); updateBadge(n);
    }
    newInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } });

    App.ui.notes = { refresh: (focusId) => { render(focusId); updateBadge(n); } };
    const hide = h('input', { type: 'checkbox', checked: S.hideDone, onchange: (e) => { S.hideDone = e.target.checked; render(); } });
    render(opts.focusAnnotation);
    post.push(() => {
      if (opts.focusAnnotation) return;
      if (opts.focusNew) newInput.focus();
    });
    return h('section', { class: 'pane notes-pane' },
      h('div', { class: 'pane-head' }, h('h3', null, 'Anotações'), summary,
        h('label', { class: 'check small' }, hide, h('span', null, 'ocultar resolvidas'))),
      h('p', { class: 'hint tight' }, 'Anote o que quer mudar sem mexer no texto agora.'),
      list,
      h('div', { class: 'ann-add' }, newInput, h('button', { type: 'button', class: 'btn small primary', onclick: add }, 'Adicionar')));
  }

  /* ---------- ações de modo ---------- */
  function captureCaret() {
    const ta = App.ui.ta;
    return ta && document.body.contains(ta)
      ? { s: ta.selectionStart, e: ta.selectionEnd, scroll: ta.scrollTop, focus: document.activeElement === ta } : null;
  }

  function setMode(m, extra) {
    const caret = captureCaret();
    S.mode = m;
    store.set('ea.mode', m);
    App.renderMain(Object.assign({ caret }, extra || {}));
  }

  function annotateSelection() {
    const n = S.open && S.notes.get(S.open.id);
    if (!n) return;
    const ta = App.ui.ta;
    let quote = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd).trim() : '';
    if (quote.length > 400) quote = quote.slice(0, 400);
    const a = { id: root.Fmt.makeId(), text: '', quote, done: false };
    n.annotations.push(a);
    App.touch(n);
    if (S.mode === 'split' && App.ui.notes) App.ui.notes.refresh(a.id);
    else setMode('split', { focusAnnotation: a.id });
  }

  Object.assign(App, { buildWritePane, buildReadPane, buildNotesPane, setMode, updateBadge, updateCounts, wordCount, captureCaret });
})(typeof globalThis !== 'undefined' ? globalThis : this);
