/* markdown.js — renderização segura de markdown. Global: Md
   Usa marked + DOMPurify (em vendor/). Resolve imagens e links relativos às pastas do app. */
(function (root) {
  'use strict';

  // [[Título]] e [[Título|texto]] viram links internos (fora de blocos de código).
  function wikilinks(src) {
    return src
      .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g)
      .map((part, i) => (i % 2 ? part : part.replace(
        /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g,
        (m, title, label) => '[' + (label || title).trim() + '](#nota:' + encodeURIComponent(title.trim()) + ')'
      )))
      .join('');
  }

  const EXTERNAL = /^(https?:|data:|blob:|mailto:|tel:)/i;

  /* ctx = {
       resolveImage(src) -> imagem | null,
       imageUrl(imagem)  -> URL (blob:),
       resolveNote(href) -> nota | null,
       noteByTitle(title) -> nota | null,
     }
     Devolve um DocumentFragment pronto para inserir na página. */
  function render(src, ctx) {
    const raw = root.marked.parse(wikilinks(String(src || '')), { gfm: true, breaks: true });
    const clean = root.DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    const doc = tpl.content;

    doc.querySelectorAll('img').forEach((img) => {
      const src0 = img.getAttribute('src') || '';
      if (EXTERNAL.test(src0)) { img.loading = 'lazy'; return; }
      const found = ctx.resolveImage(src0);
      if (found) {
        img.src = ctx.imageUrl(found);
        img.dataset.imageId = found.id;
        img.classList.add('md-img');
      } else {
        const miss = document.createElement('span');
        miss.className = 'img-missing';
        miss.textContent = '[imagem não encontrada: ' + src0 + ']';
        img.replaceWith(miss);
      }
    });

    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#nota:')) {
        let title = href.slice(6);
        try { title = decodeURIComponent(title); } catch (e) { /* mantém */ }
        const n = ctx.noteByTitle(title);
        a.setAttribute('href', '#');
        a.classList.add('wikilink');
        a.dataset.title = title;
        if (n) a.dataset.noteId = n.id; else a.classList.add('broken');
        a.title = n ? 'Abrir nota' : 'Nota não encontrada: ' + title;
      } else if (EXTERNAL.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else if (!href.startsWith('#') && /\.(md|markdown)(#.*)?$/i.test(href)) {
        const n = ctx.resolveNote(href);
        a.setAttribute('href', '#');
        a.classList.add('wikilink');
        if (n) a.dataset.noteId = n.id; else a.classList.add('broken');
      }
    });

    doc.querySelectorAll('input[type=checkbox]').forEach((c) => { c.disabled = true; });
    return doc;
  }

  root.Md = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
