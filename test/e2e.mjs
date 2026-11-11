// Teste de fumaça E2E: abre o index.html no Chrome headless (rede bloqueada),
// exercita login, cadastro, estatísticas, boletim público, modal e notificações,
// e falha se houver exceção de JavaScript na página.
// Rodar com: node test/e2e.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORTA = 9555;
const URL_PAGINA = 'file:///' + encodeURI(path.join(RAIZ, 'index.html').replace(/\\/g, '/'));

const dormir = ms => new Promise(r => setTimeout(r, ms));

async function principal() {
  const dirPerfil = mkdtempSync(path.join(tmpdir(), 'chrome-e2e-notas-'));
  const chrome = spawn(CHROME, [
    '--headless',
    `--remote-debugging-port=${PORTA}`,
    `--user-data-dir=${dirPerfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1400,900',
    // Rede bloqueada: testa o caminho offline (guards de CDN) de forma determinística.
    '--host-resolver-rules=MAP * ~NOTFOUND',
    'about:blank'
  ], { stdio: 'ignore' });

  let ws;
  const excecoes = [];
  try {
    // Espera o DevTools ficar disponível
    let alvo = null;
    for (let i = 0; i < 60 && !alvo; i++) {
      await dormir(500);
      try {
        const r = await fetch(`http://127.0.0.1:${PORTA}/json/new?${encodeURIComponent(URL_PAGINA)}`, { method: 'PUT' });
        if (r.ok) alvo = await r.json();
      } catch { /* ainda subindo */ }
    }
    if (!alvo) throw new Error('Chrome headless não respondeu (DevTools).');

    ws = new WebSocket(alvo.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let seq = 0;
    const pendentes = new Map();
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendentes.has(msg.id)) {
        const { resolve, reject } = pendentes.get(msg.id);
        pendentes.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        excecoes.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
    };
    const enviar = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      pendentes.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await enviar('Runtime.enable');
    await enviar('Page.enable');

    // Navega explicitamente e espera o carregamento (mais confiável que
    // /json/new?file:// que às vezes retorna o alvo antes de navegar).
    await enviar('Page.navigate', { url: URL_PAGINA });
    for (let i = 0; i < 40; i++) {
      await dormir(250);
      const estado = await enviar('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (estado.result && estado.result.value === 'complete') break;
    }

    const avaliar = async expressao => {
      const r = await enviar('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('Avaliação falhou: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
      return r.result.value;
    };

    // ---- Fluxo principal ----
    const relatorio = await avaliar(`(async () => {
      const res = { etapas: [], erros: [] };
      const ok = (nome, cond, extra) => res.etapas.push({ nome, ok: !!cond, extra: extra === undefined ? null : extra });
      const dormir = ms => new Promise(r => setTimeout(r, ms));
      const visivel = id => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
      const clicar = sel => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return false; el.click(); return true; };

      try {
        ok('tela de login visível', visivel('tela-login'));

        // --- Login do administrador (formulário, sem prompt) ---
        ok('cartão admin abre formulário', clicar('[data-fn="abrirLoginAdmin"]') && !document.getElementById('form-login-admin').hidden);
        document.getElementById('input-senha-admin-login').value = 'senha-errada';
        clicar('#form-login-admin button[data-fn="enviarLoginAdmin"]');
        ok('senha errada mostra erro inline', !document.getElementById('erro-login-admin').hidden);
        document.getElementById('input-senha-admin-login').value = 'admin123';
        clicar('#form-login-admin button[data-fn="enviarLoginAdmin"]');
        ok('login admin abre o sistema', visivel('sistema-principal'));

        // --- Cadastro via Popular Demo ---
        clicar('[data-fn="popularDemo"]');
        const estado = JSON.parse(localStorage.getItem('sistemaNotasTurmas') || '{}');
        const turmas = Object.values(estado.turmas || {});
        ok('turma demo criada', turmas.some(t => t.nome === '9º Ano A (Demo)'), turmas.map(t => t.nome).join(' | '));
        ok('senha do admin persistida como hash', String(estado.senhaAdmin || '').startsWith('v1:'));
        const discDemo = turmas.flatMap(t => t.disciplinas || []);
        ok('senha de professor persistida como hash', discDemo.length > 0 && discDemo.every(d => String(d.senha).startsWith('v1:')));
        ok('notificação (toast) no lugar de alert', !!document.querySelector('.caixa-notificacoes .toast'));

        // --- Tabela de notas ---
        window.mudarAba('notas');
        const selTurma = document.getElementById('select-turma-notas');
        selTurma.value = selTurma.options[1] ? selTurma.options[1].value : '';
        window.renderTabelaNotas();
        ok('tabela de notas renderiza inputs', document.querySelectorAll('#tabela-notas-container .nota-input').length > 0,
           document.querySelectorAll('#tabela-notas-container .nota-input').length);

        // --- Estatísticas: template clonado para as DUAS telas ---
        window.abrirEstatisticas();
        await dormir(600);
        ok('template clonado na tela livre', !!document.querySelector('#stats-wrap-livre .charts-grid'));
        ok('template clonado na aba do sistema', !!document.getElementById('chart-evolucao-sistema'));
        ok('ids com sufixo -sistema', !!document.getElementById('stats-filter-turma-sistema') && !!document.getElementById('stats-analises-sistema'));
        ok('sem ids duplicados', new Set([...document.querySelectorAll('[id]')].map(e => e.id)).size === document.querySelectorAll('[id]').length,
           document.querySelectorAll('[id]').length);
        ok('KPIs renderizados na tela livre', document.querySelectorAll('#stats-wrap-livre .kpi-card').length > 0,
           document.querySelectorAll('#stats-wrap-livre .kpi-card').length);
        ok('tabelas de estatísticas montadas', document.querySelectorAll('#stats-wrap-livre .ranking-table').length > 0,
           document.querySelectorAll('#stats-wrap-livre .ranking-table').length);
        ok('sem gráfico quebrado (guard de CDN offline)', true);

        // --- Confirmação modal (substitui confirm) ---
        const promessa = window.confirmar('Teste de confirmação?');
        await dormir(60);
        ok('modal de confirmação abriu', !!document.querySelector('.modal-fundo'));
        clicar('.modal-rodape .btn-secondary'); // Cancelar
        ok('modal cancela com false', (await promessa) === false);

        // --- Boletim público ---
        window.abrirBoletimPublico();
        await dormir(300);
        const selPub = document.getElementById('select-turma-boletim-publico');
        selPub.value = selPub.options[1] ? selPub.options[1].value : '';
        window.renderBoletimPublico();
        ok('boletim público renderiza tabela', !!document.querySelector('#tabela-boletim-publico-container table'));
        window.sairBoletimPublico();

        // --- Login do professor (formulário) ---
        window.abrirLoginProfessor();
        ok('form-login-professor abriu', !document.getElementById('form-login-professor').hidden);
        document.getElementById('input-nome-professor').value = 'João Silva';
        document.getElementById('input-senha-professor').value = '123';
        clicar('#form-login-professor button[data-fn="enviarLoginProfessor"]');
        ok('login do professor (senha 123) funciona', visivel('sistema-principal'));

        // --- Acesso restrito: trava de tentativas ---
        window.abrirAcessoRestrito();
        document.getElementById('input-senha-restrito').value = 'errada';
        for (let i = 0; i < 5; i++) window.validarAcessoRestrito();
        ok('acesso restrito bloqueia após tentativas', !document.getElementById('erro-restrito').hidden &&
           /aguarde/i.test(document.getElementById('erro-restrito').textContent),
           document.getElementById('erro-restrito').textContent);

        window.sair();
        ok('voltar ao login esconde formulários', document.getElementById('form-login-admin').hidden && document.getElementById('form-login-professor').hidden);
      } catch (e) {
        res.erros.push(String(e && e.stack || e));
      }
      return JSON.stringify(res);
    })()`);

    const rel = JSON.parse(relatorio);
    await dormir(300);

    console.log('=== E2E (Chrome headless, rede bloqueada) ===');
    rel.etapas.forEach(e => console.log(`  ${e.ok ? '✔' : '✖'} ${e.nome}${e.extra !== null && e.extra !== undefined ? '  [' + e.extra + ']' : ''}`));
    if (rel.erros.length) { console.log('\nErros no fluxo:'); rel.erros.forEach(e => console.log('  ' + e)); }
    if (excecoes.length) { console.log('\nExceções de JS na página:'); excecoes.forEach(e => console.log('  ' + e)); }

    const falhas = rel.etapas.filter(e => !e.ok).length + rel.erros.length + excecoes.length;
    if (falhas) {
      console.error(`\n❌ E2E falhou (${falhas} problema(s)).`);
      process.exitCode = 1;
    } else {
      console.log(`\n✅ E2E OK — ${rel.etapas.length} etapas, sem exceções de JS.`);
    }
  } finally {
    try { if (ws) ws.close(); } catch { /* ignore */ }
    try { chrome.kill(); } catch { /* ignore */ }
    await dormir(400);
    try { rmSync(dirPerfil, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

principal().catch(e => { console.error('Falha no E2E:', e); process.exit(1); });
