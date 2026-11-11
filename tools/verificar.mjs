// Verificações automáticas do projeto (lint sem dependências externas).
// Rodar com: npm run verificar
// Sai com código 1 se alguma verificação falhar.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const falhas = [];
const avisos = [];

function ler(rel) { return fs.readFileSync(path.join(RAIZ, rel), 'utf8'); }
function falhar(msg) { falhas.push(msg); }
function avisar(msg) { avisos.push(msg); }

// Ordem canônica de carga dos módulos (a mesma do index.html).
const ORDEM = [
  'config.js', 'nuvem.js', 'turmas.js', 'cadastro.js', 'notas.js',
  'acesso.js', 'boletim.js', 'classificacao.js', 'telas-publicas.js',
  'estatisticas.js', 'init.js'
];

const indexHtml = ler('index.html');
const modulos = ORDEM.map(nome => ({ nome: 'js/' + nome, texto: ler('js/' + nome) }));
// Código do sistema concatenado (para checagens globais).
const appJs = modulos.map(m => m.texto).join('\n');
// Todo o código + HTML (para varreduras de padrões).
const fontes = [...modulos, { nome: 'index.html', texto: indexHtml }];

// ---------- 1. Sintaxe de todos os módulos ----------
for (const { nome } of modulos) {
  const r = spawnSync(process.execPath, ['--check', path.join(RAIZ, nome)], { encoding: 'utf8' });
  if (r.status !== 0) falhar(`Sintaxe inválida em ${nome}:\n${r.stderr}`);
}

// ---------- 2. Sem handlers inline (permite CSP sem 'unsafe-inline') ----------
const reHandler = /\son(click|change|keypress|keydown|mouseover|mouseout|error|load|submit)=/i;
for (const { nome, texto } of fontes) {
  texto.split('\n').forEach((linha, i) => {
    const t = linha.trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')) return; // comentário
    if (reHandler.test(linha)) falhar(`${nome}:${i + 1} tem handler inline: ${t.slice(0, 120)}`);
  });
}

