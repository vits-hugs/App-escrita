// Teste de fumaça da interface, em jsdom + IndexedDB falso + "GitHub" falso na memória.
// Rode com: node tests/app.smoke.js   (precisa de: npm install)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM, requestInterceptor } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FALHOU ' + name + '\n' + (e.stack || e)); process.exitCode = 1; }
}

/* ---------- "GitHub" falso (só o que o app usa) ---------- */
function fakeGitHub() {
  const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
  const blobSha = (buf) => sha1(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf]));
  const blobs = new Map();
  const commits = new Map(); // sha -> { files: Map(path -> blobSha), parent }
  const trees = new Map();   // sha -> Map(path -> blobSha)
  const s = { head: null, isPrivate: true, calls: [], blobs, commits };
  const putBlob = (buf) => { const h = blobSha(buf); blobs.set(h, buf); return h; };
  const treeOf = (files) => { const t = sha1(JSON.stringify([...files].sort())); trees.set(t, new Map(files)); return t; };
  const newCommit = (files, parent) => { const c = sha1('c' + Math.random() + [...files].join()); commits.set(c, { files, parent, tree: treeOf(files) }); return c; };
  const json = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  s.files = () => (s.head ? commits.get(s.head).files : new Map());
  s.text = (p) => blobs.get(s.files().get(p)).toString('utf8');
  s.setFile = (p, buf) => { const f = new Map(s.files()); f.set(p, putBlob(Buffer.from(buf))); s.head = newCommit(f, s.head); };

  s.fetch = async (url, opts) => {
    const u = new URL(url);
    const rest = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '') + u.search;
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    s.calls.push(method + ' ' + rest);
    if (rest === '' && method === 'GET') return json(200, { full_name: 'eu/notas', private: s.isPrivate, default_branch: 'main', permissions: { push: true } });
    if (rest === '/git/ref/heads/main') return s.head ? json(200, { object: { sha: s.head } }) : json(409, { message: 'Git Repository is empty.' });
    if (rest === '/commits?per_page=1') return s.head ? json(200, [{ sha: s.head }]) : json(409, { message: 'Git Repository is empty.' });
    let m;
    if ((m = rest.match(/^\/git\/commits\/(\w+)$/)) && method === 'GET') return json(200, { tree: { sha: commits.get(m[1]).tree } });
    if ((m = rest.match(/^\/git\/trees\/(\w+)\?recursive=1$/))) return json(200, { truncated: false, tree: [...trees.get(m[1])].map(([p, sha]) => ({ path: p, type: 'blob', sha, size: blobs.get(sha).length })) });
    if ((m = rest.match(/^\/git\/blobs\/(\w+)$/))) return json(200, { encoding: 'base64', content: blobs.get(m[1]).toString('base64') });
    if (rest === '/git/blobs' && method === 'POST') return json(201, { sha: putBlob(Buffer.from(body.content, 'base64')) });
    if (rest === '/git/trees' && method === 'POST') {
      const files = new Map(trees.get(body.base_tree));
      for (const e of body.tree) {
        if (e.sha === null) files.delete(e.path);
        else if (e.content !== undefined) files.set(e.path, putBlob(Buffer.from(e.content, 'utf8')));
        else files.set(e.path, e.sha);
      }
      return json(201, { sha: treeOf(files) });
    }
    if (rest === '/git/commits' && method === 'POST') {
      if (body.parents[0] !== s.head) return json(422, { message: 'bad parent' });
      const c = sha1('c' + Math.random()); commits.set(c, { files: trees.get(body.tree), parent: body.parents[0], tree: body.tree });
      return json(201, { sha: c, html_url: 'x' });
    }
    if (rest === '/git/refs/heads/main' && method === 'PATCH') {
      if (commits.get(body.sha).parent !== s.head) return json(422, { message: 'Update is not a fast forward' });
      s.head = body.sha; return json(200, {});
    }
    if (rest.startsWith('/contents/') && method === 'PUT') {
      const f = new Map(); f.set(decodeURIComponent(rest.slice(10)), putBlob(Buffer.from(body.content, 'base64')));
      s.head = newCommit(f, null); return json(201, {});
    }
    return json(404, { message: 'Not Found: ' + method + ' ' + rest });
  };
  return s;
}

