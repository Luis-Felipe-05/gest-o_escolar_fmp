    // ====================== CONFIGURAÇÃO DE NUVEM (publique já pronto) ========
    // ► ANTES DE PUBLICAR NO GITHUB: cole abaixo a URL /exec do seu Apps Script.
    // Assim NINGUÉM precisa configurar nada no computador de cada pessoa:
    // qualquer um que abrir a página já busca e salva os dados na nuvem.
    // A CHAVE deve ser idêntica à CHAVE_SECRETA definida no script do Apps Script.
    const APPS_URL_PADRAO = 'https://script.google.com/macros/s/AKfycbwbuNegzGjZocLYOWNpvFQ368T-icGzK_4GOCDvirk_9D4k7fRoJ73rWBDraO5KTT6K/exec'; // ex.: https://script.google.com/macros/s/XXXX/exec
    const APPS_CHAVE_SECRETA = 'sn_CKmB5M38WP2zbeGTSOgfqcUYLJxakwrA';

    // Versão exigida do backend (Código.gs do Apps Script). Se o script publicado
    // for mais antigo, o site AVISA em vez de deixar as alterações sumirem em
    // silêncio. Atualize o script conforme APPS_SCRIPT_NUVEM.txt e publique uma
    // NOVA VERSÃO da implantação (DEPLOY → Gerenciar implantações → ✏ → + Nova versão).
    const SCRIPT_BACKEND = 2;
    const MSG_BACKEND_DESATUALIZADO = 'O Apps Script da nuvem está DESATUALIZADO: atualize o "Código.gs" com o código novo (APPS_SCRIPT_NUVEM.txt) e publique uma NOVA VERSÃO da implantação (DEPLOY → Gerenciar implantações → ✏ → + Nova versão → Implantar). Enquanto isso, turmas/disciplinas/alunos NÃO são gravados na planilha.';

    // ====================== SEGURANÇA ======================
    // Escapa caracteres especiais de HTML em valores digitados pelo usuário
    // (nomes de turmas, disciplinas, professores e alunos). Previne XSS armazenado:
    // sem isso, um nome como "<img onerror=...>" cadastrado por qualquer um seria
    // executado como código por todos que abrissem a página.
    function esc(valor) {
      return String(valor === null || valor === undefined ? '' : valor)
        .replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ---------- SENHAS (nunca em texto perto) ----------
    // SHA-256 síncrono (FIPS 180-4). Usado apenas para que senhas fiquem
    // guardadas/comparadas como hash (localStorage, nuvem e código-fonte),
    // nunca em texto puro. Não substitui HTTPS: é proteção local.
    function rotr32(x, n) { return (x >>> n) | (x << (32 - n)); }
    function sha256Hex(texto) {
      const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
      ]);
      const bytes = new TextEncoder().encode(String(texto));
      const bits = bytes.length * 8;
      const total = (((bytes.length + 8) >> 6) + 1) * 64;
      const padded = new Uint8Array(total);
      padded.set(bytes);
      padded[bytes.length] = 0x80;
      const view = new DataView(padded.buffer);
      view.setUint32(total - 4, bits >>> 0, false);
      view.setUint32(total - 8, Math.floor(bits / 0x100000000), false);
      let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
      let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
      const w = new Uint32Array(64);
      for (let i = 0; i < total; i += 64) {
        for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
        for (let t = 16; t < 64; t++) {
          const s0 = rotr32(w[t - 15], 7) ^ rotr32(w[t - 15], 18) ^ (w[t - 15] >>> 3);
          const s1 = rotr32(w[t - 2], 17) ^ rotr32(w[t - 2], 19) ^ (w[t - 2] >>> 10);
          w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let t = 0; t < 64; t++) {
          const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
          const ch = (e & f) ^ (~e & g);
          const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
          const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const temp2 = (S0 + maj) >>> 0;
          h = g; g = f; f = e; e = (d + temp1) >>> 0;
          d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
      }
      return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => x.toString(16).padStart(8, '0')).join('');
    }

    // Formato do hash de senha: 'v1:' + sha256hex. O prefixo permite migrar
    // dados antigos (plaintext) sem ambiguidade e é idempotente.
    function hashSenha(senha) { return 'v1:' + sha256Hex(String(senha)); }
    function ehHashSenha(valor) {
      return typeof valor === 'string' && valor.slice(0, 3) === 'v1:' && /^[0-9a-f]{64}$/.test(valor.slice(3));
    }
    // Comparação em tempo constante (evita timing attack trivial).
    function comparaTexto(a, b) {
      const x = String(a), y = String(b);
      let dif = x.length ^ y.length;
      const n = Math.max(x.length, y.length);
      for (let i = 0; i < n; i++) dif |= (x.charCodeAt(i % (x.length || 1)) || 0) ^ (y.charCodeAt(i % (y.length || 1)) || 0);
      return dif === 0;
    }
    // Compara a senha digitada com o valor salvo (hash v1: ou texto antigo
    // ainda não migrado). Regra de negócio inalterada: mesma senha = acesso.
    function senhaCorreta(senhaDigitada, valorSalvo) {
      if (valorSalvo === undefined || valorSalvo === null || valorSalvo === '') return false;
      if (ehHashSenha(valorSalvo)) return comparaTexto(hashSenha(senhaDigitada), valorSalvo);
      return comparaTexto(String(senhaDigitada), String(valorSalvo));
    }
    // Migra senhas em texto puro para hash (idempotente). Aplicado em todo
    // carregamento de dados: localStorage, nuvem e backup.
    function normalizarSegredos(alvo) {
      if (!alvo || typeof alvo !== 'object') return alvo;
      if (typeof alvo.senhaAdmin === 'string' && alvo.senhaAdmin && !ehHashSenha(alvo.senhaAdmin)) {
        alvo.senhaAdmin = hashSenha(alvo.senhaAdmin);
      }
      const turmas = (alvo.turmas && typeof alvo.turmas === 'object') ? alvo.turmas : {};
      Object.keys(turmas).forEach(tid => {
        const t = turmas[tid];
        if (!t || typeof t !== 'object') return;
        (Array.isArray(t.disciplinas) ? t.disciplinas : []).forEach(d => {
          if (d && typeof d.senha === 'string' && d.senha && !ehHashSenha(d.senha)) {
            d.senha = hashSenha(d.senha);
          }
        });
      });
      return alvo;
    }

    // ---------- SANITIZAÇÃO DE DADOS (evita dados corrompidos quebrarem a tela) ----------
    // Forma permissiva: mantém o que é válido, descarta só o que é impossível
    // (nota fora de 0–10, valor não numérico, estrutura errada). Não altera regra
    // de negócio — apenas garante que o estado seja utilizável.
    function sanitizarEstado(alvo) {
      if (!alvo || typeof alvo !== 'object' || Array.isArray(alvo)) return alvo;
      if (!alvo.turmas || typeof alvo.turmas !== 'object' || Array.isArray(alvo.turmas)) alvo.turmas = {};
      if (!BIMESTRES.includes(Number(alvo.bimestreAtual))) alvo.bimestreAtual = 1;
      const numEntre = (v, min, max) => {
        const n = Number(v);
        return (v !== '' && v !== null && v !== undefined && Number.isFinite(n) && n >= min && n <= max) ? n : null;
      };
      Object.keys(alvo.turmas).forEach(tid => {
        const t = alvo.turmas[tid];
        if (!t || typeof t !== 'object' || Array.isArray(t)) { delete alvo.turmas[tid]; return; }
        if (typeof t.nome !== 'string') t.nome = String(t.nome === undefined || t.nome === null ? '' : t.nome);
        if (!Array.isArray(t.disciplinas)) t.disciplinas = [];
        if (!Array.isArray(t.alunos)) t.alunos = [];
        t.disciplinas = t.disciplinas.filter(d => d && typeof d === 'object' && typeof d.id === 'string');
        t.alunos = t.alunos.filter(a => a && typeof a === 'object' && typeof a.id === 'string');
        if (!t.notas || typeof t.notas !== 'object') t.notas = {};
        BIMESTRES.forEach(b => {
          const porBim = t.notas[b];
          if (!porBim || typeof porBim !== 'object') { if (t.notas[b]) delete t.notas[b]; return; }
          Object.keys(porBim).forEach(did => {
            const porDisc = porBim[did];
            if (!porDisc || typeof porDisc !== 'object') { delete porBim[did]; return; }
            Object.keys(porDisc).forEach(aid => {
              const nota = numEntre(porDisc[aid], 0, 10);
              if (nota === null) delete porDisc[aid]; else porDisc[aid] = nota;
            });
          });
        });
        if (!t.frequencias || typeof t.frequencias !== 'object') t.frequencias = {};
        BIMESTRES.forEach(b => {
          const porBim = t.frequencias[b];
          if (!porBim || typeof porBim !== 'object') { if (t.frequencias[b]) delete t.frequencias[b]; return; }
          Object.keys(porBim).forEach(aid => {
            const pct = numEntre(porBim[aid], 0, 100);
            if (pct === null) delete porBim[aid]; else porBim[aid] = pct;
          });
        });
        ['conceitosFinais', 'situacoesFinais'].forEach(chave => {
          if (!t[chave] || typeof t[chave] !== 'object') t[chave] = {};
          Object.keys(t[chave]).forEach(aid => {
            const porAluno = t[chave][aid];
            if (!porAluno || typeof porAluno !== 'object') { delete t[chave][aid]; return; }
            Object.keys(porAluno).forEach(did => {
              if (chave === 'conceitosFinais') {
                const v = numEntre(porAluno[did], 0, 10);
                if (v === null) delete porAluno[did]; else porAluno[did] = v;
              } else if (typeof porAluno[did] !== 'string' || !OPCOES_SITUACAO_FINAL[porAluno[did]]) {
                delete porAluno[did];
              }
            });
          });
        });
      });
      return alvo;
    }

    // ---------- NOTIFICAÇÕES (substituem alert bloqueante) ----------
    let caixaNotificacoes = null;
    function notificar(mensagem, tipo) {
      try {
        if (!document.body) { console.log('[notificação]', mensagem); return; }
        if (!caixaNotificacoes || !caixaNotificacoes.parentNode) {
          caixaNotificacoes = document.createElement('div');
          caixaNotificacoes.id = 'caixa-notificacoes';
          caixaNotificacoes.className = 'caixa-notificacoes';
          caixaNotificacoes.setAttribute('aria-live', 'polite');
          document.body.appendChild(caixaNotificacoes);
        }
        const item = document.createElement('div');
        item.className = 'toast toast-' + (tipo || 'erro');
        item.setAttribute('role', 'status');
        item.textContent = String(mensagem);
        caixaNotificacoes.appendChild(item);
        const tempo = (tipo === 'sucesso' ? 4500 : 8000);
        setTimeout(function () {
          item.classList.add('saindo');
          setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 400);
        }, tempo);
        item.addEventListener('click', function () { if (item.parentNode) item.parentNode.removeChild(item); });
      } catch (e) {
        console.warn('Falha ao exibir notificação:', e);
      }
    }

    // ---------- CONFIRMAÇÃO MODAL (substitui confirm bloqueante) ----------
    function confirmar(mensagem) {
      return new Promise(function (resolve) {
        try {
          const fundo = document.createElement('div');
          fundo.className = 'modal-fundo';
          fundo.setAttribute('role', 'dialog');
          fundo.setAttribute('aria-modal', 'true');
          fundo.setAttribute('aria-label', 'Confirmação');
          const caixa = document.createElement('div');
          caixa.className = 'modal-caixa';
          const texto = document.createElement('p');
          texto.className = 'modal-texto';
          texto.textContent = String(mensagem);
          const rodape = document.createElement('div');
          rodape.className = 'modal-rodape';
          const btnNao = document.createElement('button');
          btnNao.type = 'button';
          btnNao.className = 'btn-secondary';
          btnNao.textContent = 'Cancelar';
          const btnSim = document.createElement('button');
          btnSim.type = 'button';
          btnSim.className = 'btn-danger';
          btnSim.textContent = 'Confirmar';
          rodape.appendChild(btnNao);
          rodape.appendChild(btnSim);
          caixa.appendChild(texto);
          caixa.appendChild(rodape);
          fundo.appendChild(caixa);
          document.body.appendChild(fundo);
          let resolvido = false;
          function fechar(resultado) {
            if (resolvido) return;
            resolvido = true;
            document.removeEventListener('keydown', aoTeclar, true);
            if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
            resolve(resultado);
          }
          function aoTeclar(e) {
            if (e.key === 'Escape') { e.preventDefault(); fechar(false); }
          }
          btnNao.addEventListener('click', function () { fechar(false); });
          btnSim.addEventListener('click', function () { fechar(true); });
          fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(false); });
          document.addEventListener('keydown', aoTeclar, true);
          btnNao.focus();
        } catch (e) {
          console.warn('Falha ao abrir confirmação:', e);
          resolve(false);
        }
      });
    }

    // ---------- TRAVAS DE TENTATIVA (evita força bruta nos logins) ----------
    function criarTravaTentativas() {
      let falhas = 0;
      let bloqueadoAte = 0;
      return {
        podeTentar: function () { return Date.now() >= bloqueadoAte; },
        restanteMs: function () { return Math.max(0, bloqueadoAte - Date.now()); },
        // Devolve true quando atingiu o limite e bloqueou por `ms`.
        registrarFalha: function (limite, ms) {
          falhas++;
          if (falhas >= limite) { falhas = 0; bloqueadoAte = Date.now() + ms; return true; }
          return false;
        },
        zerar: function () { falhas = 0; bloqueadoAte = 0; }
      };
    }

    // ---------- RENDER AGENDADO (debounce) ----------
    const timersRender = {};
    function agendarRender(chave, fn, ms) {
      if (timersRender[chave]) clearTimeout(timersRender[chave]);
      timersRender[chave] = setTimeout(function () { delete timersRender[chave]; fn(); }, ms || 200);
    }

    // ---------- EVENTOS SEM HANDLERS INLINE (CSP sem 'unsafe-inline') ----------
    // O HTML/geração usa data-fn="nomeDaFuncao" data-args='[...]' e, quando
    // preciso, data-ev="change|keydown" e data-key="Enter". Os argumentos são
    // JSON; tokens especiais: @el (o elemento), @value (valor), @event (evento).
    function interpretarArgs(texto) {
      try {
        const arr = JSON.parse(texto || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        console.warn('data-args inválido:', texto);
        return [];
      }
    }
    function despacharEvento(ev) {
      let alvo = ev && ev.target;
      while (alvo && alvo !== document.body) {
        if (alvo.getAttribute && alvo.getAttribute('data-fn')) {
          const tipo = alvo.getAttribute('data-ev') || 'click';
          let combina = (ev.type === tipo);
          if (!combina && ev.type === 'keydown' && tipo === 'click') {
            // Elementos não-nativos com role="button" respondem a Enter/Espaço.
            const tag = String(alvo.tagName || '').toUpperCase();
            const nativo = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
            if (!nativo && (ev.key === 'Enter' || ev.key === ' ')) {
              if (ev.key === ' ') ev.preventDefault();
              combina = true;
            }
          }
          if (combina) {
            if (tipo === 'keydown') {
              const tecla = alvo.getAttribute('data-key');
              if (tecla && ev.key !== tecla) return;
            }
            const nome = alvo.getAttribute('data-fn');
            const fn = typeof window[nome] === 'function' ? window[nome] : null;
            if (!fn) { console.warn('data-fn sem função correspondente:', nome); return; }
            const args = interpretarArgs(alvo.getAttribute('data-args')).map(a =>
              a === '@el' ? alvo : a === '@value' ? alvo.value : a === '@event' ? ev : a
            );
            fn.apply(window, args);
            return;
          }
        }
        alvo = alvo.parentElement || alvo.parentNode;
      }
    }

    // Monta a URL de uma chamada à nuvem (ação + chave secreta + anti-cache).
    function urlApps(acao) {
      return estado.appsUrl + '?acao=' + acao + '&chave=' + encodeURIComponent(APPS_CHAVE_SECRETA) + '&_=' + Date.now();
    }

    // ====================== ESTADO ======================
    const BIMESTRES = [1, 2, 3, 4];
    let estado = {
      bimestreAtual: 1,
      modoAdmin: false,
      senhaAdmin: 'admin123',
      appsUrl: APPS_URL_PADRAO,
      turmas: {}
      // turmaId: {
      //   nome: "9º Ano A",
      //   disciplinas: [{ id, nome, professor, senha }],
      //   alunos: [{ id, nome }],
      //   notas: { bimestre: { disciplinaId: { alunoId: nota } } },
      //   frequencias: { bimestre: { alunoId: freq } },        // 0–100 (porcentagem)
      //   situacoesFinais: { alunoId: { disciplinaId: situacao } }, // 'aprovado_nota_freq','reprovado_nota','reprovado_freq','aprovado_conselho'
      //   _logados: { disciplinaId: "nomeProfessor" }
      // }
    };
    // modoAdmin: usado pelo admin nas notas (já autenticado no login).
    // appsUrl: se preenchida, os dados são salvos/lidos no Google Sheets (Apps Script) em vez do localStorage.

    let salvandoNuvem = false;
    let filaSalvar = false;
    let filaFull = false;        // 'forcar' = substituir a nuvem inteira (restauração de backup)
    let filaDiff = false;        // houve mudança estrutural → envia como remendo (diff)
    let filaOps = [];
    let ultimoEstadoCarga = null;
    let estadoVersao = 0;
    let cargaInicialNuvem = null; // promessa da 1ª leitura da nuvem (trava o 1º salvamento)
    let conflitosSeguidos = 0;
    let backendOk = null;         // null = ainda não sabemos; false = Apps Script antigo
    let baseAntesDaCarga = null;  // ultimoEstadoCarga antes do fetch — base para calcular
                                  // os remendos locais sem misturar dados de quem salvou
                                  // enquanto a leitura estava em andamento

    function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); }

    // ---------- PERSISTÊNCIA LOCAL (fallback) ----------
    function salvarStorageLocal() {
      // Migra senhas para hash antes de persistir: nada em texto puro vai para
      // o localStorage (nem para a nuvem, que recebe o mesmo objeto).
      normalizarSegredos(estado);
      localStorage.setItem('sistemaNotasTurmas', JSON.stringify(estado));
    }
    function carregarStorageLocal() {
      const d = localStorage.getItem('sistemaNotasTurmas');
      if (d) {
        try { estado = JSON.parse(d); } catch (e) { console.warn('localStorage corrompido, reiniciando turmas:', e); estado.turmas = {}; }
        if (typeof estado.senhaAdmin !== 'string') estado.senhaAdmin = 'admin123';
        if (typeof estado.appsUrl !== 'string' || !estado.appsUrl) estado.appsUrl = APPS_URL_PADRAO;
        sanitizarEstado(estado);
        normalizarSegredos(estado);
      }
    }

    // ---------- ATALHO DE PERSISTÊNCIA (local OU nuvem) ----------
    // Ao chamar salvarStorage(), se houver URL configurada, sincroniza com a nuvem;
    // caso contrário, apenas salva localmente.
    function salvarStorage() {
      salvarStorageLocal();
      if (estado.appsUrl) agendarSalvarNuvem();
    }

    function carregarStorage() {
      carregarStorageLocal();
      sanitizarEstado(estado);
      normalizarSegredos(estado);
      if (!estado.appsUrl) estado.appsUrl = APPS_URL_PADRAO; // nuvem embutida no HTML
      estado.modoAdmin = false;
      // Dica de versão deixada por outra aba deste mesmo navegador: evita que o
      // 1º salvamento saia com versao=0 e volte "conflito" sem motivo. A leitura
      // da nuvem abaixo substitui pelo número real da planilha.
      const versaoLocal = Number(localStorage.getItem('sistemaNotasVersao'));
      if (Number.isFinite(versaoLocal) && versaoLocal > 0) estadoVersao = versaoLocal;
      const campoSenha = document.getElementById('input-senha-admin');
      // Nunca exibir a senha no campo: fica vazio e "em branco = mantém a atual".
      if (campoSenha) { campoSenha.value = ''; campoSenha.placeholder = 'Deixe em branco para manter a senha atual'; }
      const campoUrl = document.getElementById('input-apps-url');
      if (campoUrl) campoUrl.value = estado.appsUrl || '';
      if (estado.appsUrl) {
        // Tentar carregar os dados mais recentes da nuvem.
        // A promessa fica guardada: o 1º salvamento ESPERA esta leitura terminar
        // (sem isso, uma alteração feita antes da resposta terminar sairia com a
        // versão errada e apareceria "Conflito: outro usuário salvou dados mais recentes").
        // O `true` preserva o que o usuário já teria editado nesse meio-tempo.
        cargaInicialNuvem = carregarDaNuvem().then(function (d) { aplicarDadosNuvem(d, true); }).catch(function (e) { console.warn('Não foi possível carregar dados da nuvem na inicialização:', e); });
      }
    }

    function getTurma(turmaId) { return estado.turmas[turmaId]; }

    // Recarregar dados mais recentes (para garantir que alterações do admin
    // sejam visíveis ao professor e vice-versa, especialmente em abas/contexto diferentes).
    // Quando há nuvem configurada, a fonte de dados é a nuvem — não o cache local —
    // então mantém o estado atual em memória até a sincronização da nuvem atualizá-lo.
    function recarregarDados() {
      if (estado.appsUrl) return; // nuvem é a fonte de verdade; nada a reverter do navegador
      try {
        const d = localStorage.getItem('sistemaNotasTurmas');
        if (d) {
          const dadosLocais = JSON.parse(d);
          // Preserva o estado de sessão atual (modo admin, perfil, etc)
          const modoAdmin = estado.modoAdmin;
          const senhaAdmin = estado.senhaAdmin;
          const appsUrl = estado.appsUrl;

          estado = dadosLocais;
          // Restaurar estado de sessão
          estado.modoAdmin = modoAdmin;
          if (typeof estado.senhaAdmin !== 'string') estado.senhaAdmin = senhaAdmin || 'admin123';
          if (typeof estado.appsUrl !== 'string' || !estado.appsUrl) estado.appsUrl = appsUrl || '';
          if (!estado.turmas) estado.turmas = {};
          sanitizarEstado(estado);
          normalizarSegredos(estado);
        }
      } catch (e) {
        console.error('Erro ao recarregar dados:', e);
      }
    }