// ---------- 3. CSP sem 'unsafe-inline' em script-src ----------
{
  const m = indexHtml.match(/Content-Security-Policy" content="([^"]*)"/);
  if (!m) falhar('CSP ausente no index.html');
  else {
    const scriptSrc = (m[1].match(/script-src[^;]*/) || [''])[0];
    if (scriptSrc.includes("'unsafe-inline'")) falhar("CSP script-src contém 'unsafe-inline'");
    if (!scriptSrc.includes('cdnjs.cloudflare.com')) falhar('CSP script-src sem cdnjs (bibliotecas)');
  }
}

// ---------- 4. Sem alert()/prompt()/confirm() bloqueantes ----------
{
  const reCall = /(^|[^.\w])(alert|prompt|confirm)\(/;
  for (const { nome, texto } of fontes) {
    texto.split('\n').forEach((linha, i) => {
      const t = linha.trim();
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')) return;
      if (reCall.test(linha)) {
        const qual = /alert\(/.test(linha) ? 'alert' : /prompt\(/.test(linha) ? 'prompt' : 'confirm';
        falhar(`${nome}:${i + 1} usa ${qual}(): ${t.slice(0, 120)}`);
      }
    });
  }
}

// ---------- 5. Todo data-fn aponta para função existente ----------
{
  const funcoes = new Set();
  const reFuncao = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let f;
  while ((f = reFuncao.exec(appJs)) !== null) funcoes.add(f[1]);
  const reDataFn = /data-fn="([A-Za-z_$][\w$]*)"/g;
  for (const { nome, texto } of fontes) {
    texto.split('\n').forEach((linha, i) => {
      const t = linha.trim();
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')) return; // comentário
      let d;
      reDataFn.lastIndex = 0;
      while ((d = reDataFn.exec(linha)) !== null) {
        if (!funcoes.has(d[1])) falhar(`${nome}:${i + 1}: data-fn="${d[1]}" não tem função correspondente no código`);
      }
    });
  }
}

// ---------- 6. Interpolações de value em input passam por esc() ----------
{
  const reValor = /value="\$\{([^}]*)\}"/g;
  for (const { nome, texto } of modulos) {
    let v;
    reValor.lastIndex = 0;
    while ((v = reValor.exec(texto)) !== null) {
      const expr = v[1].trim();
      if (!expr.includes('esc(')) falhar(`${nome}: value="${'${'}${expr}}" sem esc()`);
    }
  }
}

// ---------- 7. Sem catches vazios ----------
{
  const reCatch = /catch\s*\([^)]*\)\s*\{\s*\}/g;
  for (const { nome, texto } of modulos) {
    let c;
    reCatch.lastIndex = 0;
    while ((c = reCatch.exec(texto)) !== null) {
      const linha = texto.slice(0, c.index).split('\n').length;
      falhar(`${nome}:${linha} catch vazio (erro engolido)`);
    }
  }
}

// ---------- 8. Acesso restrito: hash + trava de tentativas ----------
{
  if (!appJs.includes('travaAcessoRestrito')) falhar('Acesso restrito sem trava de tentativas (força bruta)');
  if (!appJs.includes('senhaCorreta(senha, SENHA_ACESSO_RESTRITO_HASH)')) {
    falhar('Acesso restrito não compara com SENHA_ACESSO_RESTRITO_HASH via senhaCorreta()');
  }
  if (/SENHA_ACESSO_RESTRITO\s*=/.test(appJs)) {
    falhar('Constante da senha do Acesso Restrito em TEXTO no fonte (deve ser hash v1:)');
  }
  const mHash = appJs.match(/SENHA_ACESSO_RESTRITO_HASH\s*=\s*'([^']+)'/);
  if (!mHash || !/^v1:[0-9a-f]{64}$/.test(mHash[1])) {
    falhar('SENHA_ACESSO_RESTRITO_HASH fora do formato v1:<sha256hex>');
  }
}

// ---------- 9. Login em formulário (sem prompt) ----------
{
  if (!appJs.includes('enviarLoginAdmin') || !appJs.includes('enviarLoginProfessor')) {
    falhar('Login do admin/professor não está em formulário (enviarLogin*/abrirLogin*)');
  }
}

// ---------- 10. Estrutura esperada ----------
{
  for (const arquivo of ['index.html', 'styles.css', 'package.json', 'README.md', '.gitignore']) {
    if (!fs.existsSync(path.join(RAIZ, arquivo))) falhar(`Arquivo ausente: ${arquivo}`);
  }
  if (!fs.existsSync(path.join(RAIZ, 'test', 'regras.test.js'))) falhar('Testes de regras ausentes (test/regras.test.js)');
  // O antigo monólito não deve voltar: o código vive apenas em js/.
  if (fs.existsSync(path.join(RAIZ, 'app.js'))) {
    falhar('app.js existe no projeto (o código deve viver apenas nos módulos js/)');
  }
}

// ---------- 11. Divisão em módulos (index.html ⇄ js/) ----------
{
  const carregados = [...indexHtml.matchAll(/<script src="(js\/[^"]+|app\.js)"><\/script>/g)].map(m => m[1]);
  const esperados = ORDEM.map(f => 'js/' + f);
  if (JSON.stringify(carregados) !== JSON.stringify(esperados)) {
    falhar(`Scripts do index.html fora da ordem canônica (esperado: ${esperados.join(', ')}; atual: ${carregados.join(', ') || 'nenhum'})`);
  }
  if (carregados.includes('app.js')) falhar('index.html ainda carrega app.js (deve carregar apenas js/*.js)');
}

// ---------- Resultado ----------
if (avisos.length) {
  console.log('Avisos:');
  avisos.forEach(a => console.log('  ⚠ ' + a));
}
if (falhas.length) {
  console.error(`\n${falhas.length} problema(s) encontrado(s):`);
  falhas.forEach(x => console.log('  ✖ ' + x));
  process.exit(1);
}
console.log(`✅ Verificações OK (sintaxe dos ${ORDEM.length} módulos, CSP, sem handlers inline, sem alert/prompt/confirm, data-fn válidos, esc em inputs, catches, senha do acesso restrito em hash, login em formulário, divisão coerente).`);
