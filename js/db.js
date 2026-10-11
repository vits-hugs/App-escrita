/* db.js — armazenamento local no navegador (IndexedDB). Global: Banco */
(function (root) {
  'use strict';

  const NAME = 'escrita';
  const VERSION = 1;
  const STORES = ['folders', 'notes', 'images'];
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const rq = root.indexedDB.open(NAME, VERSION);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
      rq.onblocked = () => reject(new Error('Feche as outras abas do app e tente de novo.'));
    });
    opening.catch(() => { opening = null; });
    return opening;
  }

  // Lê tudo de uma vez: { folders: [], notes: [], images: [] }
  async function load() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORES, 'readonly');
      const reqs = STORES.map((s) => t.objectStore(s).getAll());
      t.oncomplete = () => resolve(Object.fromEntries(STORES.map((s, i) => [s, reqs[i].result])));
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  // ops: [['put'|'del'|'clear', store, objeto|id]]  — tudo numa única transação.
  async function batch(ops) {
    if (!ops.length) return;
    const db = await open();
    return new Promise((resolve, reject) => {
      const stores = Array.from(new Set(ops.map((o) => o[1])));
      const t = db.transaction(stores, 'readwrite');
      for (const [op, store, arg] of ops) {
        const os = t.objectStore(store);
        if (op === 'put') os.put(arg);
        else if (op === 'del') os.delete(arg);
        else if (op === 'clear') os.clear();
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  root.Banco = { open, load, batch };
})(typeof globalThis !== 'undefined' ? globalThis : this);
