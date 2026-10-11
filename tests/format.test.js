// Testes das funções puras. Rode com: node tests/format.test.js
const assert = require('node:assert/strict');
const Fmt = require('../js/format.js');
const Busca = require('../js/search.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FALHOU ' + name + '\n' + (e.stack || e)); process.exitCode = 1; }
}

test('sanitizeName remove caracteres inválidos', () => {
  assert.equal(Fmt.sanitizeName('a/b:c*d?'), 'a-b-c-d-');
  assert.equal(Fmt.sanitizeName('  ..oculto.. '), 'oculto');
  assert.equal(Fmt.sanitizeName(''), 'sem-titulo');
  assert.equal(Fmt.sanitizeImageName('minha foto.PNG'), 'minha-foto.PNG');
  assert.equal(Fmt.sanitizeImageName('semextensao'), 'semextensao.png');
});

test('normalizeTag', () => {
  assert.equal(Fmt.normalizeTag('#Ideia Boa'), 'ideia-boa');
  assert.deepEqual(Fmt.normalizeTags(['A', 'a', '#b', '', ' c d ']), ['a', 'b', 'c-d']);
});

test('nota: ida e volta com front matter (acentos, aspas, ---)', () => {
  const note = {
    title: 'Capítulo "1": o começo', tags: ['ideia', 'ficção'],
    createdAt: Date.parse('2026-01-02T03:04:05.000Z'), updatedAt: Date.parse('2026-02-03T04:05:06.000Z'),
    content: '# Título\n\nTexto com ---\n\n---\nfim\n',
  };
  const back = Fmt.parseNote(Fmt.serializeNote(note), 'x');
  assert.equal(back.title, note.title);
  assert.deepEqual(back.tags, note.tags);
  assert.equal(back.content, note.content);
  assert.equal(back.created, note.createdAt);
  assert.equal(back.updated, note.updatedAt);
});

test('nota: conteúdo vazio e sem front matter', () => {
  const empty = Fmt.parseNote(Fmt.serializeNote({ title: 'T', tags: [], content: '' }), 'T');
  assert.equal(empty.content, '');
  const plain = Fmt.parseNote('# Só markdown\r\nlinha\r\n', 'arquivo');
  assert.equal(plain.title, 'arquivo');
  assert.equal(plain.content, '# Só markdown\nlinha\n');
  assert.deepEqual(plain.tags, []);
});

test('nota: front matter escrito à mão (tags em lista e BOM)', () => {
  const t = '﻿---\ntitle: Olá\ntags:\n  - Um\n  - dois três\n---\ncorpo';
  const n = Fmt.parseNote(t, 'f');
  assert.equal(n.title, 'Olá');
  assert.deepEqual(n.tags, ['um', 'dois-três']);
  assert.equal(n.content, 'corpo');
  const n2 = Fmt.parseNote('---\ntags: [a, "b c"]\n---\nx', 'f');
  assert.deepEqual(n2.tags, ['a', 'b-c']);
});

test('anotações: ida e volta (multilinha, citação, concluída)', () => {
  const list = [
    { id: '1', text: 'Mudar o final\n\ncom mais clima', quote: 'trecho\nem duas linhas', done: false },
    { id: '2', text: 'Revisar nomes', quote: '', done: true },
    { id: '3', text: '', quote: 'só citação', done: false },
  ];
  const back = Fmt.parseAnnotations(Fmt.serializeAnnotations(list));
  assert.equal(back.length, 3);
  back.forEach((b, i) => {
    assert.equal(b.text, list[i].text);
    assert.equal(b.quote, list[i].quote);
    assert.equal(b.done, list[i].done);
  });
  assert.equal(Fmt.serializeAnnotations([]), '');
  const loose = Fmt.parseAnnotations('# Anotações\n\ncoisa solta\n- [x] feito\n');
  assert.deepEqual(loose.map((a) => [a.text, a.done]), [['coisa solta', false], ['feito', true]]);
});

function sample() {
  const folders = [
    { id: 'f1', parentId: null, name: 'Livro', createdAt: 1 },
    { id: 'f2', parentId: 'f1', name: 'Capítulos', createdAt: 2 },
    { id: 'f3', parentId: null, name: 'Vazia', createdAt: 3 },
  ];
  const notes = [
    { id: 'n1', folderId: 'f2', title: 'Cap 1', content: 'olá ![](foto.png)', tags: ['x'], annotations: [{ id: 'a', text: 'rever', quote: '', done: false }], createdAt: 10, updatedAt: 11 },
    { id: 'n2', folderId: 'f2', title: 'Cap 1', content: 'duplicado', tags: [], annotations: [], createdAt: 12, updatedAt: 12 },
    { id: 'n3', folderId: null, title: 'Solta/Nota', content: 'raiz', tags: [], annotations: [], createdAt: 13, updatedAt: 13 },
  ];
  const images = [{ id: 'i1', folderId: 'f2', name: 'foto.png', createdAt: 20, blob: 'BLOB' }];
  return { folders, notes, images };
}

test('buildSnapshot: caminhos, duplicados, pasta vazia', () => {
  const { entries, paths } = Fmt.buildSnapshot(sample());
  const list = entries.map((e) => e.path).sort();
  assert.deepEqual(list, [
    'Livro/Capítulos/Cap 1 (2).md',
    'Livro/Capítulos/Cap 1.anotacoes.md',
    'Livro/Capítulos/Cap 1.md',
    'Livro/Capítulos/foto.png',
    'Solta-Nota.md',
    'Vazia/.gitkeep',
  ]);
  assert.equal(paths.notes.get('n1'), 'Livro/Capítulos/Cap 1.md');
  assert.equal(paths.notes.get('n2'), 'Livro/Capítulos/Cap 1 (2).md');
  assert.equal(paths.folders.get('f2'), 'Livro/Capítulos');
});

