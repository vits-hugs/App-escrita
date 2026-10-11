/* app-topbar.js — menus Arquivo e GitHub: exportar/importar ZIP, sincronizar, ajuda. */
(function (root) {
  'use strict';
  const App = root.App;
  const { S } = App;
  const { h, toast, modal, confirmBox, choiceBox, busy, menu, fmtDate } = root.UI;
  const $ = (s) => document.querySelector(s);
  const errMsg = (e) => (e && e.message) || String(e);

  /* ---------- exportar / importar ---------- */
  async function doExport() {
    await App.flush();
    const b = busy('Gerando o arquivo ZIP…');
    try {
      const blob = await root.IO.exportZip(App.snapshotData());
      root.UI.downloadBlob(blob, 'escrita-' + new Date().toISOString().slice(0, 10) + '.zip');
      toast('Backup exportado (' + root.UI.fmtBytes(blob.size) + ').');
    } catch (e) { toast('Erro ao exportar: ' + errMsg(e), 'error'); } finally { b.close(); }
  }

  const MERGE = { value: 'merge', label: 'Mesclar com o que já existe', hint: 'Itens com o mesmo caminho são sobrescritos pela versão importada; o resto é mantido.' };
  const REPLACE = { value: 'replace', label: 'Substituir tudo', hint: 'Apaga o conteúdo atual deste navegador e usa só o que veio de fora.' };

  async function confirmReplace() {
    return confirmBox('Isso apaga TUDO o que está salvo neste navegador. Se tiver dúvida, exporte um backup antes.\n\nContinuar?', { danger: true, okLabel: 'Apagar e continuar' });
  }

  function summary(st) {
    const p = [];
    if (st.notes) p.push(st.notes + ' nota(s) nova(s)');
    if (st.updated) p.push(st.updated + ' atualizado(s)');
    if (st.images) p.push(st.images + ' imagem(ns)');
    if (st.folders) p.push(st.folders + ' pasta(s)');
    if (st.conflicts) p.push(st.conflicts + ' conflito(s) — a cópia local foi mantida');
    return p.length ? p.join(', ') : 'nenhuma mudança';
  }

  async function doImport(kind) {
    const files = await root.UI.pickFiles(kind === 'zip' ? { accept: '.zip,application/zip' } : { directory: true });
    if (!files.length) return;
    const b = busy('Lendo os arquivos…');
    let parsed;
    try {
      parsed = root.Fmt.parseFiles(kind === 'zip' ? await root.IO.readZip(files[0]) : await root.IO.readFolder(files));
    } catch (e) { b.close(); toast('Não consegui ler: ' + errMsg(e), 'error'); return; }
    b.close();
    if (!parsed.notes.length && !parsed.images.length && !parsed.folders.length) { toast('Nada para importar: procurei arquivos .md e imagens.', 'error'); return; }
    const mode = await choiceBox({
      title: 'Importar',
      intro: 'Encontrei ' + parsed.notes.length + ' nota(s), ' + parsed.images.length + ' imagem(ns) e ' + parsed.folders.length + ' pasta(s).' + (parsed.skipped ? '\n(' + parsed.skipped + ' arquivo(s) de outros tipos foram ignorados.)' : ''),
      choices: [MERGE, REPLACE], okLabel: 'Importar',
    });
    if (!mode || (mode === 'replace' && !(await confirmReplace()))) return;
    const b2 = busy('Importando…');
    try { toast('Importado: ' + summary(await App.applyImport(parsed, mode))); } catch (e) { toast('Erro ao importar: ' + errMsg(e), 'error'); } finally { b2.close(); }
  }

  /* ---------- GitHub ---------- */
  async function ghSettings() {
    const c = root.Sync.getConfig();
    const repo = h('input', { type: 'text', value: c.owner ? c.owner + '/' + c.repo : '', placeholder: 'seu-usuario/minhas-notas', autocomplete: 'off', spellcheck: 'false' });
    const branch = h('input', { type: 'text', value: c.branch || '', placeholder: 'padrão do repositório (ex.: main)', autocomplete: 'off' });
    const dir = h('input', { type: 'text', value: c.dir == null ? 'notas' : c.dir, placeholder: '(raiz do repositório)', autocomplete: 'off' });
    const token = h('input', { type: 'password', value: c.token || '', placeholder: 'github_pat_…', autocomplete: 'off' });
    const result = h('p', { class: 'hint' });
    const read = () => {
      const r = root.Sync.parseRepo(repo.value);
      return r ? { owner: r.owner, repo: r.repo, branch: branch.value.trim(), dir: root.Sync.cleanDir(dir.value), token: token.value.trim() } : null;
    };
    const body = [
      h('p', { class: 'hint' }, 'Crie um repositório PRIVADO no GitHub e um token de acesso com permissão apenas nele: ',
        h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' }, 'Fine-grained token'),
        ' → “Only select repositories” → Permissions → Contents: Read and write.'),
      h('label', { class: 'field' }, h('span', null, 'Repositório'), repo),
      h('label', { class: 'field' }, h('span', null, 'Branch (opcional)'), branch),
      h('label', { class: 'field' }, h('span', null, 'Pasta dentro do repositório'), dir),
      h('label', { class: 'field' }, h('span', null, 'Token'), token),
      h('p', { class: 'hint' }, 'O token fica salvo apenas neste navegador, em texto simples. Não use um token com acesso a outros repositórios.'),
      result,
    ];
    const r = await modal({
      title: 'Configurar GitHub', body, wide: true,
      buttons: [
        { label: 'Cancelar', value: null },
        { label: 'Testar conexão', value: 'test', onClick: async () => {
          const cfg = read();
          if (!cfg || !cfg.token) { result.textContent = 'Preencha o repositório (usuario/repo) e o token.'; return false; }
          result.textContent = 'Testando…';
          try {
            const t = await root.Sync.test(cfg);
            result.textContent = 'Conectado a ' + t.fullName + (t.isPrivate ? ' (privado) ✔' : ' — ATENÇÃO: este repositório é PÚBLICO.') + (t.canPush ? '' : ' Sem permissão de escrita.');
          } catch (e) { result.textContent = errMsg(e); }
          return false;
        } },
        { label: 'Salvar', value: 'save', kind: 'primary', onClick: () => {
          if (!read()) { result.textContent = 'Use o formato usuario/repositorio.'; return false; }
          return true;
        } },
      ],
    });
    if (r !== 'save') return null;
    const cfg = read();
    root.Sync.saveConfig(cfg);
    toast('Configuração do GitHub salva.');
    return cfg;
  }

  async function ensureConfig() {
    let cfg = root.Sync.getConfig();
    if (!root.Sync.isConfigured(cfg)) cfg = await ghSettings();
    return root.Sync.isConfigured(cfg) ? cfg : null;
  }

  function explainPush(s) {
    const lines = [];
    if (s.unseen) lines.push(s.unseen + ' arquivo(s) foram alterados no GitHub e este navegador ainda não os baixou — suas versões vão sobrescrevê-los.');
    if (s.unseenRemoved) lines.push(s.unseenRemoved + ' arquivo(s) que existem só no GitHub (e você nunca baixou) serão APAGADOS do repositório.');
    else if (s.removed) lines.push(s.removed + ' arquivo(s) que existem no GitHub e não existem aqui serão apagados do repositório.');
    return 'Atenção:\n• ' + lines.join('\n• ') + '\n\nDica: use “Baixar do GitHub” antes para trazer o que está lá.\n\nEnviar mesmo assim?';
  }

  async function ghPush() {
    const cfg = await ensureConfig();
    if (!cfg) return;
    await App.flush();
    let b = busy('Conectando ao GitHub…');
    try {
      const info = await root.Sync.test(cfg);
      if (!info.isPrivate) {
        b.close();
        const ok = await confirmBox('O repositório ' + info.fullName + ' é PÚBLICO: qualquer pessoa poderá ler as suas notas.\n\nEnviar mesmo assim?', { danger: true, okLabel: 'Enviar mesmo assim', title: 'Repositório público' });
        if (!ok) return;
        b = busy('Preparando…');
      }
      b.set('Preparando os arquivos…');
      const local = await root.IO.localFiles(App.snapshotData());
      const res = await root.Sync.push(cfg, local, {
        confirm: async (s) => {
          b.close();
          const ok = await confirmBox(explainPush(s), { danger: true, okLabel: 'Enviar mesmo assim', title: 'Confirmar envio' });
          b = busy('Enviando…');
          return ok;
        },
      }, (t) => b.set(t));
      if (res.cancelled) toast('Envio cancelado.');
      else if (res.upToDate) toast('Tudo já está sincronizado com o GitHub.');
      else toast('Enviado ao GitHub: ' + res.added + ' novo(s), ' + res.modified + ' alterado(s), ' + res.removed + ' removido(s).');
    } catch (e) { toast(errMsg(e), 'error'); } finally { b.close(); }
  }

  async function ghPull() {
    const cfg = await ensureConfig();
    if (!cfg) return;
    const mode = await choiceBox({
      title: 'Baixar do GitHub',
      intro: 'Traz as notas do seu repositório para este navegador.',
      choices: [
        { value: 'merge', label: 'Mesclar (recomendado)', hint: 'Traz só o que mudou no GitHub. Se o mesmo texto mudou nos dois lados, a sua versão é guardada como cópia “(conflito local)”.' },
        REPLACE,
      ],
      okLabel: 'Baixar',
    });
    if (!mode || (mode === 'replace' && !(await confirmReplace()))) return;
    await App.flush();
    const b = busy('Lendo o repositório…');
    try {
      let localShas = null;
      if (mode === 'merge') {
        b.set('Comparando com os arquivos locais…');
        localShas = new Map((await root.IO.localFiles(App.snapshotData())).map((f) => [f.path, f.sha]));
      }
      const res = await root.Sync.pull(cfg, { localShas, all: mode === 'replace' }, (t) => b.set(t));
      if (!res.total) { toast('Não encontrei notas no repositório' + (cfg.dir ? ' (pasta “' + cfg.dir + '”)' : '') + '.', 'error'); return; }
      b.set('Aplicando…');
      const st = await App.applyImport(root.Fmt.parseFiles(res.items), mode, { remotePaths: res.remotePaths, conflicts: res.conflicts });
      root.Sync.setSynced(cfg, res.head, res.remoteShas);
      toast('Baixado do GitHub: ' + summary(st) + '.');
    } catch (e) { toast(errMsg(e), 'error'); } finally { b.close(); }
  }

  /* ---------- ajuda ---------- */
  function help() {
    const li = (...k) => h('li', null, ...k);
    modal({
      title: 'Como usar', wide: true,
      body: h('div', { class: 'help' },
        h('ul', null,
          li(h('b', null, 'Pastas: '), 'crie pastas e subpastas; arraste notas, imagens e pastas para mover.'),
          li(h('b', null, 'Escrever / Ler: '), 'o texto é markdown (# título, **negrito**, *itálico*, - listas, > citação).'),
          li(h('b', null, 'Anotações: '), 'registre o que quer mudar sem alterar o texto. Selecione um trecho e use “Anotar seleção”.'),
          li(h('b', null, 'Tags: '), 'digite no campo “+ tag”; clique numa tag na lateral para filtrar.'),
          li(h('b', null, 'Busca (Ctrl+K): '), 'palavras, ', h('code', null, '"frase exata"'), ' e ', h('code', null, '#tag'), '. Ignora acentos e maiúsculas e mostra o trecho encontrado.'),
          li(h('b', null, 'Imagens: '), 'cole (Ctrl+V), arraste para o texto ou use o botão. Ficam na pasta da nota: ', h('code', null, '![legenda](foto.png)'), '.'),
          li(h('b', null, 'Links entre notas: '), h('code', null, '[[Título da nota]]'), '.'),
          li(h('b', null, 'Atalhos: '), 'Ctrl+K buscar · Ctrl+S salvar · Ctrl+B negrito · Ctrl+I itálico.'),
          li(h('b', null, 'Seus dados: '), 'ficam neste navegador. Faça backup em Arquivo → Exportar, ou sincronize com um repositório privado em GitHub.'))),
      buttons: [{ label: 'Fechar', value: true, kind: 'primary' }],
    });
  }

  function initTopbar() {
    $('#btn-file').addEventListener('click', (e) => menu([
      { label: 'Exportar tudo (.zip)', icon: 'file', onClick: doExport },
      { label: 'Importar arquivo .zip…', onClick: () => doImport('zip') },
      { label: 'Importar pasta do computador…', hint: 'arquivos .md e imagens', onClick: () => doImport('folder') },
    ], e.currentTarget));
    $('#btn-github').addEventListener('click', (e) => {
      const last = root.Sync.isConfigured() ? root.Sync.getSynced(root.Sync.getConfig()) : null;
      menu([
        { label: 'Enviar para o GitHub', icon: 'cloud', hint: last ? 'última sincronização: ' + fmtDate(last.time) : null, onClick: ghPush },
        { label: 'Baixar do GitHub', onClick: ghPull },
        { sep: true },
        { label: 'Configurar…', icon: 'edit', onClick: ghSettings },
      ], e.currentTarget);
    });
    $('#btn-help').addEventListener('click', help);
  }

  Object.assign(App, { initTopbar, doExport, doImport, ghPush, ghPull, ghSettings });
})(typeof globalThis !== 'undefined' ? globalThis : this);
