/* io.js — exportar/importar (ZIP ou pasta do computador) e montar os arquivos para sincronizar. Global: IO */
(function (root) {
  'use strict';

  const enc = new TextEncoder();
  const shaCache = new Map();

  // Arquivos locais prontos para comparar/enviar: [{ path, sha, text?, getBytes() }]
  async function localFiles(data) {
    const snap = root.Fmt.buildSnapshot(data);
    const out = [];
    for (const e of snap.entries) {
      if (e.kind === 'image') {
        const getBytes = async () => new Uint8Array(await e.image.blob.arrayBuffer());
        const key = e.image.id + ':' + (e.image.size || 0) + ':' + (e.image.version || 0);
        let sha = shaCache.get(key);
        if (!sha) {
          sha = await root.Sync.gitBlobSha(await getBytes());
          if (sha) shaCache.set(key, sha);
        }
        out.push({ path: e.path, sha, getBytes });
      } else {
        const bytes = enc.encode(e.text);
        out.push({ path: e.path, sha: await root.Sync.gitBlobSha(bytes), text: e.text, getBytes: async () => bytes });
      }
    }
    return out;
  }

  async function exportZip(data) {
    const snap = root.Fmt.buildSnapshot(data);
    const zip = new root.JSZip();
    for (const e of snap.entries) zip.file(e.path, e.kind === 'image' ? e.image.blob : e.text);
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  async function readZip(file) {
    const zip = await root.JSZip.loadAsync(file);
    const items = [];
    const jobs = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      const kind = root.Fmt.classify(path);
      if (!kind) { items.push({ path }); return; }
      jobs.push((async () => {
        if (kind === 'image') items.push({ path, bytes: await entry.async('uint8array') });
        else items.push({ path, text: await entry.async('string') });
      })());
    });
    await Promise.all(jobs);
    return items;
  }

  // Arquivos vindos de <input webkitdirectory>: remove o nome da pasta escolhida do caminho.
  async function readFolder(files) {
    const items = [];
    for (const f of files) {
      const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
      const kind = root.Fmt.classify(rel);
      if (!kind) items.push({ path: rel });
      else if (kind === 'image') items.push({ path: rel, bytes: new Uint8Array(await f.arrayBuffer()) });
      else items.push({ path: rel, text: await f.text() });
    }
    return items;
  }

  root.IO = { localFiles, exportZip, readZip, readFolder };
})(typeof globalThis !== 'undefined' ? globalThis : this);
