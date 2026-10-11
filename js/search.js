/* search.js — busca por trechos de texto e por tags (sem DOM).
   Ignora maiúsculas e acentos. Sintaxe: palavras (todas devem aparecer),
   "frase exata" entre aspas e #tag (também aceita só o começo da tag). */
(function (root) {
  'use strict';

  // Minúsculas e sem acentos, mantendo o MESMO comprimento do texto original
  // (assim os índices achados no texto "dobrado" valem para o original).
  function fold(s) {
    return String(s == null ? '' : s)
      .replace(/[^\x00-\x7f]/g, (ch) => ch.normalize('NFD')[0])
      .toLowerCase();
  }

  function parseQuery(q) {
    const phrases = [];
    const words = [];
    const tags = [];
    const rest = String(q || '').replace(/"([^"]+)"/g, (_, p) => {
      const f = fold(p.trim());
      if (f) phrases.push(f);
      return ' ';
    });
    for (const tok of rest.split(/\s+/)) {
      if (!tok) continue;
      if (tok[0] === '#' && tok.length > 1) tags.push(fold(tok.slice(1)));
      else words.push(fold(tok));
    }
    return { phrases, words, tags };
  }

  function entryOf(cache, n) {
    const ann = (n.annotations || []).map((a) => (a.text || '') + '\n' + (a.quote || '')).join('\n');
    const tagsKey = (n.tags || []).join('\u0001');
    let e = cache.get(n.id);
    if (!e || e.srcC !== n.content || e.srcT !== n.title || e.srcA !== ann || e.srcG !== tagsKey) {
      e = {
        srcC: n.content, srcT: n.title, srcA: ann, srcG: tagsKey,
        title: fold(n.title), content: fold(n.content), ann: fold(ann),
        tags: (n.tags || []).map(fold), tagsText: fold((n.tags || []).join(' ')),
      };
      cache.set(n.id, e);
    }
    return e;
  }

  function snippetOf(text, start, len, radius) {
    radius = radius || 60;
    const a = Math.max(0, start - radius);
    const b = Math.min(text.length, start + len + radius);
    const flat = (s) => s.replace(/\s+/g, ' ');
    return {
      before: (a > 0 ? '…' : '') + flat(text.slice(a, start)),
      match: flat(text.slice(start, start + len)),
      after: flat(text.slice(start + len, b)) + (b < text.length ? '…' : ''),
    };
  }

  function excerpt(text, max) {
    max = max || 140;
    const flat = String(text || '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max).trim() + '…' : flat;
  }

  function count(hay, needle, cap) {
    let n = 0;
    let i = -1;
    while (n < cap && (i = hay.indexOf(needle, i + 1)) !== -1) n++;
    return n;
  }

  /* opts: { tags: Iterable<string> (tags exatas dos "chips"), cache: Map } */
  function search(notes, query, opts) {
    opts = opts || {};
    const q = parseQuery(query);
    const chips = Array.from(opts.tags || [], fold);
    const needles = q.phrases.concat(q.words);
    const hasText = needles.length > 0;
    if (!hasText && !q.tags.length && !chips.length) return [];
    const cache = opts.cache || new Map();
    const joined = q.words.join(' ');
    const out = [];

    for (const n of notes) {
      const e = entryOf(cache, n);
      if (chips.some((t) => !e.tags.includes(t))) continue;
      if (q.tags.some((t) => !e.tags.some((x) => x === t || x.startsWith(t)))) continue;

      const res = { note: n, score: 0, field: '', start: -1, len: 0, snippet: null, excerpt: '' };
      if (hasText) {
        const all = needles.every((nd) => e.title.includes(nd) || e.content.includes(nd) || e.ann.includes(nd) || e.tagsText.includes(nd));
        if (!all) continue;
        for (const nd of needles) {
          if (e.title.includes(nd)) res.score += 10;
          if (e.tagsText.includes(nd)) res.score += 3;
        }
        if (q.phrases.length) res.score += 4;
        if (q.words.length > 1 && (e.content.includes(joined) || e.title.includes(joined))) res.score += 6;
        // onde mostrar o trecho: conteúdo > anotações > título
        const probe = [q.phrases[0], q.words.length > 1 ? joined : null].concat(needles)
          .filter(Boolean)
          .find((p) => e.content.includes(p));
        if (probe) {
          res.field = 'content';
          res.start = e.content.indexOf(probe);
          res.len = probe.length;
          res.snippet = snippetOf(n.content, res.start, res.len);
          res.score += Math.min(count(e.content, probe, 20), 20) * 0.1;
        } else {
          const aprobe = needles.find((p) => e.ann.includes(p));
          if (aprobe) {
            const src = (n.annotations || []).map((a) => (a.text || '') + '\n' + (a.quote || '')).join('\n');
            res.field = 'annotations';
            res.start = e.ann.indexOf(aprobe);
            res.len = aprobe.length;
            res.snippet = snippetOf(src, res.start, res.len);
          } else if (needles.some((p) => e.title.includes(p))) {
            res.field = 'title';
          } else {
            res.field = 'tags';
          }
        }
      }
      if (!res.snippet) res.excerpt = excerpt(n.content);
      out.push(res);
    }
    out.sort((a, b) => b.score - a.score || (b.note.updatedAt || 0) - (a.note.updatedAt || 0));
    return out;
  }

  const api = { fold, parseQuery, search, snippetOf, excerpt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Busca = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
