# Escrita

Caderno de textos e ideias com cara de livro envelhecido (papel amarelo pastel, tinta preta).
É um app **web** (PWA): roda no navegador, funciona offline e pode ser instalado como se fosse um aplicativo de desktop — inclusive no Linux.

## O que faz

- **Pastas e subpastas** sem limite de profundidade; arraste notas, imagens e pastas para mover.
- **Notas em markdown**, com os modos **Escrever**, **Ler**, **Anotações** e **Escrever + Anotações** (lado a lado).
- **Modo anotações**: uma lista de coisas que você quer mudar no texto, com caixa de "resolvida". Selecione um trecho e use **Anotar seleção** para guardar a citação junto; "ver no texto" leva de volta ao trecho.
- **Tags** por nota (campo "+ tag"), lista de tags na lateral para filtrar.
- **Busca por trechos de texto** (Ctrl+K) em títulos, textos, anotações e tags — ignora acentos e maiúsculas, mostra o trecho encontrado e abre a nota já com ele selecionado. Aceita `palavras`, `"frase exata"` e `#tag`.
- **Imagens**: cole (Ctrl+V), arraste para o texto ou use o botão. Ficam na pasta da nota e são referenciadas com `![legenda](foto.png)` (caminhos relativos, como em qualquer repositório markdown).
- **Links entre notas**: `[[Título da nota]]`.
- **Exportar/importar** toda a estrutura em `.zip`, ou importar uma pasta do computador.
- **Sincronização com um repositório privado do GitHub** (enviar e baixar).

## Como rodar (Linux, macOS, Windows)

Não há build nem dependências para usar. Na pasta do projeto:

```bash
python3 -m http.server 8080      # ou: npm start
```

Abra <http://localhost:8080> no Chrome, Chromium, Edge ou Firefox.

**Instalar como app de desktop** (Chrome/Chromium/Edge): ícone de instalar na barra de endereço, ou menu ⋮ → *Instalar Escrita*. Abre numa janela própria, sem barra do navegador, e funciona offline.

**Hospedar de graça**: em *Settings → Pages* deste repositório, publique a branch `main` (pasta raiz). Você ganha um endereço `https://…github.io/App-escrita/`. Os textos continuam só no seu navegador; o site serve apenas o programa.

> Abrir o `index.html` direto (file://) também funciona, mas sem o modo offline/instalável.

## Onde ficam os dados

Os textos ficam **no armazenamento do navegador** (IndexedDB), neste computador e neste endereço. Limpar os dados do site apaga tudo, então use **Arquivo → Exportar** ou o GitHub como cópia de segurança. O app pede ao navegador armazenamento persistente para reduzir o risco de limpeza automática.

## Sincronizar com o GitHub

1. Crie um repositório **privado** (pode ser vazio).
2. Crie um [token fine-grained](https://github.com/settings/personal-access-tokens/new): *Only select repositories* → o repositório de notas → *Permissions → Contents: Read and write*.
3. No app: **GitHub → Configurar…** — informe `usuario/repositorio`, a branch (opcional), a pasta dentro do repositório (padrão `notas`) e o token. *Testar conexão* confirma que ele é privado.
4. **GitHub → Enviar** cria um commit com o que mudou; **GitHub → Baixar** traz as mudanças (mesclar ou substituir).

Cuidados que o app toma:

- Avisa se o repositório for público.
- O envio é incremental (compara o SHA de cada arquivo) e avisa antes de sobrescrever/apagar algo que mudou no GitHub e você ainda não baixou.
- Ao baixar em modo *mesclar*, edições locais ainda não enviadas são preservadas; se o mesmo texto mudou nos dois lados, a sua versão fica numa nota "(conflito local …)".
- O token é guardado só no navegador, em texto simples. Use um token restrito a esse único repositório.

## Como os arquivos ficam no repositório

Cada pasta vira uma pasta, e cada nota um arquivo legível por qualquer editor (ou Obsidian):

```
notas/
  Livro/
    Capítulos/
      Cap 1.md                  # texto, com front matter (título, tags, datas)
      Cap 1.anotacoes.md        # anotações (só existe se houver)
      foto.png                  # imagens ficam ao lado das notas
  Pasta vazia/.gitkeep
```

```markdown
---
title: "Cap 1"
tags: ["conto","ideia"]
created: 2026-10-11T22:00:00.000Z
updated: 2026-10-11T22:05:00.000Z
---

Texto da nota em markdown…
```

## Atalhos

`Ctrl+K` buscar · `Ctrl+S` salvar agora (também salva sozinho) · `Ctrl+B` negrito · `Ctrl+I` itálico · `F2` renomear e `Delete` excluir no item selecionado da lista.

## Desenvolvimento

```bash
npm install        # só para os testes (jsdom, fake-indexeddb, jszip)
npm test           # testes do formato/busca + teste de interface com GitHub simulado
```

Estrutura: `js/format.js` (arquivos ↔ dados) e `js/search.js` (busca) são funções puras; `js/db.js` (IndexedDB); `js/sync.js` e `js/io.js` (GitHub, ZIP); `js/app-*.js` (interface). Bibliotecas em `vendor/` (marked, DOMPurify, JSZip) e fontes em `fonts/` (EB Garamond, IM Fell English) vêm junto para funcionar offline — veja `vendor/LICENSES.md`.

## Limitações conhecidas

- Os dados vivem em um navegador por vez; para usar em dois computadores, sincronize via GitHub.
- A mesclagem é por arquivo (nota inteira), não por linha.
- Renomear uma **pasta** não atualiza referências relativas de imagens em notas de outras pastas (renomear/mover a própria imagem atualiza).
- Instalar como app no desktop não é suportado pelo Firefox; use-o em uma aba normal.
