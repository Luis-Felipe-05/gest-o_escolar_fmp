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

const appJs = ler('app.js');
const indexHtml = ler('index.html');

// ---------- 1. Sintaxe ----------
{
  const r = spawnSync(process.execPath, ['--check', path.join(RAIZ, 'app.js')], { encoding: 'utf8' });
  if (r.status !== 0) falhar(`Sintaxe inválida em app.js:\n${r.stderr}`);
}

// ---------- 2. Sem handlers inline (permite CSP sem 'unsafe-inline') ----------
const reHandler = /\son(click|change|keypress|keydown|mouseover|mouseout|error|load|submit)=/i;
for (const [nome, texto] of [['index.html', indexHtml], ['app.js', appJs]]) {
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
  for (const [nome, texto] of [['app.js', appJs], ['index.html', indexHtml]]) {
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
  for (const [nome, texto] of [['index.html', indexHtml], ['app.js', appJs]]) {
    texto.split('\n').forEach((linha, i) => {
      const t = linha.trim();
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')) return; // comentário
      let d;
      reDataFn.lastIndex = 0;
      while ((d = reDataFn.exec(linha)) !== null) {
        if (!funcoes.has(d[1])) falhar(`${nome}:${i + 1}: data-fn="${d[1]}" não tem função correspondente em app.js`);
      }
    });
  }
}

// ---------- 6. Interpolações de value em input passam por esc() ----------
{
  const reValor = /value="\$\{([^}]*)\}"/g;
  let v;
  while ((v = reValor.exec(appJs)) !== null) {
    const expr = v[1].trim();
    if (!expr.includes('esc(')) falhar(`app.js: value="${'${'}${expr}}" sem esc()`);
  }
}

// ---------- 7. Sem catches vazios ----------
{
  const reCatch = /catch\s*\([^)]*\)\s*\{\s*\}/g;
  let c;
  while ((c = reCatch.exec(appJs)) !== null) {
    const linha = appJs.slice(0, c.index).split('\n').length;
    falhar(`app.js:${linha} catch vazio (erro engolido)`);
  }
}

// ---------- 8. Acesso restrito: trava de tentativas ----------
{
  if (!appJs.includes('travaAcessoRestrito')) falhar('Acesso restrito sem trava de tentativas (força bruta)');
  if (!appJs.includes('senhaCorreta(senha, SENHA_ACESSO_RESTRITO)')) {
    avisar('Acesso restrito não usa senhaCorreta() — senha ainda em texto no fonte (ver README)');
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
  for (const arquivo of ['index.html', 'app.js', 'styles.css', 'package.json', 'README.md', '.gitignore']) {
    if (!fs.existsSync(path.join(RAIZ, arquivo))) falhar(`Arquivo ausente: ${arquivo}`);
  }
  if (!fs.existsSync(path.join(RAIZ, 'test', 'regras.test.js'))) falhar('Testes de regras ausentes (test/regras.test.js)');
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
console.log('✅ Verificações OK (sintaxe, CSP, sem handlers inline, sem alert/prompt/confirm, data-fn válidos, catches, login em formulário).');