/* ---------- página ---------- */
async function load(opts) {
  opts = opts || {};
  const idb = opts.idb || new IDBFactory();
  const files = requestInterceptor((request) => {
    const u = new URL(request.url);
    if (u.origin !== 'http://localhost') return undefined;
    const file = path.join(ROOT, decodeURIComponent(u.pathname));
    const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    if (!fs.existsSync(file)) return new Response('', { status: 404 });
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': type } });
  });
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', resources: { interceptors: [files] }, pretendToBeVisual: true,
    beforeParse(w) {
      w.indexedDB = idb; w.IDBKeyRange = IDBKeyRange;
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.Blob = Blob; w.File = File;
      w.setImmediate = setImmediate; // o jsdom não tem; navegadores reais têm equivalente
      Object.defineProperty(w, 'crypto', { value: crypto.webcrypto, configurable: true });
      w.URL.createObjectURL = () => 'blob:fake/' + Math.random().toString(36).slice(2);
      w.URL.revokeObjectURL = () => {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      if (opts.fetch) w.fetch = opts.fetch;
      if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) w.localStorage.setItem(k, v);
    },
  });
  const w = dom.window;
  await waitFor(() => w.App && w.App.S && w.document.querySelector('#tree .row, #tree .hint'));
  return { w, idb, App: w.App, $: (s) => w.document.querySelector(s), $$: (s) => Array.from(w.document.querySelectorAll(s)) };
}

async function waitFor(fn, ms) {
  const t = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t > (ms || 4000)) throw new Error('tempo esgotado esperando a interface');
    await sleep(15);
  }
}
const clickBtn = async (p, label) => (await waitFor(() => p.$$('.dialog .btn').find((b) => b.textContent.trim() === label))).click();
const setInput = (p, el, v) => { el.value = v; el.dispatchEvent(new p.w.Event('input', { bubbles: true })); };
const clickMode = (p, label) => p.$$('.mode').find((b) => b.textContent.trim().startsWith(label)).click();
const png = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function createFolder(p, parent, name) {
  const pr = p.App.createFolder(parent);
  setInput(p, await waitFor(() => p.$('.dialog input')), name);
  await clickBtn(p, 'OK');
  await pr;
  return Array.from(p.App.S.folders.values()).find((f) => f.name === name).id;
}

