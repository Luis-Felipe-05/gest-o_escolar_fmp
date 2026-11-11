'use strict';
// Testes das proteções novas: hash de senha, sanitização de estado,
// notificações e delegação de eventos. Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, arquivosDoApp } = require('./apoio');

const app = carregarApp(arquivosDoApp());

test('sha256Hex confere com vetores conhecidos (FIPS 180-4)', () => {
  assert.equal(
    app.rodar(`sha256Hex('')`),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(
    app.rodar(`sha256Hex('abc')`),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  // mensagem com mais de 64 bytes (passa por múltiplos blocos + padding)
  assert.equal(
    app.rodar(`sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')`),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
  // UTF-8 (acentos) — vetor obtido com implementação de referência
  assert.equal(
    app.rodar(`sha256Hex('ação')`),
    '0664077f33cc3ebbaa4bbdacac0eb70e740983080f01dce29929e73b7785a7ad'
  );
});

test('hashSenha produz formato v1: e senhaCorreta valida', () => {
  const h = app.rodar(`hashSenha('minha-senha')`);
  assert.match(h, /^v1:[0-9a-f]{64}$/);
  assert.equal(app.rodar(`ehHashSenha('${h}')`), true);
  assert.equal(app.rodar(`senhaCorreta('minha-senha', '${h}')`), true);
  assert.equal(app.rodar(`senhaCorreta('outra', '${h}')`), false);
  assert.equal(app.rodar(`senhaCorreta('', '${h}')`), false);
  // Caminho legado: valor ainda em texto puro (dado antigo não migrado)
  assert.equal(app.rodar(`senhaCorreta('antiga', 'antiga')`), true);
  assert.equal(app.rodar(`senhaCorreta('errada', 'antiga')`), false);
  assert.equal(app.rodar(`senhaCorreta('x', '')`), false);
});

test('normalizarSegredos migra textos puros para hash (e é idempotente)', () => {
  const expr = `
    (() => {
      const obj = {
        senhaAdmin: 'admin123',
        turmas: {
          t1: { nome: 'A', disciplinas: [
            { id: 'd1', nome: 'Mat', professor: 'João', senha: '123' },
            { id: 'd2', nome: 'Port', professor: 'João', senha: 'v1:' + 'a'.repeat(64) }
          ] }
        }
      };
      normalizarSegredos(obj);
      const depois1 = JSON.stringify(obj);
      normalizarSegredos(obj);
      const depois2 = JSON.stringify(obj);
      return {
        admin: obj.senhaAdmin,
        s1: obj.turmas.t1.disciplinas[0].senha,
        s2: obj.turmas.t1.disciplinas[1].senha,
        idempotente: depois1 === depois2
      };
    })()
  `;
  const r = app.rodar(expr);
  assert.match(r.admin, /^v1:[0-9a-f]{64}$/);
  assert.match(r.s1, /^v1:[0-9a-f]{64}$/);
  assert.equal(r.s2, 'v1:' + 'a'.repeat(64)); // já era hash: não re-hasheia
  assert.equal(r.idempotente, true);
});

test('sanitizarEstado descarta dados impossíveis e mantém os válidos', () => {
  const expr = `
    (() => {
      const obj = {
        bimestreAtual: 9,
        turmas: {
          bom: {
            nome: '9º A',
            disciplinas: [{ id: 'd1', nome: 'Mat', professor: 'J', senha: 'x' }, 'lixo', null],
            alunos: [{ id: 'a1', nome: 'Ana' }, { semId: true }],
            notas: { 1: { d1: { a1: 8, a2: 15, a3: 'abc', a4: '7', a5: null } } },
            frequencias: { 1: { a1: 80, a2: 150, a3: '90' } },
            conceitosFinais: { a1: { d1: 6, d2: 99 } },
            situacoesFinais: { a1: { d1: 'aprovado_nota_freq', d2: 'qualquer-coisa' } }
          },
          quebrada: 'não é turma'
        }
      };
      sanitizarEstado(obj);
      const t = obj.turmas.bom;
      return {
        bim: obj.bimestreAtual,
        temQuebrada: 'quebrada' in obj.turmas,
        discs: t.disciplinas.length,
        alunos: t.alunos.length,
        n1: t.notas[1].d1.a1,
        n2: t.notas[1].d1.a2 === undefined,
        n3: t.notas[1].d1.a3 === undefined,
        n4: t.notas[1].d1.a4,
        n5: t.notas[1].d1.a5 === undefined,
        f1: t.frequencias[1].a1,
        f2: t.frequencias[1].a2 === undefined,
        f3: t.frequencias[1].a3,
        c1: t.conceitosFinais.a1.d1,
        c2: t.conceitosFinais.a1.d2 === undefined,
        s1: t.situacoesFinais.a1.d1,
        s2: t.situacoesFinais.a1.d2 === undefined
      };
    })()
  `;
  const r = app.rodar(expr);
  assert.equal(r.bim, 1);              // bimestre inválido volta para 1
  assert.equal(r.temQuebrada, false);  // entrada que não é objeto de turma é removida
  assert.equal(r.discs, 1);            // só entradas com id string
  assert.equal(r.alunos, 1);
  assert.equal(r.n1, 8);               // nota válida permanece
  assert.equal(r.n2, true);            // 15 fora de 0–10 → descartada
  assert.equal(r.n3, true);            // não numérica → descartada
  assert.equal(r.n4, 7);               // string numérica válida → vira número
  assert.equal(r.n5, true);            // null → descartada
  assert.equal(r.f1, 80);
  assert.equal(r.f2, true);            // 150 > 100 → descartada
  assert.equal(r.f3, 90);
  assert.equal(r.c1, 6);
  assert.equal(r.c2, true);            // conceito 99 fora de 0–10 → descartado
  assert.equal(r.s1, 'aprovado_nota_freq');
  assert.equal(r.s2, true);            // situação inválida → descartada
});

test('notificar exibe mensagem como TEXTO (sem executar HTML)', () => {
  app.rodar(`notificar('<img src=x onerror=alert(1)>', 'info')`);
  const corpo = app.sandbox.document.body;
  const caixa = corpo.children[corpo.children.length - 1];
  assert.equal(caixa.id, 'caixa-notificacoes');
  const item = caixa.children[caixa.children.length - 1];
  assert.equal(item.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(String(item.innerHTML).includes('<img'), false);
});

test('despacharEvento executa data-fn com data-args (sem eval)', () => {
  const alvo = {
    tagName: 'BUTTON',
    value: 'valor-do-campo',
    parentElement: null,
    parentNode: null,
    getAttribute(chave) {
      return {
        'data-fn': 'notificar',
        'data-args': '["mensagem via delegação", "sucesso"]'
      }[chave] ?? null;
    }
  };
  app.sandbox.__alvo = alvo;
  app.rodar(`despacharEvento({ type: 'click', target: __alvo, preventDefault() {} })`);
  const corpo = app.sandbox.document.body;
  const caixa = corpo.children[corpo.children.length - 1];
  const item = caixa.children[caixa.children.length - 1];
  assert.equal(item.textContent, 'mensagem via delegação');
  assert.match(item.className, /toast-sucesso/);
});

test('interpretarArgs tolera JSON inválido', () => {
  assert.equal(JSON.stringify(app.rodar(`interpretarArgs('[]')`)), '[]');
  assert.equal(JSON.stringify(app.rodar(`interpretarArgs('["a", 1]')`)), '["a",1]');
  assert.equal(JSON.stringify(app.rodar(`interpretarArgs('{{{')`)), '[]');
  assert.equal(JSON.stringify(app.rodar(`interpretarArgs(null)`)), '[]');
});

test('senha do Acesso Restrito existe só como hash v1: (sem texto no fonte)', () => {
  const hash = app.rodar(`SENHA_ACESSO_RESTRITO_HASH`);
  assert.match(hash, /^v1:[0-9a-f]{64}$/);
  // Nenhuma definição em texto puro permanece no código (varre todos os módulos)
  const fs = require('node:fs');
  const path = require('node:path');
  const fonte = arquivosDoApp()
    .map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
    .join('\n');
  assert.equal(/SENHA_ACESSO_RESTRITO\s*=/.test(fonte), false);
  // Senha errada continua sendo rejeitada
  assert.equal(app.rodar(`senhaCorreta('qualquer-coisa', SENHA_ACESSO_RESTRITO_HASH)`), false);
  assert.equal(app.rodar(`senhaCorreta('', SENHA_ACESSO_RESTRITO_HASH)`), false);
});
