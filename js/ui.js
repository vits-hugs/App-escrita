/* ui.js — pequenos utilitários de interface (DOM, janelas, menus, avisos). Global: UI */
(function (root) {
  'use strict';

  /* ---------- criação de elementos ---------- */
  function appendKids(el, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) appendKids(el, k);
      else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    appendKids(el, kids);
    return el;
  }

  /* ---------- ícones ---------- */
  const ICONS = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    folderOpen: '<path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 19l2.5-8a2 2 0 0 1 1.9-1.4H21l-2.6 8.2a2 2 0 0 1-1.9 1.4H5a2 2 0 0 1-2-.2z"/>',
    note: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    book: '<path d="M4 5c3-1.4 6-1.4 8 .8 2-2.2 5-2.2 8-.8v14c-3-1.4-6-1.4-8 .8-2-2.2-5-2.2-8-.8z"/><path d="M12 5.8V20"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9z"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4M12 17v.1"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    quote: '<path d="M6 17c0-4 1-7 4-9M14 17c0-4 1-7 4-9"/><path d="M6 17h4v-4M14 17h4v-4"/>',
    list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="5" cy="7" r=".8"/><circle cx="5" cy="12" r=".8"/><circle cx="5" cy="17" r=".8"/>',
    pin: '<path d="M5 20l5-5M14 4l6 6-3 1-3 3 .5 3.5-2 .5-5-5 .5-2L10 11l1-3z"/>',
    jump: '<path d="M7 17L17 7M9 7h8v8"/>',
  };

  function icon(name, size) {
    const s = size || 18;
    const t = document.createElement('template');
    t.innerHTML = '<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') + '</svg>';
    return t.content.firstChild;
  }

  /* ---------- avisos ---------- */
  function toast(msg, kind) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
    const el = h('div', { class: 'toast ' + (kind || '') }, msg);
    box.append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 7000 : 3200);
  }

  /* ---------- janelas ---------- */
  let modalDepth = 0;

  function modal(opts) {
    return new Promise((resolve) => {
      const buttons = opts.buttons || [{ label: 'OK', value: true, kind: 'primary' }];
      const dialog = h('div', { class: 'dialog' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
      const overlay = h('div', { class: 'overlay' }, dialog);
      let closed = false;
      const close = (value) => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        modalDepth--;
        resolve(value === undefined ? null : value);
      };
      const run = async (b) => {
        if (b.onClick) {
          const r = await b.onClick(dialog, close);
          if (r === false) return;
        }
        close(b.value);
      };
      const primary = buttons.find((b) => b.kind === 'primary' || b.kind === 'danger');
      function onKey(e) {
        if (overlay !== topOverlay()) return;
        if (e.key === 'Escape' && !opts.persistent) { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (e.key === 'Enter' && primary && e.target instanceof HTMLElement && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') {
          e.preventDefault();
          run(primary);
        }
      }
      dialog.append(
        h('h2', null, opts.title || ''),
        h('div', { class: 'dialog-body' }, opts.body),
        h('div', { class: 'dialog-actions' }, buttons.map((b) => h('button', {
          type: 'button', class: 'btn ' + (b.kind || ''), onclick: () => run(b),
        }, b.label)))
      );
      if (!opts.persistent) overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
      document.addEventListener('keydown', onKey, true);
      document.body.append(overlay);
      modalDepth++;
      const first = dialog.querySelector('input:not([type=radio]):not([type=checkbox]), textarea, select') ||
        dialog.querySelector('input[type=radio]:checked') || dialog.querySelector('.btn.primary, .btn.danger, .btn');
      if (first) { first.focus(); if (first.select && first.tagName === 'INPUT') first.select(); }
      if (opts.onOpen) opts.onOpen(dialog, close);
    });
  }

  function topOverlay() {
    const all = document.querySelectorAll('.overlay');
    return all[all.length - 1];
  }

  async function confirmBox(message, o) {
    o = o || {};
    const r = await modal({
      title: o.title || 'Confirmar',
      body: h('p', { class: 'pre-line' }, message),
      buttons: [
        { label: o.cancelLabel || 'Cancelar', value: false },
        { label: o.okLabel || 'OK', value: true, kind: o.danger ? 'danger' : 'primary' },
      ],
    });
    return r === true;
  }

  async function promptBox(o) {
    const input = h('input', { type: 'text', value: o.value || '', placeholder: o.placeholder || '', 'aria-label': o.label || o.title });
    const r = await modal({
      title: o.title,
      body: [o.label ? h('label', { class: 'field' }, h('span', null, o.label), input) : input],
      buttons: [
        { label: 'Cancelar', value: null },
        { label: o.okLabel || 'OK', value: 'ok', kind: 'primary' },
      ],
    });
    return r === 'ok' ? input.value.trim() : null;
  }

  async function choiceBox(o) {
    const name = 'choice-' + Math.random().toString(36).slice(2);
    let chosen = o.choices[0].value;
    const list = h('div', { class: 'choices' }, o.choices.map((c, i) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name, checked: i === 0, onchange: () => { chosen = c.value; } }),
      h('span', null, h('strong', null, c.label), c.hint ? h('small', null, c.hint) : null)
    )));
    const r = await modal({
      title: o.title,
      body: [o.intro ? h('p', { class: 'pre-line' }, o.intro) : null, list],
      buttons: [
        { label: 'Cancelar', value: null },
        { label: o.okLabel || 'Continuar', value: 'ok', kind: o.danger ? 'danger' : 'primary' },
      ],
    });
    return r === 'ok' ? chosen : null;
  }

  function busy(text) {
    const label = h('p', null, text || 'Aguarde…');
    const overlay = h('div', { class: 'overlay busy' }, h('div', { class: 'dialog small' }, h('div', { class: 'spinner' }), label));
    document.body.append(overlay);
    return { set(t) { label.textContent = t; }, close() { overlay.remove(); } };
  }

  /* ---------- menu flutuante ---------- */
  let openMenu = null;
  function closeMenu() {
    if (openMenu) { openMenu.cleanup(); openMenu = null; }
  }

  function menu(items, anchor) {
    closeMenu();
    const el = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (it.sep) { el.append(h('div', { class: 'menu-sep' })); continue; }
      el.append(h('button', {
        type: 'button', role: 'menuitem', class: 'menu-item' + (it.danger ? ' danger' : ''), disabled: !!it.disabled,
        onclick: () => { closeMenu(); it.onClick && it.onClick(); },
      }, it.icon ? icon(it.icon, 16) : h('span', { class: 'ico-gap' }), h('span', { class: 'menu-label' }, it.label, it.hint ? h('small', null, it.hint) : null)));
    }
    document.body.append(el);
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let x; let y;
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      x = r.right - w;
      y = r.bottom + 4;
    } else {
      x = anchor.x; y = anchor.y;
    }
    x = Math.max(8, Math.min(x, root.innerWidth - w - 8));
    if (y + hgt > root.innerHeight - 8) y = Math.max(8, root.innerHeight - hgt - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    const onDown = (e) => { if (!el.contains(e.target)) closeMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('resize', closeMenu);
    openMenu = {
      cleanup() {
        el.remove();
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        root.removeEventListener('resize', closeMenu);
      },
    };
    const first = el.querySelector('.menu-item:not([disabled])');
    if (first) first.focus();
  }

  /* ---------- arquivos e utilidades ---------- */
  function pickFiles(o) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', style: { display: 'none' } });
      if (o && o.accept) input.accept = o.accept;
      if (o && o.multiple) input.multiple = true;
      if (o && o.directory) { input.setAttribute('webkitdirectory', ''); input.setAttribute('directory', ''); }
      const done = (files) => { input.remove(); resolve(files); };
      input.addEventListener('change', () => done(Array.from(input.files || [])));
      input.addEventListener('cancel', () => done([]));
      document.body.append(input);
      input.click();
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { /* ignora */ }
      ta.remove();
      return ok;
    }
  }

  function debounce(fn, ms) {
    let t;
    const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  function fmtDate(ms) {
    return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
    return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  }

  root.UI = {
    h, icon, toast, modal, confirmBox, promptBox, choiceBox, busy, menu, closeMenu,
    pickFiles, downloadBlob, copyText, debounce, fmtDate, fmtBytes,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
