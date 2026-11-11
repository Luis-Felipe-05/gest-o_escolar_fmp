'use strict';
// Suporte aos testes: carrega o código do sistema em um contexto isolado (vm)
// com um DOM/localStorage/fetch mínimos, para exercitar as funções puras sem
// depender de navegador.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

function criarElemento(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    attributes: {},
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    type: 'text',
    className: '',
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, forcar) {
        if (forcar === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); }
        else if (forcar) this._set.add(c); else this._set.delete(c);
      },
      contains(c) { return this._set.has(c); }
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    remove() {},
    insertBefore(c) { this.children.unshift(c); return c; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    focus() {},
    blur() {},
    click() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return criarContextoCanvas(); },
    toDataURL() { return ''; }
  };
  return el;
}

function criarContextoCanvas() {
  return {
    clearRect() {}, fillRect() {}, fillText() {},
    font: '', fillStyle: '', textAlign: '',
    measureText: () => ({ width: 0 })
  };
}

// Carrega os arquivos do sistema no contexto e devolve helpers.
// `arquivos`: lista de caminhos relativos à raiz do projeto.
// Se omitida, lê a ordem canônica dos módulos diretamente do index.html
// (fonte única de verdade da ordem de carga).
function arquivosDoApp() {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const encontrados = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
  if (!encontrados.length) throw new Error('Nenhum módulo js/ encontrado no index.html');
  return encontrados;
}

function carregarApp(arquivos) {
  const elementos = new Map();
  const store = new Map();

  const documentStub = {
    getElementById(id) { return elementos.has(id) ? elementos.get(id) : null; },
    createElement(tag) { return criarElemento(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    body: criarElemento('body'),
    documentElement: criarElemento('html')
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: documentStub,
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); }
    },
    fetch() { return Promise.reject(new Error('sem rede nos testes')); },
    alert() {},
    prompt() { return null; },
    confirm() { return false; },
    FileReader: class { readAsText() {} readAsArrayBuffer() {} },
    Blob: class { constructor() {} },
    URL: { createObjectURL() { return 'blob:teste'; }, revokeObjectURL() {} },
    navigator: { userAgent: 'node-testes' },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    DataView,
    location: { href: 'file:///teste/index.html' },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    requestAnimationFrame(cb) { return setTimeout(cb, 0); },
    performance: { now: () => Date.now() }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);

  for (const arquivo of arquivos) {
    const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(RAIZ, arquivo);
    const codigo = fs.readFileSync(caminho, 'utf8');
    vm.runInContext(codigo, ctx, { filename: caminho });
  }

  return {
    sandbox,
    // Executa uma expressão/fragmento dentro do contexto e devolve o valor.
    rodar(expressao) { return vm.runInContext(expressao, ctx); },
    // Cria/recupera um elemento de DOM registrado sob o id (para simular inputs).
    registrarEl(id, props) {
      const el = elementos.has(id) ? elementos.get(id) : criarElemento('div');
      if (props) Object.assign(el, props);
      elementos.set(id, el);
      return el;
    },
    obterEl(id) { return elementos.has(id) ? elementos.get(id) : null; },
    store
  };
}

module.exports = { carregarApp, criarElemento, arquivosDoApp };
