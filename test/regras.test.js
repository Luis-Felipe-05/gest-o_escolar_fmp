'use strict';
// Testes de regressão das REGRAS DE NEGÓCIO do sistema (não mexem no código).
// Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./apoio');

const app = carregarApp(['app.js']);

test('esc() neutraliza HTML em valores do usuário', () => {
  assert.equal(app.rodar(`esc('<img src=x onerror=alert(1)>')`), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(app.rodar(`esc('a & b "c" \\'d\\'')`), 'a &amp; b &quot;c&quot; &#39;d&#39;');
  assert.equal(app.rodar(`esc(null)`), '');
  assert.equal(app.rodar(`esc(undefined)`), '');
});

test('validarNota aceita apenas inteiros de 0 a 10 (ou vazio)', () => {
  // Observação: objetos vêm de outro contexto (vm), então comparamos por JSON.
  const j = e => JSON.stringify(app.rodar(e));
  assert.equal(j(`validarNota('')`), JSON.stringify({ valido: true, nota: '' }));
  assert.equal(j(`validarNota(null)`), JSON.stringify({ valido: true, nota: '' }));
  assert.equal(j(`validarNota('0')`), JSON.stringify({ valido: true, nota: 0 }));
  assert.equal(j(`validarNota('10')`), JSON.stringify({ valido: true, nota: 10 }));
  assert.equal(app.rodar(`validarNota('7.5').valido`), false);
  assert.equal(app.rodar(`validarNota('-1').valido`), false);
  assert.equal(app.rodar(`validarNota('11').valido`), false);
  assert.equal(app.rodar(`validarNota('abc').valido`), false);
});

test('classificarAprovacao: 5º Conceito >= 5 aprova', () => {
  assert.equal(app.rodar(`classificarAprovacao(5)`), 'aprovado');
  assert.equal(app.rodar(`classificarAprovacao(4.9)`), 'reprovado');
  assert.equal(app.rodar(`classificarAprovacao(0)`), 'reprovado');
  assert.equal(app.rodar(`classificarAprovacao(null)`), 'indeterminado');
  assert.equal(app.rodar(`classificarAprovacao(undefined)`), 'indeterminado');
});

test('classificarRecuperacao: média de semestre < 5', () => {
  assert.equal(app.rodar(`classificarRecuperacao(4, 6)`), 'rec1');
  assert.equal(app.rodar(`classificarRecuperacao(6, 4)`), 'rec2');
  assert.equal(app.rodar(`classificarRecuperacao(4, 4)`), 'rec1+rec2');
  assert.equal(app.rodar(`classificarRecuperacao(6, 6)`), 'nenhuma');
  assert.equal(app.rodar(`classificarRecuperacao(5, 5)`), 'nenhuma');
  assert.equal(app.rodar(`classificarRecuperacao(null, null)`), 'indeterminado');
  assert.equal(app.rodar(`classificarRecuperacao(4, null)`), 'rec1');
});

test('classificarFrequência: >75 OK, =75 Limite, <75 Atenção', () => {
  assert.equal(app.rodar(`classificarFrequencia(76)`), 'ok');
  assert.equal(app.rodar(`classificarFrequencia(75)`), 'limite');
  assert.equal(app.rodar(`classificarFrequencia(74.9)`), 'atencao');
  assert.equal(app.rodar(`classificarFrequencia('')`), null);
  assert.equal(app.rodar(`classificarFrequencia(null)`), null);
  assert.equal(app.rodar(`classificarFrequencia('abc')`), null);
});

test('calcularMediaFinal: média das notas lançadas (sem nota = null)', () => {
  const expr = `
    (() => {
      const turma = { notas: {
        1: { d1: { a1: 8 } }, 2: { d1: { a1: 6 } }, 3: { d1: { a1: 10 } }, 4: { d1: { a1: 7 } }
      } };
      return { com: calcularMediaFinal(turma, 'd1', 'a1'), sem: calcularMediaFinal(turma, 'd1', 'a2') };
    })()
  `;
  const r = app.rodar(expr);
  assert.equal(r.com, 7.75);
  assert.equal(r.sem, null);
});

test('frequência média do aluno é a média dos bimestres lançados', () => {
  const expr = `
    (() => {
      const turma = { alunos: [{ id: 'a1' }], frequencias: { 1: { a1: 100 }, 2: { a1: 50 } } };
      return getFrequenciaMediaNum(turma, 'a1');
    })()
  `;
  assert.equal(app.rodar(expr), 75);
});

test('computarRemendos devolve apenas o que mudou (diff da nuvem)', () => {
  const expr = `
    (() => {
      const base = { turmas: { t1: { nome: 'A', alunos: [{ id: 'a1', nome: 'Ana' }] } }, x: 1 };
      const alvo = { turmas: { t1: { nome: 'B', alunos: [{ id: 'a1', nome: 'Ana' }] }, t2: { nome: 'Nova' } }, x: 1 };
      return computarRemendos(base, alvo);
    })()
  `;
  const remendos = app.rodar(expr);
  assert.ok(Array.isArray(remendos));
  assert.ok(remendos.some(r => r.caminho.join('.') === 'turmas.t1.nome' && r.valor === 'B'));
  assert.ok(remendos.some(r => r.caminho.join('.') === 'turmas.t2' && r.valor && r.valor.nome === 'Nova'));
  assert.ok(!remendos.some(r => r.caminho.join('.') === 'x'));
});

test('definirCaminho define e remove caminhos no estado', () => {
  const expr = `
    (() => {
      const obj = { turmas: {} };
      definirCaminho(obj, ['turmas', 't1', 'nome'], '9º A');
      const definido = obj.turmas.t1.nome;
      definirCaminho(obj, ['turmas', 't1'], null, true);
      return { definido, removido: !obj.turmas.t1 };
    })()
  `;
  const r = app.rodar(expr);
  assert.equal(r.definido, '9º A');
  assert.equal(r.removido, true);
});

test('labels de aprovação/recuperação/situação final', () => {
  assert.equal(app.rodar(`labelAprovacao('aprovado')`), '✅ Aprovado');
  assert.equal(app.rodar(`labelAprovacao('reprovado')`), '❌ Reprovado');
  assert.equal(app.rodar(`labelRecuperacao('rec1')`), '🟠 Recuperação (1º Semestre)');
  assert.equal(app.rodar(`labelRecuperacao('nenhuma')`), '⚪ Sem Recuperação');
  assert.equal(app.rodar(`labelSituacaoFinal('reprovado_freq')`), 'Reprovado por Frequência');
  assert.equal(app.rodar(`labelSituacaoFinal('inexistente')`), '—');
});

test('5º Conceito (calcularMediaFinal) usa somente notas válidas', () => {
  const expr = `
    (() => {
      const turma = { notas: { 1: { d1: { a1: 5 } }, 2: { d1: { a1: null } }, 3: {}, 4: {} } };
      return calcularMediaFinal(turma, 'd1', 'a1');
    })()
  `;
  // nota null não conta (count só incrementa com valor válido)
  assert.equal(app.rodar(expr), 5);
});
