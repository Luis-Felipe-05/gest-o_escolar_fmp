'use strict';
// Divi o app.js original (monolítico) em módulos lógicos por seção.
// Uso: node tools/dividir-app.js   (roda uma vez; depois o app.js é removido)
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const origem = path.join(RAIZ, 'app.js');
let codigo = fs.readFileSync(origem, 'utf8');
if (codigo.charCodeAt(0) === 0xFEFF) codigo = codigo.slice(1);

const linhas = codigo.split('\n');

// Ponto de corte: primeira linha que contém o marcador (índice 0-based).
function achar(marcador, desde = 0) {
  for (let i = desde; i < linhas.length; i++) {
    if (linhas[i].includes(marcador)) return i;
  }
  throw new Error('Marcador não encontrado: ' + marcador);
}

const marcas = [
  ['config.js', 'CONFIGURAÇÃO DE NUVEM (publique já pronto)', null],
  ['nuvem.js', '====================== NUVEM (GOOGLE SHEETS', 'CONFIGURAÇÃO DE NUVEM (publique já pronto)'],
  ['turmas.js', '====================== ABAS ======================', null],
  ['cadastro.js', '====================== MODO ADMIN DE NOTAS', null],
  ['notas.js', '====================== TABELA DE NOTAS', null],
  ['acesso.js', '====================== CONTROLE DE ACESSO', null],
  ['boletim.js', '====================== BOLETIM FINAL', null],
  ['classificacao.js', '====================== ESTATÍSTICAS ======================', null],
  ['telas-publicas.js', '====================== ACESSO RESTRITO', null],
  ['estatisticas.js', 'function destruirCharts(prefix)', null],
  ['init.js', '====================== INICIALIZAÇÃO', null]
];

// Calcula limites [inicio, fim) para cada arquivo, na ordem.
const cortes = marcas.map(([nome, marcador]) => achar(marcador));
cortes.push(linhas.length);

const dir = path.join(RAIZ, 'js');
fs.mkdirSync(dir, { recursive: true });

for (let i = 0; i < marcas.length; i++) {
  const [nome] = marcas[i];
  const inicio = cortes[i];
  const fim = cortes[i + 1];
  let trecho = linhas.slice(inicio, fim).join('\n');
  // Remove linhas em branco no início/fim, mantendo 1 linha final.
  trecho = trecho.replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
  fs.writeFileSync(path.join(dir, nome), trecho, 'utf8');
  console.log(`${nome.padEnd(20)} linhas ${String(inicio + 1).padStart(4)}–${String(fim).padStart(4)} (${fim - inicio} linhas)`);
}
console.log('\nOK. Agora atualize index.html para carregar js/*.js e rode os testes.');
