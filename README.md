# Sistema Rápido de Notas — v1

Sistema estático (HTML + CSS + JS, sem build) de lançamento de notas escolares:
turmas, disciplinas, alunos, notas por bimestre, frequência, 5º Conceito,
Boletim Final, estatísticas com gráficos e exportação para Excel/PDF.
Os dados ficam no `localStorage` e, opcionalmente, sincronizados com
Google Sheets através de um Google Apps Script.

## Como rodar

- **Uso normal:** abra `index.html` no navegador (duplo clique é suficiente).
- **Testes das regras de negócio:** `npm test` (Node ≥ 18, sem dependências).
- **Teste E2E em navegador:** `node test/e2e.mjs` (abre o index.html no Chrome
  headless com rede bloqueada e exercita logins, cadastro, estatísticas,
  boletim público, modal e notificações — requer Google Chrome instalado).
- **Verificações automáticas:** `npm run verificar` (sintaxe dos 11 módulos, CSP, handlers
  inline, `data-fn` órfãos, catches vazios, login em formulário, coerência da divisão
  `index.html` ⇄ `js/` e garantia de que não há `app.js` solto).

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | Telas (login, sistema, estatísticas, boletim público, acesso restrito). As estatísticas existem uma única vez num `<template>` e são clonadas para as duas telas. Carrega os módulos de `js/` na ordem canônica. |
| `js/config.js` | Configuração da nuvem, `esc()`, hash de senhas (SHA-256), sanitização de estado, notificações, confirmação modal, trava de tentativas, debounce e delegação de eventos. |
| `js/nuvem.js` | Sincronização com Google Sheets (fila, diff/remendos, conflitos) e backup/restauração. |
| `js/turmas.js` | Abas, criação de turmas e dados de demonstração. |
| `js/cadastro.js` | CRUD de disciplinas, professores, alunos, importação de planilha e `renderAdmin`. |
| `js/notas.js` | Tabela de notas e 5º Conceito (cálculo e renders). |
| `js/acesso.js` | Login em formulário (admin/professor), sessão e abas do sistema. |
| `js/boletim.js` | Boletim Final, frequências, situação final e exportações Excel/PDF. |
| `js/classificacao.js` | Regras de aprovação/recuperação/labels (o coração das regras de negócio). |
| `js/telas-publicas.js` | Acesso Restrito (hash + trava) e Boletim Público. |
| `js/estatisticas.js` | Cálculo e renderização de estatísticas, gráficos e rankings. |
| `js/init.js` | Inicialização, sincronização entre abas e delegação de eventos. |
| `styles.css` | Tema escuro + responsivo + componentes (toast, modal, login). |
| `test/` | Testes de regressão das regras de negócio (19), E2E headless (`node test/e2e.mjs`) e harness em `apoio.js`. |
| `tools/` | `verificar.mjs` — lint do projeto (`npm run verificar`). |

## Segurança — o que foi feito

- **Senhas em hash (SHA-256 com prefixo `v1:`)** — senha do administrador e dos
  professores nunca ficam em texto puro no `localStorage`/nuvem; a migração é
  automática e idempotente (`normalizarSegredos`).
- **Login em formulário** com trava de tentativas (3 erros → 5 s) no lugar de
  `prompt()`/`alert()`; o mesmo no Acesso Restrito (5 erros → 60 s), cuja senha
  também passou a existir **apenas como hash** no código-fonte.
- **XSS:** toda interpolação de valor de usuário passa por `esc()`; as
  notificações usam `textContent` (nunca HTML).
- **CSP sem `script-src 'unsafe-inline'`** — todos os handlers viraram
  delegação via `data-fn`/`data-args` (JSON, sem `eval`).
- **Sanitização de estado** em todo carregamento (nota fora de 0–10, frequência
  fora de 0–100, estrutura quebrada… são descartadas/coeridas sem quebrar a tela).
- **`alert`/`prompt`/`confirm` bloqueantes substituídos** por notificações
  (toast) e confirmação modal assíncrona.

## Limitações conhecidas (por decisão/scope)

1. **A autenticação é inteiramente no cliente** (senha comparada no navegador).
   Quem abrir o código-fonte pode simular qualquer perfil. Um backend próprio
   (com hash de senha no servidor) seria o passo natural.
2. **A chave secreta do Apps Script está no código do cliente** — é como o
   protocolo atual funciona; trocar exige alterar também o `Código.gs`
   (arquivo `APPS_SCRIPT_NUVEM.txt`, que não está neste repositório).
3. **Estatísticas e Boletim público continuam sem autenticação** — mantido
   propositalmente, conforme pedido.

> A divisão do antigo `app.js` (5.638 linhas) em 11 módulos foi feita em
> novembro de 2026 e comprovada **byte a byte** na migração; hoje a coerência
> `index.html` ⇄ `js/` é conferida de forma permanente por `npm run verificar`
> (que também falha se um `app.js` solto voltar a existir). O monólito
> original permanece no histórico do Git (`git show <commit>:app.js`).

## Regras de negócio (garantidas por testes)

- Nota: apenas **inteiros de 0 a 10** (vazio = apaga).
- 5º Conceito: média dos 4 bimestres com **bimestre vazio = 0** (ou valor
  editado pelo admin).
- Aprovação: **5º Conceito ≥ 5** (valor arredondado a 1 casa).
- Recuperação: **média do semestre < 5**, independente da aprovação.
- Frequência: **> 75% OK · = 75% Limite · < 75% Atenção**.
- Situação Final: decisão **manual** (sem cálculo automático).