test('buildSnapshot é determinístico', () => {
  const a = Fmt.buildSnapshot(sample()).entries.map((e) => e.path + e.text);
  const b = Fmt.buildSnapshot(sample()).entries.map((e) => e.path + e.text);
  assert.deepEqual(a, b);
});

test('parseFiles reconstrói a estrutura a partir do snapshot', () => {
  const { entries } = Fmt.buildSnapshot(sample());
  const items = entries.map((e) => (e.kind === 'image' ? { path: e.path, bytes: new Uint8Array([1, 2, 3]) } : { path: e.path, text: e.text }));
  items.push({ path: '.git/config', text: 'x' }, { path: 'lixo.exe', bytes: new Uint8Array(1) });
  const r = Fmt.parseFiles(items);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.folders.map((f) => f.join('/')).sort(), ['Livro', 'Livro/Capítulos', 'Vazia']);
  assert.equal(r.notes.length, 3);
  const cap1 = r.notes.find((n) => n.base === 'Cap 1');
  assert.equal(cap1.title, 'Cap 1');
  assert.deepEqual(cap1.tags, ['x']);
  assert.equal(cap1.annotations.length, 1);
  assert.equal(cap1.annotations[0].text, 'rever');
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].mime, 'image/png');
  assert.deepEqual(r.images[0].dir, ['Livro', 'Capítulos']);
});

test('classify', () => {
  assert.equal(Fmt.classify('a/b.md'), 'note');
  assert.equal(Fmt.classify('a/b.anotacoes.md'), 'annotations');
  assert.equal(Fmt.classify('a/Foto.JPG'), 'image');
  assert.equal(Fmt.classify('a/.gitkeep'), 'keep');
  assert.equal(Fmt.classify('README.txt'), null);
  assert.equal(Fmt.classify('.github/x.md'), null);
});

/* ---------- busca ---------- */

const notes = [
  { id: '1', title: 'Ideia de conto', content: 'Um homem encontra uma porta no meio da floresta.\nA porta range.', tags: ['conto', 'ideia'], annotations: [], updatedAt: 5 },
  { id: '2', title: 'Diário', content: 'Hoje choveu. Pensei na PORTA velha e na ação do vento.', tags: ['diario'], annotations: [{ id: 'a', text: 'trocar "choveu" por "caiu água"', quote: 'Hoje choveu', done: false }], updatedAt: 9 },
  { id: '3', title: 'Lista', content: 'pão, leite', tags: ['ideias'], annotations: [], updatedAt: 1 },
];

test('fold preserva comprimento e ignora acentos', () => {
  const s = 'Ação ÀÉÎ çã 😀 İstanbul';
  assert.equal(Busca.fold(s).length, s.length);
  assert.equal(Busca.fold('Ação'), 'acao');
});

test('busca por trecho ignora acento e caixa; devolve índice no original', () => {
  const r = Busca.search(notes, 'acao do vento');
  assert.equal(r.length, 1);
  assert.equal(r[0].note.id, '2');
  const n = notes[1];
  assert.equal(n.content.slice(r[0].start, r[0].start + r[0].len).toLowerCase(), 'ação do vento');
  assert.ok(r[0].snippet.match.toLowerCase().includes('ação do vento'));
});

test('busca: todas as palavras (qualquer ordem) e frase exata', () => {
  assert.deepEqual(Busca.search(notes, 'floresta porta').map((r) => r.note.id), ['1']);
  assert.deepEqual(Busca.search(notes, '"porta velha"').map((r) => r.note.id), ['2']);
  assert.deepEqual(Busca.search(notes, '"velha porta"').map((r) => r.note.id), []);
  assert.deepEqual(Busca.search(notes, 'porta').map((r) => r.note.id).sort(), ['1', '2']);
});

test('busca em anotações e título', () => {
  const a = Busca.search(notes, 'agua');
  assert.equal(a[0].note.id, '2');
  assert.equal(a[0].field, 'annotations');
  const t = Busca.search(notes, 'conto');
  assert.equal(t[0].note.id, '1');
});

test('busca por #tag (prefixo) e chips', () => {
  assert.deepEqual(Busca.search(notes, '#ide').map((r) => r.note.id).sort(), ['1', '3']);
  assert.deepEqual(Busca.search(notes, '#ideia porta').map((r) => r.note.id), ['1']);
  assert.deepEqual(Busca.search(notes, '', { tags: ['ideia'] }).map((r) => r.note.id), ['1']);
  assert.deepEqual(Busca.search(notes, '', { tags: [] }), []);
  assert.deepEqual(Busca.search(notes, 'porta', { tags: ['diario'] }).map((r) => r.note.id), ['2']);
});

test('ranking: título pesa mais', () => {
  const r = Busca.search([
    { id: 'a', title: 'x', content: 'receita de bolo', tags: [], annotations: [], updatedAt: 1 },
    { id: 'b', title: 'Bolo de fubá', content: 'misture', tags: [], annotations: [], updatedAt: 1 },
  ], 'bolo');
  assert.equal(r[0].note.id, 'b');
});

console.log(`\n${passed} testes passaram` + (process.exitCode ? ' (há falhas)' : ''));
