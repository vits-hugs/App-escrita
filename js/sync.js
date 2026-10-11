/* sync.js — sincronização com um repositório (privado) do GitHub pela API REST. Global: Sync
   Envio incremental: só sobe o que mudou (compara o SHA git de cada arquivo) e cria um único commit. */
(function (root) {
  'use strict';

  const CFG_KEY = 'ea.github';
  const LAST_KEY = 'ea.github.last';
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  /* ---------- configuração (fica só neste navegador) ---------- */
  function getConfig() {
    try { return JSON.parse(root.localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveConfig(c) {
    root.localStorage.setItem(CFG_KEY, JSON.stringify(c));
  }
  function isConfigured(c) {
    c = c || getConfig();
    return !!(c.owner && c.repo && c.token);
  }
  function parseRepo(str) {
    const m = String(str || '').trim().replace(/\.git$/, '').match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)\/?$/i);
    return m ? { owner: m[1], repo: m[2] } : null;
  }
  function cleanDir(d) {
    return String(d || '').trim().replace(/^\/+|\/+$/g, '');
  }
  function prefixOf(cfg) {
    const d = cleanDir(cfg.dir);
    return d ? d + '/' : '';
  }
  function keyOf(cfg) {
    return [cfg.owner, cfg.repo, cfg.branch || '', cleanDir(cfg.dir)].join('|');
  }
  // Estado da última sincronização: commit e SHA de cada arquivo naquele momento.
  function getSynced(cfg) {
    try {
      const l = JSON.parse(root.localStorage.getItem(LAST_KEY));
      if (!l || l.key !== keyOf(cfg)) return null;
      return { head: l.head, time: l.time, shas: new Map(Object.entries(l.shas || {})) };
    } catch (e) { return null; }
  }
  function setSynced(cfg, head, shas) {
    const obj = {};
    shas.forEach((v, k) => { if (v) obj[k] = v; });
    try {
      root.localStorage.setItem(LAST_KEY, JSON.stringify({ key: keyOf(cfg), head, time: Date.now(), shas: obj }));
    } catch (e) { /* armazenamento cheio: segue sem histórico */ }
  }

  /* ---------- HTTP ---------- */
  class GHError extends Error {
    constructor(message, status) { super(message); this.name = 'GHError'; this.status = status; }
  }

  function explain(status, data) {
    const msg = data && data.message ? data.message : '';
    if (status === 401) return 'Token inválido ou expirado. Gere um novo e salve nas configurações.';
    if (status === 403) return 'Acesso negado pelo GitHub. O token precisa da permissão "Contents: Read and write" neste repositório. ' + (msg ? '(' + msg + ')' : '');
    if (status === 404) return 'Não encontrei o repositório (ou o token não tem acesso a ele). Confira o nome e as permissões do token.';
    if (status === 409) return msg || 'Conflito no repositório.';
    if (status === 422) return 'O GitHub recusou a operação: ' + (msg || 'dados inválidos') + '. Se alguém enviou alterações agora, baixe e tente de novo.';
    return 'Erro do GitHub (' + status + ')' + (msg ? ': ' + msg : '');
  }

  async function api(cfg, method, path, body) {
    let res;
    try {
      res = await root.fetch('https://api.github.com' + path, {
        method,
        cache: 'no-store',
        headers: Object.assign({
          Authorization: 'Bearer ' + cfg.token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GHError('Sem conexão com o GitHub. Verifique a internet e tente de novo.', 0);
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = { message: text.slice(0, 200) }; } }
    if (!res.ok) throw new GHError(explain(res.status, data), res.status);
    return data;
  }

  const seg = encodeURIComponent;
  const base_ = (cfg) => '/repos/' + seg(cfg.owner) + '/' + seg(cfg.repo);
  const refPath = (branch) => branch.split('/').map(seg).join('/');

  /* ---------- binário <-> texto ---------- */
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(s);
  }
  function b64ToBytes(b64) {
    const bin = root.atob(String(b64).replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // SHA-1 no formato do git ("blob <tamanho>\0<conteúdo>"): é o mesmo SHA que o GitHub guarda.
  async function gitBlobSha(bytes) {
    if (!root.crypto || !root.crypto.subtle) return null;
    const head = enc.encode('blob ' + bytes.length + '\0');
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head, 0);
    all.set(bytes, head.length);
    const dig = new Uint8Array(await root.crypto.subtle.digest('SHA-1', all));
    return Array.from(dig, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function pool(items, limit, worker) {
    let i = 0;
    const run = async () => { while (i < items.length) { const k = i++; await worker(items[k], k); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  }

  /* ---------- leitura do repositório ---------- */
  async function getRepo(cfg) {
    return api(cfg, 'GET', base_(cfg));
  }

  async function test(cfg) {
    const r = await getRepo(cfg);
    return {
      fullName: r.full_name,
      isPrivate: !!r.private,
      defaultBranch: r.default_branch,
      canPush: r.permissions ? !!r.permissions.push : true,
    };
  }

  async function readRemote(cfg, branch) {
    let head = null;
    try {
      const ref = await api(cfg, 'GET', base_(cfg) + '/git/ref/heads/' + refPath(branch));
      head = ref.object.sha;
    } catch (e) {
      if (e.status !== 404 && e.status !== 409) throw e;
      try {
        await api(cfg, 'GET', base_(cfg) + '/commits?per_page=1');
      } catch (e2) {
        if (e2.status === 409) return { empty: true, head: null, treeSha: null, files: new Map() };
        throw e2;
      }
      throw new GHError('A branch "' + branch + '" não existe nesse repositório.', 404);
    }
    const commit = await api(cfg, 'GET', base_(cfg) + '/git/commits/' + head);
    const treeSha = commit.tree.sha;
    const tree = await api(cfg, 'GET', base_(cfg) + '/git/trees/' + treeSha + '?recursive=1');
    if (tree.truncated) throw new GHError('O repositório é grande demais para ler de uma vez.', 0);
    const prefix = prefixOf(cfg);
    const files = new Map();
    for (const t of tree.tree) {
      if (t.type !== 'blob') continue;
      if (prefix && !t.path.startsWith(prefix)) continue;
      const rel = t.path.slice(prefix.length);
      if (!root.Fmt.isManaged(rel)) continue;
      files.set(rel, { sha: t.sha, size: t.size });
    }
    return { empty: false, head, treeSha, files };
  }

  /* Baixa os arquivos que mudaram no repositório.
     opts.localShas: Map(caminho -> sha) dos arquivos locais
     opts.all: baixa tudo (substituir).
     Pula o que é igual ao local ou que não mudou no GitHub desde a última sincronização
     (assim edições locais ainda não enviadas não são sobrescritas). Quando o arquivo mudou
     dos dois lados, devolve o caminho em `conflicts`. */
  async function pull(cfg, opts, progress) {
    progress = progress || (() => {});
    const repo = await getRepo(cfg);
    const branch = cfg.branch || repo.default_branch;
    progress('Lendo o repositório…');
    const remote = await readRemote(cfg, branch);
    const out = { items: [], head: remote.head, total: remote.files.size, skipped: 0, conflicts: new Set(), remotePaths: new Set(remote.files.keys()), remoteShas: new Map() };
    if (remote.empty || !remote.files.size) return out;
    const synced = getSynced(cfg);
    const base = synced ? synced.shas : null;
    const todo = [];
    for (const [rel, f] of remote.files) {
      out.remoteShas.set(rel, f.sha);
      if (opts.all) { todo.push(rel); continue; }
      const L = opts.localShas ? opts.localShas.get(rel) : undefined;
      const B = base ? base.get(rel) : undefined;
      if (L === f.sha || (B !== undefined && B === f.sha)) { out.skipped++; continue; }
      if (L !== undefined && !(B !== undefined && L === B)) out.conflicts.add(rel);
      todo.push(rel);
    }
    let done = 0;
    await pool(todo, 6, async (rel) => {
      const blob = await api(cfg, 'GET', base_(cfg) + '/git/blobs/' + remote.files.get(rel).sha);
      const bytes = b64ToBytes(blob.content);
      out.items.push(root.Fmt.classify(rel) === 'image' ? { path: rel, bytes } : { path: rel, text: dec.decode(bytes) });
      progress('Baixando arquivos (' + (++done) + '/' + todo.length + ')…');
    });
    return out;
  }

  /* ---------- envio ---------- */
  async function createInitialCommit(cfg, branch) {
    const path = (prefixOf(cfg) + '.gitkeep').split('/').map(seg).join('/');
    await api(cfg, 'PUT', base_(cfg) + '/contents/' + path, {
      message: 'Iniciar repositório de notas',
      content: bytesToB64(enc.encode('\n')),
      branch,
    });
  }

  /* local: [{ path, sha, text?, getBytes() }]
     o.confirm(resumo) -> Promise<boolean> é chamado quando o envio apaga arquivos ou o
     repositório mudou desde a última sincronização deste navegador. */
  async function push(cfg, local, o, progress) {
    progress = progress || (() => {});
    o = o || {};
    const repo = await getRepo(cfg);
    if (repo.permissions && repo.permissions.push === false) {
      throw new GHError('O token não tem permissão de escrita neste repositório ("Contents: Read and write").', 403);
    }
    const branch = cfg.branch || repo.default_branch;
    progress('Lendo o repositório…');
    let remote = await readRemote(cfg, branch);
    let fresh = false;
    if (remote.empty) {
      if (branch !== repo.default_branch) {
        throw new GHError('O repositório está vazio. Na primeira vez use a branch padrão ("' + repo.default_branch + '") ou deixe o campo em branco.', 409);
      }
      progress('Criando o primeiro commit…');
      await createInitialCommit(cfg, branch);
      remote = await readRemote(cfg, branch);
      fresh = true;
    }

    const localMap = new Map(local.map((f) => [f.path, f]));
    const changed = local.filter((f) => {
      const r = remote.files.get(f.path);
      return !r || !f.sha || r.sha !== f.sha;
    });
    const removed = Array.from(remote.files.keys()).filter((p) => !localMap.has(p));
    const localShas = () => new Map(local.map((f) => [f.path, f.sha]));
    if (!changed.length && !removed.length) {
      setSynced(cfg, remote.head, localShas());
      return { upToDate: true, head: remote.head };
    }
    const added = changed.filter((f) => !remote.files.has(f.path)).length;
    const modified = changed.length - added;

    // Alterações que existem no GitHub e este navegador ainda não viu (seriam sobrescritas/apagadas).
    const synced = getSynced(cfg);
    const seen = synced ? synced.shas : new Map();
    const unseen = changed.filter((f) => remote.files.has(f.path) && seen.get(f.path) !== remote.files.get(f.path).sha).length;
    const unseenRemoved = removed.filter((p) => seen.get(p) !== remote.files.get(p).sha).length;
    if (!fresh && o.confirm && (unseen || unseenRemoved || (!synced && removed.length))) {
      const ok = await o.confirm({ added, modified, removed: removed.length, unseen, unseenRemoved, neverSynced: !synced });
      if (!ok) return { cancelled: true };
    }

    const prefix = prefixOf(cfg);
    const entries = [];
    let n = 0;
    await pool(changed, 4, async (f) => {
      if (f.text) {
        entries.push({ path: prefix + f.path, mode: '100644', type: 'blob', content: f.text });
      } else {
        const bytes = await f.getBytes();
        const blob = await api(cfg, 'POST', base_(cfg) + '/git/blobs', { content: bytesToB64(bytes), encoding: 'base64' });
        entries.push({ path: prefix + f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      progress('Enviando arquivos (' + (++n) + '/' + changed.length + ')…');
    });
    for (const p of removed) entries.push({ path: prefix + p, mode: '100644', type: 'blob', sha: null });

    progress('Criando o commit…');
    const tree = await api(cfg, 'POST', base_(cfg) + '/git/trees', { base_tree: remote.treeSha, tree: entries });
    const message = o.message || 'Sincronização de notas — ' + added + ' novos, ' + modified + ' alterados, ' + removed.length + ' removidos';
    const commit = await api(cfg, 'POST', base_(cfg) + '/git/commits', { message, tree: tree.sha, parents: [remote.head] });
    await api(cfg, 'PATCH', base_(cfg) + '/git/refs/heads/' + refPath(branch), { sha: commit.sha, force: false });
    setSynced(cfg, commit.sha, localShas());
    return { head: commit.sha, added, modified, removed: removed.length };
  }

  root.Sync = {
    getConfig, saveConfig, isConfigured, parseRepo, cleanDir, getSynced, setSynced,
    test, pull, push, gitBlobSha, GHError,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