(async () => {
  let p;

  await test('abre com a nota de boas-vindas em modo leitura', async () => {
    p = await load();
    assert.equal(p.$$('#tree .row.note').length, 1);
    await waitFor(() => p.$('#main .page'));
    assert.match(p.$('#main .page').textContent, /Bem-vindo/);
  });

  let folderId; let subId; let noteId;
  await test('cria pasta, subpasta e nota; escreve, põe tag e anota seleção', async () => {
    folderId = await createFolder(p, null, 'Livro');
    subId = await createFolder(p, folderId, 'Capítulos');
    assert.equal(p.App.S.folders.get(subId).parentId, folderId);
    const n = await p.App.createNote(subId, { title: 'Cap 1' });
    noteId = n.id;
    await waitFor(() => p.$('.title-input'));
    clickMode(p, 'Escrever');
    const ta = await waitFor(() => p.$('.editor-ta'));
    const text = 'Um homem encontra uma porta no meio da floresta.\nA porta range.';
    ta.value = text; ta.dispatchEvent(new p.w.Event('input', { bubbles: true }));
    assert.equal(p.App.S.notes.get(noteId).content, text);

    const tag = p.$('.tag-input');
    tag.value = 'Conto, ideia';
    tag.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepEqual([...p.App.S.notes.get(noteId).tags], ['conto', 'ideia']);

    const i = text.indexOf('porta no meio');
    ta.setSelectionRange(i, i + 13);
    p.$('.tool.accent').click();
    const annText = await waitFor(() => p.$('.ann .ann-text'));
    assert.equal(p.$('.ann-quote span').textContent, 'porta no meio');
    setInput(p, annText, 'Trocar por portal');
    assert.equal(p.App.S.notes.get(noteId).annotations[0].text, 'Trocar por portal');
    assert.equal(p.App.S.mode, 'split');
    await sleep(700);
    assert.equal(p.App.pendingNotes.size, 0);
  });

  await test('busca por trecho (sem acento/caixa), por #tag e filtro por chip', async () => {
    const s = p.$('#search');
    setInput(p, s, 'FLORESTA Porta');
    await sleep(300);
    assert.equal(p.$$('#tree .result').length, 1);
    assert.match(p.$('.result-title').textContent, /Cap 1/);
    assert.ok(p.$('.result .snippet mark'));
    setInput(p, s, '"meio da" #cont');
    await sleep(300);
    assert.equal(p.$$('#tree .result').length, 1);
    setInput(p, s, 'inexistente');
    await sleep(300);
    assert.equal(p.$$('#tree .result').length, 0);
    setInput(p, s, '');
    await sleep(300);
    assert.ok(p.$$('#tree .row').length >= 2);
    p.$$('#tags-body .chip').find((c) => c.textContent.startsWith('#ideia')).click();
    assert.equal(p.$$('#tree .result').length, 1);
    p.App.clearSearch();
  });

  await test('clicar num resultado abre a nota e seleciona o trecho', async () => {
    setInput(p, p.$('#search'), 'floresta');
    await sleep(300);
    p.$('#tree .result').click();
    clickMode(p, 'Escrever');
    const at = p.App.S.notes.get(noteId).content.indexOf('floresta');
    p.App.openNote(noteId, { field: 'content', start: at, len: 8 });
    const ta = await waitFor(() => p.$('.editor-ta'));
    assert.equal(ta.value.slice(ta.selectionStart, ta.selectionEnd), 'floresta');
    p.App.clearSearch();
  });

  await test('modo Ler: imagem da pasta, [[link]] e sanitização', async () => {
    const f = new File([png()], 'foto.png', { type: 'image/png' });
    const [img] = await p.App.addImages([f], subId);
    assert.equal(img.name, 'foto.png');
    const n = p.App.S.notes.get(noteId);
    n.content = '# Título\n\nVeja ![x](foto.png) e ![y](nao-existe.png) e [[Cap 1]] e [[Fantasma]].\n\n<img src=x onerror=alert(1)><script>1</script>\n\n[ruim](javascript:alert(1))';
    p.App.openNote(noteId);
    clickMode(p, 'Ler');
    const page = await waitFor(() => p.$('.page'));
    assert.ok(page.querySelector('img.md-img').src.startsWith('blob:'));
    assert.ok(page.querySelector('.img-missing'));
    assert.equal(page.querySelector('a.wikilink[data-note-id]').dataset.noteId, noteId);
    assert.ok(page.querySelector('a.wikilink.broken'));
    assert.ok(!page.querySelector('script'));
    assert.ok(!page.innerHTML.includes('onerror'));
    assert.ok(!page.innerHTML.includes('javascript:'));
    assert.equal(p.App.relPath(img, null), 'Livro/Cap%C3%ADtulos/foto.png');
  });

  await test('mover, renomear imagem atualiza referências, excluir', async () => {
    const img = Array.from(p.App.S.images.values())[0];
    p.App.S.notes.get(noteId).content = '![x](foto.png)';
    const pr = p.App.renameEntity('image', img.id);
    setInput(p, await waitFor(() => p.$('.dialog input')), 'capa-nova.png');
    await clickBtn(p, 'OK');
    await pr;
    assert.equal(img.name, 'capa-nova.png');
    assert.equal(p.App.S.notes.get(noteId).content, '![x](capa-nova.png)');
    await p.App.moveEntity('note', noteId, folderId);
    assert.equal(p.App.S.notes.get(noteId).folderId, folderId);
    await p.App.moveEntity('folder', folderId, subId); // para dentro de si mesma: recusado
    assert.equal(p.App.S.folders.get(folderId).parentId, null);
    await p.App.moveEntity('note', noteId, subId);
    const d = p.App.deleteEntity('image', img.id);
    await clickBtn(p, 'Excluir');
    await d;
    assert.equal(p.App.S.images.size, 0);
  });

  await test('os dados persistem ao recarregar a página', async () => {
    p.App.S.notes.get(noteId).content = 'texto persistido';
    p.App.touch(p.App.S.notes.get(noteId));
    await p.App.flush();
    const q = await load({ idb: p.idb });
    const n = q.App.S.notes.get(noteId);
    assert.equal(n.content, 'texto persistido');
    assert.equal(n.annotations.length, 1);
    assert.deepEqual([...n.tags], ['conto', 'ideia']);
    assert.equal(q.App.S.folders.size, 2);
    q.w.close();
  });

  await test('exportar ZIP e importar (substituindo) numa instalação limpa', async () => {
    const blob = await p.w.IO.exportZip(p.App.snapshotData());
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    assert.ok(names.includes('Livro/Capítulos/Cap 1.md'), names.join('|'));
    assert.ok(names.includes('Livro/Capítulos/Cap 1.anotacoes.md'));
    assert.match(await zip.file('Livro/Capítulos/Cap 1.md').async('string'), /^---\ntitle: "Cap 1"\ntags: \["conto","ideia"\]/);
    const q = await load();
    const items = await q.w.IO.readZip(Buffer.from(await blob.arrayBuffer()));
    const st = await q.App.applyImport(q.w.Fmt.parseFiles(items), 'replace');
    assert.ok(st.notes >= 1);
    const n = Array.from(q.App.S.notes.values()).find((x) => x.title === 'Cap 1');
    assert.equal(n.content, 'texto persistido');
    assert.equal(n.annotations[0].quote, 'porta no meio');
    assert.equal(q.App.S.folders.size, 2);
    q.w.close();
  });

  /* ---------- GitHub ---------- */
  const cfg = JSON.stringify({ owner: 'eu', repo: 'notas', branch: '', dir: 'notas', token: 't' });
  const gh = fakeGitHub();
  const withGh = (extra) => load(Object.assign({ fetch: gh.fetch, storage: { 'ea.github': cfg } }, extra));
  async function push(q) { const pr = q.App.ghPush(); await sleep(50); await pr; }

  let A;
  await test('GitHub: primeiro envio num repositório vazio cria tudo em um commit', async () => {
    A = await withGh();
    const f = new File([png()], 'foto.png', { type: 'image/png' });
    const [fid] = Array.from(A.App.S.folders.values()).filter((x) => x.name === 'Pasta');
    const dir = await createFolder(A, null, 'Pasta');
    await A.App.addImages([f], dir);
    const n = await A.App.createNote(dir, { title: 'Ideia' });
    n.content = 'primeira versão ![](foto.png)'; A.App.touch(n);
    await push(A);
    const files = [...gh.files().keys()].sort();
    assert.ok(files.includes('notas/Pasta/Ideia.md'), files.join('|'));
    assert.ok(files.includes('notas/Pasta/foto.png'));
    assert.ok(!files.includes('notas/.gitkeep'), 'o .gitkeep inicial deve ser removido');
    assert.match(gh.text('notas/Pasta/Ideia.md'), /primeira versão/);
    assert.ok(gh.blobs.get(gh.files().get('notas/Pasta/foto.png')).equals(png()));
  });

  await test('GitHub: segundo envio manda só o que mudou e não repete blobs', async () => {
    const n = Array.from(A.App.S.notes.values()).find((x) => x.title === 'Ideia');
    n.content = 'segunda versão'; A.App.touch(n);
    gh.calls.length = 0;
    await push(A);
    assert.match(gh.text('notas/Pasta/Ideia.md'), /segunda versão/);
    assert.equal(gh.calls.filter((c) => c === 'POST /git/blobs').length, 0, 'imagem não mudou, não deve subir de novo');
    gh.calls.length = 0;
    await push(A);
    assert.ok(!gh.calls.includes('POST /git/commits'), 'sem mudanças não cria commit');
  });

  await test('GitHub: baixar (substituir) em instalação limpa reconstrói tudo', async () => {
    const B = await withGh();
    const pr = B.App.ghPull();
    const radios = await waitFor(() => { const r = B.$$('.dialog input[type=radio]'); return r.length ? r : null; });
    radios[1].click();
    await clickBtn(B, 'Baixar');
    await clickBtn(B, 'Apagar e continuar');
    await pr;
    const n = Array.from(B.App.S.notes.values()).find((x) => x.title === 'Ideia');
    assert.equal(n.content, 'segunda versão');
    assert.equal(Array.from(B.App.S.images.values())[0].name, 'foto.png');
    assert.equal(B.App.S.notes.size, 2); // Ideia + a nota de boas-vindas também enviada
    B.w.close();
  });

  await test('GitHub: mudança remota ainda não baixada pede confirmação antes de sobrescrever', async () => {
    const remoteText = gh.text('notas/Pasta/Ideia.md').replace('segunda versão', 'editada no GitHub');
    gh.setFile('notas/Pasta/Ideia.md', remoteText);
    const n = Array.from(A.App.S.notes.values()).find((x) => x.title === 'Ideia');
    n.content = 'terceira versão local'; A.App.touch(n);
    const pr = A.App.ghPush();
    await waitFor(() => A.$('.dialog') && /sobrescrevê-los/.test(A.$('.dialog').textContent));
    await clickBtn(A, 'Cancelar');
    await pr;
    assert.match(gh.text('notas/Pasta/Ideia.md'), /editada no GitHub/);
  });

  await test('GitHub: baixar (mesclar) com edição nos dois lados guarda cópia de conflito', async () => {
    const pr = A.App.ghPull();
    await clickBtn(A, 'Baixar');
    await pr;
    const notes = Array.from(A.App.S.notes.values());
    const main = notes.find((x) => x.title === 'Ideia');
    const copy = notes.find((x) => /conflito local/.test(x.title));
    assert.match(main.content, /editada no GitHub/);
    assert.ok(copy && copy.content === 'terceira versão local');
  });

  await test('GitHub: repositório público exige confirmação', async () => {
    gh.isPublic = true; gh.isPrivate = false;
    const pr = A.App.ghPush();
    await waitFor(() => A.$('.dialog') && /PÚBLICO/.test(A.$('.dialog').textContent));
    await clickBtn(A, 'Cancelar');
    await pr;
    gh.isPrivate = true;
  });

  console.log(`\n${passed} testes de interface passaram` + (process.exitCode ? ' (há falhas)' : ''));
  process.exit(process.exitCode || 0);
})();
