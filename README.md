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
- **Verificações automáticas:** `npm run verificar` (sintaxe, CSP, handlers
  inline, `data-fn` órfãos, catches vazios, login em formulário).

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | Telas (login, sistema, estatísticas, boletim público, acesso restrito). As estatísticas existem uma única vez num `<template>` e são clonadas para as duas telas. |
| `app.js` | Toda a lógica: persistência, nuvem (fila/diff/conflitos), CRUD, renders, gráficos e exportações. |
| `styles.css` | Tema escuro + responsivo + componentes (toast, modal, login). |
| `test/` | Testes de regressão das regras de negócio (médias, aprovação, recuperação, frequência, hash de senha, sanitização de estado). |
| `tools/` | `dividir-app.js` (script de divisão do monólito, já executado) e `verificar.mjs` (lint). |

## Segurança — o que foi feito

- **Senhas em hash (SHA-256 com prefixo `v1:`)** — senha do administrador e dos
  professores nunca ficam em texto puro no `localStorage`/nuvem; a migração é
  automática e idempotente (`normalizarSegredos`).
- **Login em formulário** com trava de tentativas (3 erros → 5 s) no lugar de
  `prompt()`/`alert()`; o mesmo no Acesso Restrito (5 erros → 60 s).
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
3. **A senha do “Acesso Restrito” continua em texto no fonte** — mover para hash
   exige recalcular a constante (pendente de autorização explícita; a trava de
   tentativas já está ativa).
4. **Estatísticas e Boletim público continuam sem autenticação** — mantido
   propositalmente, conforme pedido.
5. **`app.js` ainda é um arquivo grande** — a divisão em módulos foi escrita
   (`tools/dividir-app.js`) mas o comando de divisão precisou ser autorizado
   separadamente; os testes e o verificador cobrem o código atual.

## Regras de negócio (garantidas por testes)

- Nota: apenas **inteiros de 0 a 10** (vazio = apaga).
- 5º Conceito: média dos 4 bimestres com **bimestre vazio = 0** (ou valor
  editado pelo admin).
- Aprovação: **5º Conceito ≥ 5** (valor arredondado a 1 casa).
- Recuperação: **média do semestre < 5**, independente da aprovação.
- Frequência: **> 75% OK · = 75% Limite · < 75% Atenção**.
- Situação Final: decisão **manual** (sem cálculo automático).
