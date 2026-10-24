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
    function salvarStorageLocal() { localStorage.setItem('sistemaNotasTurmas', JSON.stringify(estado)); }
    function carregarStorageLocal() {
      const d = localStorage.getItem('sistemaNotasTurmas');
      if (d) {
        try { estado = JSON.parse(d); } catch (e) { estado.turmas = {}; }
        if (typeof estado.senhaAdmin !== 'string') estado.senhaAdmin = 'admin123';
        if (typeof estado.appsUrl !== 'string' || !estado.appsUrl) estado.appsUrl = APPS_URL_PADRAO;
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
      if (!estado.appsUrl) estado.appsUrl = APPS_URL_PADRAO; // nuvem embutida no HTML
      estado.modoAdmin = false;
      // Dica de versão deixada por outra aba deste mesmo navegador: evita que o
      // 1º salvamento saia com versao=0 e volte "conflito" sem motivo. A leitura
      // da nuvem abaixo substitui pelo número real da planilha.
      const versaoLocal = Number(localStorage.getItem('sistemaNotasVersao'));
      if (Number.isFinite(versaoLocal) && versaoLocal > 0) estadoVersao = versaoLocal;
      const campoSenha = document.getElementById('input-senha-admin');
      if (campoSenha) campoSenha.value = estado.senhaAdmin || 'admin123';
      const campoUrl = document.getElementById('input-apps-url');
      if (campoUrl) campoUrl.value = estado.appsUrl || '';
      if (estado.appsUrl) {
        // Tentar carregar os dados mais recentes da nuvem.
        // A promessa fica guardada: o 1º salvamento ESPERA esta leitura terminar
        // (sem isso, uma alteração feita antes da resposta terminar sairia com a
        // versão errada e apareceria "Conflito: outro usuário salvou dados mais recentes").
        // O `true` preserva o que o usuário já teria editado nesse meio-tempo.
        cargaInicialNuvem = carregarDaNuvem().then(function (d) { aplicarDadosNuvem(d, true); }).catch(function () { });
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
        }
      } catch (e) {
        console.error('Erro ao recarregar dados:', e);
      }
    }

    // ====================== NUVEM (GOOGLE SHEETS / APPS SCRIPT) ======================
    function salvarAppsUrl() {
      const url = document.getElementById('input-apps-url').value.trim();
      estado.appsUrl = url;
      salvarStorageLocal();
      if (url) {
        // `true`: alterações feitas enquanto a nuvem carrega não podem sumir
        carregarDaNuvem().then(function (d) { aplicarDadosNuvem(d, true); });
      }
      renderAppsStatus(url ? '✅ URL da nuvem configurada.' : 'ℹ️ Usando armazenamento local.');
    }

    function renderAppsStatus(msg, tipo) {
      const box = document.getElementById('apps-status-box');
      if (!box) return;
      const cor = tipo === 'erro' ? '#c62828' : (tipo === 'aviso' ? '#b26a00' : '#2e7d32');
      box.innerHTML = `<span style="color:${cor};">${esc(msg)}</span>`;
    }

    async function testarAppsUrl() {
      const box = document.getElementById('apps-status-box');
      if (!estado.appsUrl) { box.innerHTML = '<span style="color:#c62828;">Configure a URL primeiro.</span>'; return; }
      box.innerHTML = '<span style="color:#666;">Testando conexão…</span>';
      try {
        const res = await fetch(urlApps('ping'));
        const dados = await res.json();
        if (dados && dados.script === SCRIPT_BACKEND) {
          box.innerHTML = `<span style="color:#2e7d32;">✅ Conexão OK — resposta do servidor: ${esc(JSON.stringify(dados))}</span>`;
        } else {
          box.innerHTML = `<span style="color:#c62828;">⚠️ ${esc(MSG_BACKEND_DESATUALIZADO)} Resposta do servidor: ${esc(JSON.stringify(dados))}</span>`;
        }
      } catch (e) {
        box.innerHTML = `<span style="color:#c62828;">❌ Falha na conexão. Verifique a URL, o deploy (deve ser de "Acesso: qualquer pessoa") e a autorização. Erro: ${esc(e.message)}</span>`;
      }
    }

    // Guarda a versão também no localStorage: quando a página está aberta em mais
    // de uma aba, a aba que salva avisa as outras — assim elas não ficam com a
    // versão velha e não geram "conflito" a cada salvamento.
    function guardarVersaoLocal(v) {
      try { localStorage.setItem('sistemaNotasVersao', String(v)); } catch (e) { /* sem localStorage */ }
    }

    function agendarSalvarNuvem(forcar) {
      // forcar = restauração de backup (substitui a planilha inteira, ignora versão).
      // Caso comum (criar turma, aluno, disciplina, editar professor...): marcamos
      // filaDiff e o envio vira um REMENDO — somente o que mudou desde o último
      // estado confirmado pela nuvem — que é MESCLADO com o que outro usuário
      // salvou, em vez de dar conflito (e descartar a alteração, como acontecia).
      if (forcar) filaFull = 'forcar'; else filaDiff = true;
      filaSalvar = true;
      if (salvandoNuvem) return;
      // Debounce curto para agrupar alterações rápidas
      setTimeout(processarFilaSalvar, 400);
    }

    function agendarSalvarNuvemOps(op) {
      filaOps.push(op);
      filaSalvar = true;
      if (salvandoNuvem) return;
      setTimeout(processarFilaSalvar, 400);
    }

    // Persistência local + envio incremental (apenas a célula editada) para a nuvem.
    // Evita que a nota de um professor sobrescreva a de outro (salvamento por célula,
    // e não do estado inteiro).
    function persistirAlteracao(op) {
      salvarStorageLocal();
      if (op) agendarSalvarNuvemOps(op);
    }

    // ---------- REMENDOS (diff de estado) ----------
    // Compara o último estado confirmado pela nuvem (base) com o estado atual
    // (alvo) e devolve SÓ o que mudou. Cada remendo é um caminho completo:
    //   { op:'caminho', caminho:['turmas', id, 'nome'], valor: 'X' }  → define
    //   { op:'caminho', caminho:['turmas', id], remover: true }        → apaga
    // Objetos são percorridos campo a campo (é isso que permite MESCLAR: as turmas
    // que outro usuário criou não são tocadas). Arrays — alunos e disciplinas —
    // são trocados inteiros, o caminho nunca "entra" dentro do array.
    function computarRemendos(base, alvo) {
      const remendos = [];
      const ehObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);
      const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

      function percorrer(caminho, b, a) {
        if (igual(b, a)) return;
        if (ehObjeto(b) && ehObjeto(a)) {
          const chaves = {};
          Object.keys(b).forEach(k => { chaves[k] = true; });
          Object.keys(a).forEach(k => { chaves[k] = true; });
          Object.keys(chaves).forEach(k => {
            if (k === 'modoAdmin') return; // estado de sessão, não é dado da nuvem
            const temBase = Object.prototype.hasOwnProperty.call(b, k);
            const temAlvo = Object.prototype.hasOwnProperty.call(a, k);
            if (!temAlvo) remendos.push({ op: 'caminho', caminho: caminho.concat(k), remover: true });
            else if (!temBase || a[k] === undefined) remendos.push({ op: 'caminho', caminho: caminho.concat(k), valor: a[k] });
            else percorrer(caminho.concat(k), b[k], a[k]);
          });
        } else {
          remendos.push({ op: 'caminho', caminho: caminho.slice(), valor: a });
        }
      }
      percorrer([], base || {}, alvo || {});
      return remendos;
    }

    // Define ou apaga um caminho dentro de um objeto (mesma regra do servidor).
    function definirCaminho(obj, caminho, valor, remover) {
      if (!obj || typeof obj !== 'object' || !caminho || !caminho.length) return false;
      let alvo = obj;
      for (let i = 0; i < caminho.length - 1; i++) {
        const k = caminho[i];
        if (alvo === null || typeof alvo !== 'object' || Array.isArray(alvo)) return false;
        if (alvo[k] === null || typeof alvo[k] !== 'object' || Array.isArray(alvo[k])) {
          if (remover) return false; // não existe o que atravessar
          alvo[k] = {};
        }
        alvo = alvo[k];
      }
      const ultimo = caminho[caminho.length - 1];
      if (remover) {
        if (alvo && typeof alvo === 'object' && !Array.isArray(alvo)) delete alvo[ultimo];
      } else {
        alvo[ultimo] = valor;
      }
      if (!obj.turmas) obj.turmas = {};
      return true;
    }

    async function processarFilaSalvar() {
      if (salvandoNuvem || !estado.appsUrl) return;
      salvandoNuvem = true;
      try {
        // Espera a 1ª leitura da nuvem terminar (no máximo 10 s). Sem a versão
        // real da planilha, o envio sairia com versao=0 e voltaria "conflito"
        // sem que ninguém tivesse salvo nada por cima de você.
        if (cargaInicialNuvem) {
          const carga = cargaInicialNuvem;
          await Promise.race([carga, new Promise(function (r) { setTimeout(r, 10000); })]);
          if (cargaInicialNuvem === carga) cargaInicialNuvem = null;
        }

        while (filaSalvar || filaOps.length) {
          filaSalvar = false;

          const forcar = filaFull === 'forcar';
          if (filaFull) filaFull = false;

          // Mudança estrutural pendente → vira remendo (diff contra o último
          // estado confirmado). Assim ela entra na MESMA fila das notas e é
          // reaplicada por cima da versão nova em caso de conflito.
          if (filaDiff) {
            filaDiff = false;
            const remendos = computarRemendos(ultimoEstadoCarga, estado);
            if (remendos.length) filaOps = filaOps.concat(remendos);
          }

          const opsEnvio = filaOps.slice();
          if (!opsEnvio.length && !forcar) continue; // nada pendente

          const estadoEnvio = JSON.parse(JSON.stringify(estado));
          const payloadObj = forcar
            ? { acao: 'salvar', chave: APPS_CHAVE_SECRETA, versao: estadoVersao, dados: estadoEnvio, forcar: true }
            : { acao: 'salvar', chave: APPS_CHAVE_SECRETA, versao: estadoVersao, operacoes: opsEnvio };

          const res = await fetch(estado.appsUrl, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payloadObj)
          });
          const resp = await res.json();

          if (resp && resp.ok === true) {
            conflitosSeguidos = 0;
            if (resp.versao !== undefined) {
              estadoVersao = resp.versao;
              guardarVersaoLocal(resp.versao);
            }
            // Confirma na base APENAS o que foi enviado: alterações feitas durante
            // o envio continuam pendentes e saem na próxima rodada.
            if (forcar || !ultimoEstadoCarga) {
              ultimoEstadoCarga = estadoEnvio;
              filaOps.splice(0, filaOps.length);
            } else {
              aplicarOpsLocal(opsEnvio, ultimoEstadoCarga);
              filaOps.splice(0, opsEnvio.length);
            }
            if (resp.script === SCRIPT_BACKEND) {
              renderAppsStatus('✅ Salvo na nuvem.');
            } else {
              backendOk = false;
              renderAppsStatus('⚠️ ' + MSG_BACKEND_DESATUALIZADO, 'erro');
            }
            continue;
          }

          if (resp && resp.conflito) {
            conflitosSeguidos++;
            if (resp.versao !== undefined) {
              estadoVersao = resp.versao;
              guardarVersaoLocal(resp.versao);
            }
            // Guarda TUDO o que ainda não estava confirmado (inclui alterações
            // feitas durante o envio) antes de trocar o estado pela versão nova.
            const pendentes = filaOps.concat(computarRemendos(ultimoEstadoCarga, estado));
            filaDiff = false;
            if (resp.dados) {
              ultimoEstadoCarga = resp.dados;
              aplicarDadosNuvem(resp.dados);  // estado = versão mais recente da nuvem
              aplicarOpsLocal(pendentes);     // reaplica por cima: notas E estrutura
              salvarStorageLocal();
            }
            filaOps = pendentes;
            if (conflitosSeguidos >= 6) {
              renderAppsStatus('⚠️ Salvamento adiado: outra pessoa está gravando agora e vocês se alternaram 6 vezes. Suas alterações continuam pendentes — edite qualquer campo de novo para reenviar.', 'erro');
              break;
            }
            filaSalvar = true; // tenta de novo, agora com a versão correta
            renderAppsStatus('⚙️ Conflito resolvido: os dados mais recentes foram carregados e suas alterações foram reaplicadas e reenviadas automaticamente.', 'aviso');
            continue;
          }

          // Falha inesperada: mantém a fila pendente (reenvia na próxima alteração)
          // e PARA o laço, para não ficar batendo no servidor em loop.
          renderAppsStatus('⚠️ Falha ao salvar na nuvem: ' + ((resp && resp.mensagem) || 'resposta inesperada') + ' — suas alterações continuam pendentes e serão reenviadas na próxima edição.', 'erro');
          break;
        }
      } catch (e) {
        renderAppsStatus('⚠️ Não foi possível salvar na nuvem (offline?). ' + e.message + ' — suas alterações continuam pendentes e serão reenviadas na próxima edição.', 'erro');
      } finally {
        salvandoNuvem = false;
      }
    }

    // Reaplica localmente as operações pendentes (notas/conceitos/frequências
    // E remendos de estrutura) sobre o estado mais recente carregado da nuvem,
    // preservando o trabalho do usuário. `alvoEstado` permite reaplicar também
    // sobre a base local (ultimoEstadoCarga) para registrar o que a nuvem aceitou.
    function aplicarOpsLocal(operacoes, alvoEstado) {
      const alvo = alvoEstado || estado;
      operacoes.forEach(op => {
        if (!op || !op.op) return;
        if (op.op === 'caminho') {
          // Remendo de estrutura (criar/editar/apagar turma, disciplina, aluno...)
          definirCaminho(alvo, op.caminho, op.valor, !!op.remover);
          return;
        }
        const turma = alvo.turmas ? alvo.turmas[op.turmaId] : null;
        if (!turma) return; // a turma pode não existir na versão mais recente
        if (op.op === 'nota') {
          const notasBim = getNotasTurma(turma, op.bimestre);
          const discId = op.disciplinaId;
          const alunoId = op.alunoId;
          if (op.valor === null || op.valor === undefined || op.valor === '') {
            if (notasBim[discId]) delete notasBim[discId][alunoId];
          } else {
            if (!notasBim[discId]) notasBim[discId] = {};
            notasBim[discId][alunoId] = Number(op.valor);
          }
        } else if (op.op === 'conceito') {
          const alunoId = op.alunoId;
          const discId = op.disciplinaId;
          if (!turma.conceitosFinais) turma.conceitosFinais = {};
          if (!turma.conceitosFinais[alunoId]) turma.conceitosFinais[alunoId] = {};
          if (op.valor === null || op.valor === undefined || op.valor === '') {
            delete turma.conceitosFinais[alunoId][discId];
          } else {
            turma.conceitosFinais[alunoId][discId] = Number(op.valor);
          }
        } else if (op.op === 'frequencia') {
          const alunoId = op.alunoId;
          if (!turma.frequencias) turma.frequencias = {};
          if (!turma.frequencias[op.bimestre]) turma.frequencias[op.bimestre] = {};
          if (op.valor === null || op.valor === undefined || op.valor === '') {
            delete turma.frequencias[op.bimestre][alunoId];
          } else {
            turma.frequencias[op.bimestre][alunoId] = Number(op.valor);
          }
        } else if (op.op === 'situacao') {
          const alunoId = op.alunoId;
          const discId = op.disciplinaId;
          if (!turma.situacoesFinais) turma.situacoesFinais = {};
          if (!turma.situacoesFinais[alunoId]) turma.situacoesFinais[alunoId] = {};
          if (op.valor === null || op.valor === undefined || op.valor === '') {
            delete turma.situacoesFinais[alunoId][discId];
          } else {
            turma.situacoesFinais[alunoId][discId] = String(op.valor);
          }
        }
      });
    }

    async function carregarDaNuvem() {
      if (!estado.appsUrl) return null;
      // Guarda a base ANTES do fetch: carregarDaNuvem passa a atualizar
      // ultimoEstadoCarga com a resposta, e os remendos das alterações locais
      // precisam ser calculados contra a base ANTIGA (senão a diferença sairia
      // invertida e apagaria dados de quem salvou junto).
      baseAntesDaCarga = ultimoEstadoCarga;
      try {
        const res = await fetch(urlApps('carregar'));
        const resp = await res.json();
        if (resp && resp.ok === true) {
          // A versão é lida MESMO quando a planilha ainda está vazia: sem ela o
          // 1º salvamento sairia com versao=0 e voltaria "conflito" à toa.
          if (resp.versao !== undefined) {
            estadoVersao = resp.versao;
            guardarVersaoLocal(resp.versao);
          }
          backendOk = (resp.script === SCRIPT_BACKEND);
          if (resp.dados) {
            ultimoEstadoCarga = resp.dados;
            return resp.dados;
          }
          ultimoEstadoCarga = null;
          if (!backendOk) {
            renderAppsStatus('⚠️ ' + MSG_BACKEND_DESATUALIZADO, 'erro');
          } else {
            renderAppsStatus((resp && resp.mensagem) ? ('ℹ️ ' + resp.mensagem) : 'ℹ️ Nenhum dado na nuvem ainda.', 'aviso');
          }
          return null;
        }
        renderAppsStatus((resp && resp.mensagem) ? ('ℹ️ ' + resp.mensagem) : 'ℹ️ Nenhum dado na nuvem ainda.', 'erro');
        return null;
      } catch (e) {
        renderAppsStatus('⚠️ Falha ao carregar da nuvem. ' + e.message, 'erro');
        return null;
      }
    }

    // Re-renderiza apenas a aba que está visível (usado quando os dados chegam
    // da nuvem ou de outra aba do navegador).
    function renderAbaAtiva() {
      if (!perfilAtual) return;
      try {
        if (document.getElementById('aba-notas')?.classList.contains('active')) renderTabelaNotas();
        if (document.getElementById('aba-conceito')?.classList.contains('active')) renderConceitoFinal();
        if (document.getElementById('aba-frequencias')?.classList.contains('active')) renderFrequencias();
        if (document.getElementById('aba-boletim')?.classList.contains('active')) renderBoletimFinal();
        if (document.getElementById('aba-estatisticas')?.classList.contains('active')) renderEstatisticas('sistema');
        if (document.getElementById('aba-admin')?.classList.contains('active') && perfilAtual === 'admin') renderAdmin();
      } catch (e) {
        console.error('Erro ao re-renderizar aba ativa:', e);
      }
    }

    // `preservarLocais`: quando a leitura da nuvem termina DEPOIS de o usuário
    // já ter editado algo (primeiros segundos da página ou ao trocar a URL),
    // as alterações locais ainda não confirmadas não podem sumir ao trocar o
    // estado pelo servidor: entram na fila e são reaplicadas por cima.
    function aplicarDadosNuvem(dadosNuvem, preservarLocais) {
      if (!dadosNuvem || typeof dadosNuvem !== 'object') return;
      let pendentes = [];
      if (preservarLocais) {
        // Só dá para separar "o que o usuário mudou" quando existe uma base
        // confirmada; sem base, mantém ao menos as células digitadas (filaOps).
        if (filaDiff && baseAntesDaCarga) {
          const remendos = computarRemendos(baseAntesDaCarga, estado);
          if (remendos.length) filaOps = filaOps.concat(remendos);
          filaDiff = false;
        }
        pendentes = filaOps.slice();
        baseAntesDaCarga = null;
      }
      // Mantém preferências locais que não devem vir da nuvem
      const senhaAtual = estado.senhaAdmin;
      const appsUrlAtual = estado.appsUrl;
      estado = JSON.parse(JSON.stringify(dadosNuvem));
      estado.modoAdmin = false;
      estado.appsUrl = appsUrlAtual || estado.appsUrl || '';
      if (typeof estado.senhaAdmin !== 'string' || !estado.senhaAdmin) estado.senhaAdmin = senhaAtual;
      if (!estado.turmas) estado.turmas = {};
      if (pendentes.length) aplicarOpsLocal(pendentes, estado); // reaplica o que o usuário já tinha editado
      const campoSenha = document.getElementById('input-senha-admin');
      if (campoSenha) campoSenha.value = estado.senhaAdmin || 'admin123';
      const campoUrl = document.getElementById('input-apps-url');
      if (campoUrl) campoUrl.value = estado.appsUrl || '';
      renderAppsStatus(
        backendOk === false ? ('⚠️ ' + MSG_BACKEND_DESATUALIZADO) : '✅ Dados carregados da nuvem.',
        backendOk === false ? 'erro' : undefined
      );
      if (perfilAtual === 'publico') {
        // Atualizar tela de boletim público se estiver visível
        popularSelectTurmasBoletimPublico();
        renderBoletimPublico();
      } else if (perfilAtual) {
        renderAbaAtiva();
      } else {
        renderAdmin();
      }
    }

    // ====================== BACKUP E RESTAURAÇÃO (ABA ADMIN) ======================
    function renderBackupStatus(msg, tipo) {
      const box = document.getElementById('backup-status-box');
      if (!box) return;
      const cor = tipo === 'erro' ? '#c62828' : (tipo === 'aviso' ? '#b26a00' : '#2e7d32');
      box.innerHTML = `<span style="color:${cor};">${esc(msg)}</span>`;
    }

    // Gera um arquivo .json com todos os dados do sistema (turmas, disciplinas,
    // alunos, notas, frequências, conceitos e senha do admin).
    // IMPORTANTE: o backup é baixado DIRETO DA NUVEM (Google Sheets / Apps Script) —
    // o navegador é apenas o canal de download, nada é lido do localStorage.
    async function baixarBackup() {
      if (!estado.appsUrl) {
        renderBackupStatus('❌ Configure a URL do Apps Script (nuvem) antes de baixar o backup.', 'erro');
        return;
      }
      renderBackupStatus('⏳ Baixando os dados mais recentes da nuvem para gerar o backup…', 'aviso');
      const dadosNuvem = await carregarDaNuvem();
      if (!dadosNuvem || typeof dadosNuvem !== 'object' || !dadosNuvem.turmas || typeof dadosNuvem.turmas !== 'object') {
        renderBackupStatus('❌ Não há dados disponíveis na nuvem ainda. Faça uma alteração, aguarde a sincronização e tente novamente.', 'erro');
        return;
      }
      const dados = JSON.parse(JSON.stringify(dadosNuvem));
      dados.modoAdmin = false;
      const conteudo = JSON.stringify({
        aplicativo: 'sistema-notas-turmas',
        tipo: 'backup',
        versao: 1,
        geradoEm: new Date().toISOString(),
        origem: 'nuvem (Google Sheets / Apps Script)',
        dados: dados
      }, null, 2);
      const blob = new Blob([conteudo], { type: 'application/json' });
      const urlBlob = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dataArquivo = new Date().toISOString().slice(0, 10);
      link.href = urlBlob;
      link.download = 'backup-notas-' + dataArquivo + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(urlBlob); }, 1000);
      renderBackupStatus('✅ Backup gerado a partir da nuvem: ' + link.download +
        ' (' + Object.keys(dados.turmas).length + ' turma(s)). Guarde esse arquivo em local seguro.');
    }

    // Abre o seletor de arquivos para escolher um backup (.json) previamente baixado.
    function restaurarBackupArquivo() {
      const input = document.getElementById('input-backup-arquivo');
      if (input) input.click();
    }

    // Lê o arquivo escolhido, valida a estrutura e aplica o backup.
    function aplicarBackupArquivo(event) {
      const input = event && event.target;
      const arquivo = input && input.files && input.files[0];
      if (!arquivo) return;
      const leitor = new FileReader();
      leitor.onload = function (e) {
        let conteudo = null;
        try {
          conteudo = JSON.parse(e.target.result);
        } catch (err) {
          renderBackupStatus('❌ O arquivo selecionado não é um backup válido (JSON inválido).', 'erro');
          if (input) input.value = '';
          return;
        }
        // Aceita tanto o formato exportado ({ dados: {...} }) quanto o estado puro.
        const dadosBackup = (conteudo && conteudo.dados && typeof conteudo.dados === 'object')
          ? conteudo.dados
          : conteudo;
        const totalTurmasBackup = (dadosBackup && dadosBackup.turmas) ? Object.keys(dadosBackup.turmas).length : 'desconhecido';
        if (!confirm('Restaurar este backup?\n\nATENÇÃO: os dados atuais serão substituídos pelos do arquivo (e a nuvem será regravada com esses dados).\n\nTurmas no backup: ' + totalTurmasBackup)) {
          if (input) input.value = '';
          renderBackupStatus('ℹ️ Restauração cancelada. Nenhum dado foi alterado.', 'aviso');
          return;
        }
        aplicarEstadoBackup(dadosBackup, 'arquivo "' + arquivo.name + '"', true);
        if (input) input.value = '';
      };
      leitor.onerror = function () {
        renderBackupStatus('❌ Não foi possível ler o arquivo de backup.', 'erro');
        if (input) input.value = '';
      };
      leitor.readAsText(arquivo, 'UTF-8');
    }

    // Baixa os dados mais recentes da nuvem (Google Sheets) e os aplica localmente.
    function restaurarBackupNuvem() {
      if (!estado.appsUrl) {
        renderBackupStatus('❌ Configure a URL do Apps Script antes de restaurar da nuvem.', 'erro');
        return;
      }
      if (!confirm('Recarregar os dados da nuvem (Google Sheets)?\n\nA versão mais recente da nuvem substituirá o estado exibido agora.')) {
        renderBackupStatus('ℹ️ Recarga cancelada. Nenhum dado foi alterado.', 'aviso');
        return;
      }
      renderBackupStatus('⏳ Baixando dados da nuvem…', 'aviso');
      carregarDaNuvem().then(function (dadosNuvem) {
        if (!dadosNuvem) {
          renderBackupStatus('❌ Não há dados recuperáveis na nuvem (verifique a conexão e a URL).', 'erro');
          return;
        }
        aplicarEstadoBackup(dadosNuvem, 'nuvem', false);
      });
    }

    // Aplica um backup validado sobre o estado atual, preservando as preferências
    // locais (URL da nuvem e senha do admin) e re-renderizando tudo.
    // enviarNuvem: true = envia os dados de volta para a nuvem (restauração de arquivo);
    // false = os dados já vieram da nuvem, então não há reenvio.
    // O navegador NÃO grava nada em localStorage — a nuvem é a fonte de dados.
    function aplicarEstadoBackup(dadosBackup, origem, enviarNuvem) {
      if (!dadosBackup || typeof dadosBackup !== 'object' || !dadosBackup.turmas || typeof dadosBackup.turmas !== 'object' || Array.isArray(dadosBackup.turmas)) {
        renderBackupStatus('❌ Backup inválido: a estrutura de turmas não foi encontrada. Nada foi alterado.', 'erro');
        return false;
      }
      const senhaAtual = estado.senhaAdmin;
      const appsUrlAtual = estado.appsUrl;
      estado = JSON.parse(JSON.stringify(dadosBackup));
      estado.modoAdmin = false;
      estado.appsUrl = appsUrlAtual || estado.appsUrl || '';
      if (typeof estado.senhaAdmin !== 'string' || !estado.senhaAdmin) estado.senhaAdmin = senhaAtual;
      if (!estado.turmas) estado.turmas = {};
      if (!BIMESTRES.includes(Number(estado.bimestreAtual))) estado.bimestreAtual = 1;
      const campoSenha = document.getElementById('input-senha-admin');
      if (campoSenha) campoSenha.value = estado.senhaAdmin || 'admin123';
      const campoUrl = document.getElementById('input-apps-url');
      if (campoUrl) campoUrl.value = estado.appsUrl || '';
      sincronizarSelectBimestre();
      const selectBim = document.getElementById('select-bimestre-notas');
      if (selectBim) selectBim.value = String(estado.bimestreAtual);
      const totalTurmas = Object.keys(estado.turmas).length;
      if (enviarNuvem && estado.appsUrl) {
        // Envia o backup restaurado para a nuvem, SOBRESCRIVENDO-a por completo
        // (é a intenção de uma restauração, confirmada pelo usuário no diálogo).
        agendarSalvarNuvem(true);
        renderBackupStatus('✅ Backup restaurado com sucesso (' + origem + '): ' +
          totalTurmas + ' turma(s) recuperada(s) e enviadas para a nuvem.');
      } else if (enviarNuvem) {
        renderBackupStatus('⚠️ Backup restaurado (' + origem + '): ' + totalTurmas +
          ' turma(s), mas não há nuvem configurada para salvá-lo. Configure a URL do Apps Script.', 'aviso');
      } else {
        renderBackupStatus('✅ Dados recarregados da nuvem (' + totalTurmas + ' turma(s)).');
      }
      if (perfilAtual) {
        renderAbaAtiva();
      } else {
        renderAdmin();
      }
      return true;
    }

    // ====================== ABAS ======================
    function mudarAba(aba) {
      // Recarregar dados para garantir que alterações recentes (do admin ou professor)
      // sejam refletidas antes de renderizar a nova aba
      recarregarDados();

      document.querySelectorAll('.tab').forEach((t, i) => {
        const abaMap = perfilAtual === 'admin'
          ? ['admin', 'notas', 'frequencias', 'boletim', 'estatisticas']
          : ['notas', 'frequencias', 'boletim', 'conceito', 'estatisticas'];
        t.classList.toggle('active', abaMap[i] === aba);
      });
      document.getElementById('aba-admin').classList.toggle('active', aba === 'admin');
      document.getElementById('aba-boletim').classList.toggle('active', aba === 'boletim');
      document.getElementById('aba-notas').classList.toggle('active', aba === 'notas');
      document.getElementById('aba-conceito').classList.toggle('active', aba === 'conceito');
      const abaFreq = document.getElementById('aba-frequencias');
      if (abaFreq) abaFreq.classList.toggle('active', aba === 'frequencias');
      document.getElementById('aba-estatisticas').classList.toggle('active', aba === 'estatisticas');
      if (aba === 'admin' && perfilAtual === 'admin') renderAdmin();
      if (aba === 'frequencias') { popularSelectTurmasFrequencias(); renderFrequencias(); }
      if (aba === 'boletim') { popularSelectTurmasBoletim(); renderBoletimFinal(); }
      if (aba === 'notas') {
        // Ocultar box de admin de notas para professores
        const adminNotasBox = document.getElementById('admin-notas-box');
        if (adminNotasBox) {
          adminNotasBox.style.display = perfilAtual === 'admin' ? 'flex' : 'none';
        }
        // Admin já autenticado no login pode editar todas as notas
        if (perfilAtual === 'admin') {
          estado.modoAdmin = true;
        } else {
          estado.modoAdmin = false;
        }
        popularSelectTurmas();
        sincronizarSelectBimestre();
        renderTabelaNotas();
      }
      if (aba === 'conceito') { popularSelectTurmasConceito(); renderConceitoFinal(); }
      if (aba === 'estatisticas') renderEstatisticas('sistema');
    }

    function sincronizarSelectBimestre() {
      const select = document.getElementById('select-bimestre-notas');
      if (!select) return estado.bimestreAtual;
      if (select.options.length === 0) {
        BIMESTRES.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b;
          opt.textContent = `${b}º Bimestre`;
          select.appendChild(opt);
        });
        select.value = String(estado.bimestreAtual);
      }
      const val = parseInt(select.value, 10);
      if (!Number.isFinite(val) || val < 1 || val > 4) {
        select.value = String(estado.bimestreAtual);
        return estado.bimestreAtual;
      }
      return val;
    }

    // ====================== TURMAS ======================
    function criarTurma() {
      const nome = document.getElementById('input-turma').value.trim();
      if (!nome) { alert('Digite o nome da turma!'); return; }
      if (Object.values(estado.turmas).some(t => t.nome.toLowerCase() === nome.toLowerCase())) {
        alert('Já existe uma turma com esse nome!');
        return;
      }
      const id = genId();
      estado.turmas[id] = { nome, disciplinas: [], alunos: [], notas: {}, frequencias: {}, situacoesFinais: {}, conceitosFinais: {} };
      document.getElementById('input-turma').value = '';
      salvarStorage();
      renderAdmin();
    }

    function popularDemo() {
      if (Object.values(estado.turmas).some(t => t.nome === '9º Ano A (Demo)')) {
        alert('A turma demo já existe! Remova-a antes de popular novamente.');
        return;
      }
      const nomes = [
        'Ana Silva', 'Bruno Costa', 'Carla Oliveira', 'Daniel Santos', 'Eduarda Lima',
        'Felipe Souza', 'Gabriela Rocha', 'Henrique Alves', 'Isabela Cardoso', 'João Pedro',
        'Karina Martins', 'Lucas Pereira', 'Mariana Ferreira', 'Nicolas Ribeiro', 'Olivia Castro',
        'Pedro Henrique', 'Rafaela Gomes', 'Samuel Barbosa', 'Tatiana Moreira', 'Vinicius Dias'
      ];

      const disciplinas = [
        { id: genId(), nome: 'Matemática', professor: 'João Silva', senha: '123' },
        { id: genId(), nome: 'Português', professor: 'Maria Souza', senha: '123' },
        { id: genId(), nome: 'Ciências', professor: 'Pedro Almeida', senha: '123' },
        { id: genId(), nome: 'História', professor: 'Cláudia Reis', senha: '123' }
      ];

      // Perfis de alunos para gerar notas realistas com variedade de situações:
      //   'excelente'  → notas 8-10    → APROVADO
      //   'bom'        → notas 6-8     → APROVADO
      //   'medio'      → notas 5-7     → APROVADO (5º Conc ≥ 5)
      //   'rec1'       → Sem1 < 5, Sem2 ≥ 5, 5º Conc ≥ 5 → APROVADO (prevalece)
      //   'rec1grave'  → Sem1 < 5, Sem2 ≥ 5, 5º Conc < 5 → REPROVADO
      //   'rec2'       → Sem1 ≥ 5, Sem2 < 5, 5º Conc ≥ 5 → APROVADO
      //   'rec2grave'  → Sem1 ≥ 5, Sem2 < 5, 5º Conc < 5 → REPROVADO
      //   'parcial'    → só notas do 2º semestre → gera "Rec 1º Sem" ou "Sem Recuperação"
      //   'reprovado'  → todos os bimestres < 5 → REPROVADO
      //   'irregular'  → notas vazias em alguns bimestres
      const perfis = [
        'excelente', 'bom', 'medio', 'rec1', 'rec2', 'reprovado', 'parcial1',
        'excelente', 'bom', 'medio',
        'excelente', 'rec1grave', 'rec2grave', 'rec1', 'rec2',
        'excelente', 'bom', 'rec2', 'reprovado', 'parcial2'
      ];

      function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

      function gerarNotas(perfil, discIdx) {
        // Por disciplina, há pequenas variações (Ciências um pouco mais difícil, etc.)
        const offset = [-1, 0, 1, 0][discIdx] || 0;
        const clamp = (n) => Math.max(0, Math.min(10, n));

        const gerar = () => {
          if (perfil === 'excelente') return clamp(rand(8, 10) + offset);
          if (perfil === 'bom') return clamp(rand(6, 8) + offset);
          if (perfil === 'medio') return clamp(rand(5, 7) + offset);
          if (perfil === 'reprovado') return clamp(rand(0, 4) + offset);
          return null; // definido caso a caso
        };

        if (perfil === 'rec1') {
          // Sem1: 3-4, Sem2: 7-9 → média 5º Conc ≥ 5 (aprovado, prevalece)
          return [rand(3, 4) + offset, rand(3, 4) + offset, rand(7, 9) + offset, rand(7, 9) + offset].map(clamp);
        }
        if (perfil === 'rec1grave') {
          // Sem1: 1-3, Sem2: 5-6 → média 5º Conc ≈ 3.5 (reprovado, mas Sem1 claramente <5)
          return [rand(1, 3) + offset, rand(1, 3) + offset, rand(5, 6) + offset, rand(5, 6) + offset].map(clamp);
        }
        if (perfil === 'rec2') {
          return [rand(7, 9) + offset, rand(7, 9) + offset, rand(3, 4) + offset, rand(3, 4) + offset].map(clamp);
        }
        if (perfil === 'rec2grave') {
          return [rand(5, 6) + offset, rand(5, 6) + offset, rand(1, 3) + offset, rand(1, 3) + offset].map(clamp);
        }
        if (perfil === 'parcial1') {
          // Só notas do 1º semestre (b1, b2) com valor baixo
          // → Sem1 < 5, mas sem b3/b4 → 5º Conc não pode ser calculado → RECUPERAÇÃO 1º SEMESTRE
          return [rand(2, 4) + offset, rand(2, 4) + offset, undefined, undefined];
        }
        if (perfil === 'parcial2') {
          // Só notas do 2º semestre (b3, b4) com valor baixo
          // → Sem2 < 5, sem b1/b2 → 5º Conc não pode ser calculado → RECUPERAÇÃO 2º SEMESTRE
          return [undefined, undefined, rand(2, 4) + offset, rand(2, 4) + offset];
        }
        if (perfil === 'irregular') {
          // Falta 1 ou 2 bimestres aleatórios
          const r = [gerar(), gerar(), gerar(), gerar()];
          const falta = rand(0, 2);
          for (let i = 0; i < falta; i++) r[rand(0, 3)] = undefined;
          return r;
        }
        return [gerar(), gerar(), gerar(), gerar()];
      }

      const alunos = nomes.map((nome, i) => ({ id: genId(), nome }));
      const notas = { 1: {}, 2: {}, 3: {}, 4: {} };
      for (let b = 1; b <= 4; b++) notas[b] = {};
      disciplinas.forEach((disc, dIdx) => {
        alunos.forEach((aluno, aIdx) => {
          const perfil = perfis[aIdx];
          const vals = gerarNotas(perfil, dIdx);
          [1, 2, 3, 4].forEach((b, i) => {
            const v = vals[i];
            if (v === undefined || v === null) return;
            if (!notas[b][disc.id]) notas[b][disc.id] = {};
            notas[b][disc.id][aluno.id] = v;
          });
        });
      });

      const turmaId = genId();
      estado.turmas[turmaId] = {
        nome: '9º Ano A (Demo)',
        disciplinas,
        alunos,
        notas,
        frequencias: {},
        situacoesFinais: {},
        conceitosFinais: {},
        _logados: {}
      };

      salvarStorage();
      renderAdmin();
      alert('Turma demo criada com sucesso!\n\n• 20 alunos\n• 4 disciplinas\n• 4 bimestres com notas variadas\n\nAcesse "Estatísticas" ou "Boletim Final" para visualizar.');
    }

    // ===== Popular dados completos de exemplo (2 turmas) =====
    // Cria 2 turmas com professores, disciplinas, alunos, notas dos 4 bimestres,
    // frequências, 5º Conceito editado à mão e Situação Final — para visualizar as
    // Estatísticas, o Boletim e a aba Frequências de ponta a ponta.
    // NÃO substitui dados existentes: as turmas de exemplo levam o sufixo "(Exemplo)".
    function popularCompleto() {
      const jaExiste = Object.values(estado.turmas).some(t => /\(Exemplo\)$/.test(t.nome || ''));
      if (jaExiste) {
        alert('As turmas de exemplo já foram criadas!\n\nApague as turmas com o sufixo "(Exemplo)" na lista de turmas antes de popular de novo.');
        return;
      }

      // Notas determinísticas por perfil de desempenho (reprodutível, sem aleatoriedade):
      //   excelente/bom/medio/reprovado → situação óbvia
      //   rec1/rec2 → um semestre < 5 mas 5º Conceito ≥ 5 → aprovado com recuperação
      //   rec1grave/rec2grave → recuperação e 5º Conceito < 5 → reprovado
      //   parcial1/parcial2 → apenas um semestre lançado (média de semestre com 0)
      const notasPorPerfil = {
        excelente: [9, 8.5, 10, 9.5],
        bom: [7.5, 8, 6.5, 7],
        medio: [5.5, 6, 5, 6.5],
        rec1: [3.5, 4, 7.5, 8],
        rec2: [8, 7.5, 3.5, 4],
        reprovado: [3, 2.5, 4, 3.5],
        rec1grave: [2, 2.5, 5.5, 5],
        rec2grave: [6.5, 6, 2, 2.5],
        parcial1: [null, null, 8, 7.5],
        parcial2: [8, 7.5, null, null]
      };
      const clamp = n => (n === null || n === undefined ? null : Math.max(0, Math.min(10, n)));
      const freqBase = [100, 92, 87, 75, 68, 95, 80, 73, 100, 88, 62, 90, 77, 84, 58, 96, 70, 82, 91, 66];

      function criarTurmaExemplo(opts) {
        const alunos = opts.nomesAlunos.map(n => ({ id: genId(), nome: n }));
        const disciplinas = opts.disciplinas.map(d => ({ id: genId(), nome: d.nome, professor: d.professor, senha: '123' }));
        const notas = { 1: {}, 2: {}, 3: {}, 4: {} };
        const frequencias = { 1: {}, 2: {}, 3: {}, 4: {} };

        alunos.forEach((aluno, i) => {
          const base = notasPorPerfil[opts.perfis[i % opts.perfis.length]];
          disciplinas.forEach((disc, di) => {
            // Cada disciplina um pouco mais fácil/difícil que a anterior
            const offset = [-1, 0, 1, 0][di] || 0;
            [1, 2, 3, 4].forEach(b => {
              const v = base[b - 1];
              if (v === null || v === undefined) return;
              if (!notas[b][disc.id]) notas[b][disc.id] = {};
              notas[b][disc.id][aluno.id] = clamp(v + offset);
            });
          });
          // Frequência variada por aluno/bimestre (inclui 75% e valores abaixo do mínimo)
          [1, 2, 3, 4].forEach(b => {
            if (!frequencias[b]) frequencias[b] = {};
            frequencias[b][aluno.id] = freqBase[(i + b * 3) % freqBase.length];
          });
        });

        // 5º Conceito editado à mão (sobrepõe a média dos bimestres)
        const conceitosFinais = {};
        if (opts.conceitoEditado) {
          const a = alunos[opts.conceitoEditado.alunoIdx];
          const d = disciplinas[opts.conceitoEditado.discIdx];
          conceitosFinais[a.id] = {};
          conceitosFinais[a.id][d.id] = opts.conceitoEditado.valor;
        }

        // Situação Final definida manualmente (coluna do Boletim)
        const situacoesFinais = {};
        (opts.situacoes || []).forEach(s => {
          const a = alunos[s.alunoIdx];
          const d = disciplinas[s.discIdx];
          if (!situacoesFinais[a.id]) situacoesFinais[a.id] = {};
          situacoesFinais[a.id][d.id] = s.situacao;
        });

        estado.turmas[genId()] = {
          nome: opts.nome, disciplinas, alunos, notas,
          frequencias, situacoesFinais, conceitosFinais, _logados: {}
        };
      }

      // ----- Turma 1: João Silve dá 2 disciplinas aqui -----
      criarTurmaExemplo({
        nome: '9º Ano A (Exemplo)',
        nomesAlunos: [
          'Ana Beatriz Souza', 'Bruno Carvalho', 'Camila Duarte', 'Diego Fontes', 'Eduarda Muniz',
          'Felipe Antunes', 'Gabriela Pires', 'Henrique Vidal', 'Isabela Nogueira', 'João Marcos',
          'Karina Bueno', 'Lucas Tavares', 'Mariana Rezende', 'Nicolas Freitas', 'Olívia Camargo',
          'Priscila Andrade', 'Rafael Bandeira', 'Sabrina Queiroz', 'Thiago Marinho', 'Vitória Lacerda'
        ],
        disciplinas: [
          { nome: 'Matemática', professor: 'João Silve' },
          { nome: 'História', professor: 'João Silve' },
          { nome: 'Português', professor: 'Maria Lima' },
          { nome: 'Ciências', professor: 'Carlos Prado' }
        ],
        perfis: ['excelente', 'bom', 'medio', 'rec1', 'rec2', 'reprovado', 'parcial1', 'excelente', 'bom', 'rec1grave',
          'excelente', 'rec2grave', 'rec1', 'rec2', 'medio', 'bom', 'excelente', 'reprovado', 'parcial2', 'medio'],
        conceitoEditado: { alunoIdx: 1, discIdx: 0, valor: 6.5 },
        situacoes: [
          { alunoIdx: 0, discIdx: 0, situacao: 'aprovado_conselho' },
          { alunoIdx: 3, discIdx: 2, situacao: 'aprovado_nota_freq' },
          { alunoIdx: 5, discIdx: 1, situacao: 'reprovado_nota' },
          { alunoIdx: 9, discIdx: 3, situacao: 'reprovado_freq' }
        ]
      });

      // ----- Turma 2: João Silve e Maria Lima também dão aula aqui -----
      criarTurmaExemplo({
        nome: '8º Ano B (Exemplo)',
        nomesAlunos: [
          'Alice Fontenele', 'Bernardo Sá', 'Cecília Dantas', 'Davi Peçanha', 'Elisa Guimarães',
          'Fábio Junqueira', 'Helena Vasques', 'Igor Sampaio', 'Júlia Kobayashi', 'Kauã Meireles',
          'Lorena Fayad', 'Murilo Estrela', 'Natália Xavier', 'Otávio Bittencourt', 'Sophia Aragão'
        ],
        disciplinas: [
          { nome: 'Matemática', professor: 'João Silve' },
          { nome: 'Português', professor: 'Maria Lima' },
          { nome: 'Inglês', professor: 'Ana Castro' }
        ],
        perfis: ['bom', 'medio', 'rec1', 'excelente', 'reprovado', 'rec2', 'medio', 'bom', 'rec1grave', 'excelente',
          'medio', 'rec2', 'parcial1', 'bom', 'reprovado'],
        conceitoEditado: { alunoIdx: 2, discIdx: 1, valor: 4.5 },
        situacoes: [
          { alunoIdx: 1, discIdx: 1, situacao: 'aprovado_conselho' },
          { alunoIdx: 6, discIdx: 0, situacao: 'reprovado_nota' }
        ]
      });

      estado.bimestreAtual = 4;
      salvarStorage();
      renderAdmin();
      alert('✅ Turmas de exemplo criadas!\n\n' +
        '📚 9º Ano A (Exemplo) — 20 alunos\n' +
        '   Matemática e História → João Silve | Português → Maria Lima | Ciências → Carlos Prado\n' +
        '📚 8º Ano B (Exemplo) — 15 alunos\n' +
        '   Matemática → João Silve | Português → Maria Lima | Inglês → Ana Castro\n\n' +
        '✓ Notas dos 4 bimestres (aprovados, alunos em recuperação e reprovados)\n' +
        '✓ Frequência de todos os alunos nos 4 bimestres\n' +
        '✓ 5º Conceito editado à mão em 2 casos\n' +
        '✓ Situação Final manual em 6 casos\n\n' +
        '🧪 Teste como professor: entre com o nome "João Silve" e senha "123" — ele dá aula nas 2 turmas.\n' +
        '📊 Veja tudo em Estatísticas, Boletim Final e Frequências.\n' +
        'Para remover: apague as turmas com "(Exemplo)" na lista de turmas.');
    }

    function getNotasTurma(turma, bimestre) {
      if (!turma.notas) turma.notas = {};
      if (!turma.notas[bimestre]) turma.notas[bimestre] = {};
      return turma.notas[bimestre];
    }

    // ====================== MODO ADMIN DE NOTAS ======================
    function salvarSenhaAdmin() {
      const novaSenha = document.getElementById('input-senha-admin').value.trim();
      if (!novaSenha) { alert('A senha não pode ser vazia!'); return; }
      estado.senhaAdmin = novaSenha;
      salvarStorage();
      alert('Senha do administrador atualizada com sucesso!');
    }

    function removerTurma(turmaId) {
      const turma = getTurma(turmaId);
      if (!confirm(`Remover a turma "${turma.nome}" e todo seu conteúdo?`)) return;
      delete estado.turmas[turmaId];
      salvarStorage();
      renderAdmin();
    }

    function editarTurmaForm(turmaId) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      const box = document.getElementById(`edit-turma-${turmaId}`);
      if (box) {
        box.innerHTML = `
      <div class="form-row" style="align-items:center; background:#fff3cd; padding:10px; border-radius:6px; margin-top:10px;">
        <div class="form-field" style="flex:1; min-width:250px;">
          <label>Nome da Turma</label>
          <input type="text" id="ed-turma-${turmaId}" value="${esc(turma.nome)}">
        </div>
        <button class="btn-success btn-sm" onclick="salvarTurmaEdit('${turmaId}')">Salvar</button>
        <button class="btn-danger btn-sm" onclick="renderAdmin()">Cancelar</button>
      </div>
    `;
        document.getElementById(`ed-turma-${turmaId}`).focus();
      }
    }

    function salvarTurmaEdit(turmaId) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      const nome = document.getElementById(`ed-turma-${turmaId}`).value.trim();
      if (!nome) { alert('Digite o nome da turma!'); return; }
      if (Object.entries(estado.turmas).some(([id, t]) => id !== turmaId && t.nome.toLowerCase() === nome.toLowerCase())) {
        alert('Já existe uma turma com esse nome!');
        return;
      }
      turma.nome = nome;
      salvarStorage();
      renderAdmin();
      alert('Turma atualizada com sucesso!');
    }

    // ====================== DISCIPLINAS ======================
    function adicionarDisciplina(turmaId) {
      const turma = getTurma(turmaId);
      const profInput = document.getElementById(`prof-${turmaId}`);
      const senhaInput = document.getElementById(`senha-${turmaId}`);

      const prof = profInput.value.trim();
      const senha = senhaInput.value.trim();

      if (!prof) { alert('Digite o nome do professor!'); return; }
      if (!senha) { alert('Digite a senha do professor!'); return; }

      const discInputs = document.querySelectorAll(`#lista-disc-inputs-${turmaId} .disc-input`);
      const nomesDisc = [];
      discInputs.forEach(input => {
        const v = input.value.trim();
        if (v) nomesDisc.push(v);
      });

      if (nomesDisc.length === 0) { alert('Adicione pelo menos uma disciplina!'); return; }

      let adicionadas = 0;
      let duplicadas = [];
      nomesDisc.forEach(nome => {
        if (turma.disciplinas.some(d => d.nome.toLowerCase() === nome.toLowerCase())) {
          duplicadas.push(nome);
          return;
        }
        turma.disciplinas.push({ id: genId(), nome, professor: prof, senha });
        adicionadas++;
      });

      if (adicionadas > 0) {
        profInput.value = ''; senhaInput.value = '';
        // Limpar inputs de disciplina
        const lista = document.getElementById(`lista-disc-inputs-${turmaId}`);
        lista.innerHTML = `
      <div class="form-row disc-input-row" style="margin-top:8px;">
        <div class="form-field" style="flex:1; min-width:200px;">
          <input type="text" class="disc-input" placeholder="Ex: Matemática">
        </div>
        <button type="button" class="btn-danger btn-sm" onclick="removerDiscInput(this)">−</button>
      </div>
    `;
        salvarStorage();
        renderAdmin();
      }

      let msg = '';
      if (adicionadas > 0) msg += `✅ ${adicionadas} disciplina(s) cadastrada(s) para o professor "${prof}".\n`;
      if (duplicadas.length > 0) msg += `⚠️ Já existiam: ${duplicadas.join(', ')}`;
      if (msg) alert(msg);
    }

    function adicionarDiscInput(turmaId) {
      const lista = document.getElementById(`lista-disc-inputs-${turmaId}`);
      const novaRow = document.createElement('div');
      novaRow.className = 'form-row disc-input-row';
      novaRow.style.marginTop = '8px';
      novaRow.innerHTML = `
    <div class="form-field" style="flex:1; min-width:200px;">
      <input type="text" class="disc-input" placeholder="Outra disciplina">
    </div>
    <button type="button" class="btn-danger btn-sm" onclick="removerDiscInput(this)">−</button>
  `;
      lista.appendChild(novaRow);
      novaRow.querySelector('.disc-input').focus();
    }

    function removerDiscInput(btn) {
      const row = btn.closest('.disc-input-row');
      const lista = row.parentElement;
      // Manter pelo menos 1 input
      if (lista.querySelectorAll('.disc-input-row').length > 1) {
        row.remove();
      } else {
        row.querySelector('.disc-input').value = '';
        row.querySelector('.disc-input').focus();
      }
    }

    function toggleSenhaVis(inputId, btn) {
      const input = document.getElementById(inputId);
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁';
      }
    }

    function removerDisciplina(turmaId, discId) {
      const turma = getTurma(turmaId);
      if (!confirm('Remover disciplina e suas notas?')) return;
      turma.disciplinas = turma.disciplinas.filter(d => d.id !== discId);
      for (const bim in turma.notas) {
        delete turma.notas[bim][discId];
      }
      salvarStorage();
      renderAdmin();
    }

    function editarProfessorForm(turmaId, grupoId) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      const box = document.getElementById(`edit-prof-${grupoId}-${turmaId}`);
      if (!box) return;

      // Buscar todas as disciplinas deste grupo pelo nome do professor no box
      const profNome = box.closest('tr').previousElementSibling ? null : null;
      // Precisamos identificar o professor pelo ID do grupo
      // Vamos guardar o nome do professor em um dataset
      // Para simplificar, vamos ler o nome do professor da linha correspondente
      const row = box.closest('tr').previousElementSibling;
      const profCell = row ? row.querySelector('td:nth-child(2) strong') : null;
      if (!profCell) return;
      const profAntigo = profCell.textContent.trim();

      // Filtrar disciplinas deste professor (case-insensitive)
      const discsDoProf = turma.disciplinas.filter(d => d.professor.toLowerCase() === profAntigo.toLowerCase());
      if (discsDoProf.length === 0) return;
      const senhaAtual = discsDoProf[0].senha;
      const idsDiscs = discsDoProf.map(d => d.id);

      box.innerHTML = `
    <div style="background:#fff3cd; padding:15px; border-radius:6px; margin:5px 0;">
      <div class="form-row">
        <div class="form-field" style="flex:1; min-width:200px;">
          <label>Nome do Professor</label>
          <input type="text" id="ed-prof-nome-${grupoId}" value="${profAntigo}">
        </div>
        <div class="form-field" style="flex:1; min-width:200px;">
          <label>Senha do Professor</label>
          <div class="senha-vis">
            <input type="text" id="ed-prof-senha-${grupoId}" value="${esc(senhaAtual)}">
          </div>
        </div>
      </div>
      <div style="margin-top:10px;">
        <label style="font-size:12px; font-weight:700; color:#555; text-transform:uppercase; letter-spacing:0.5px;">Disciplinas deste professor:</label>
        <div id="ed-lista-disc-${grupoId}">
          ${discsDoProf.map(d => `
            <div class="form-row disc-edit-row" style="margin-top:8px;" data-disc-id="${d.id}">
              <div class="form-field" style="flex:1; min-width:200px;">
                <input type="text" class="ed-disc-input" value="${esc(d.nome)}">
              </div>
              <button type="button" class="btn-danger btn-sm" onclick="removerDiscEdit(this)">−</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="btn-primary btn-sm" style="margin-top:8px;" onclick="adicionarDiscEdit('${grupoId}')">+ Adicionar outra disciplina</button>
      </div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn-success btn-sm" onclick="salvarProfessorEdit('${turmaId}', '${grupoId}', '${idsDiscs.join(',')}')">Salvar Tudo</button>
        <button class="btn-danger btn-sm" onclick="renderAdmin()">Cancelar</button>
      </div>
    </div>
  `;
    }

    function adicionarDiscEdit(grupoId) {
      const lista = document.getElementById(`ed-lista-disc-${grupoId}`);
      const novaRow = document.createElement('div');
      novaRow.className = 'form-row disc-edit-row';
      novaRow.style.marginTop = '8px';
      novaRow.innerHTML = `
    <div class="form-field" style="flex:1; min-width:200px;">
      <input type="text" class="ed-disc-input" placeholder="Nova disciplina">
    </div>
    <button type="button" class="btn-danger btn-sm" onclick="removerDiscEdit(this)">−</button>
  `;
      lista.appendChild(novaRow);
      novaRow.querySelector('.ed-disc-input').focus();
    }

    function removerDiscEdit(btn) {
      const row = btn.closest('.disc-edit-row');
      const lista = row.parentElement;
      // Verificar se é uma disciplina existente (tem data-disc-id) ou nova
      const isExisting = row.hasAttribute('data-disc-id');
      const existingCount = lista.querySelectorAll('.disc-edit-row[data-disc-id]').length;

      if (isExisting && existingCount <= 1) {
        alert('O professor precisa ter pelo menos 1 disciplina! Se quiser remover todas, remova o professor (excluindo cada disciplina).');
        return;
      }
      if (lista.querySelectorAll('.disc-edit-row').length <= 1) {
        alert('O professor precisa ter pelo menos 1 disciplina!');
        return;
      }
      // Se for uma disciplina existente, marcar para remoção (não deletar do DOM ainda)
      if (isExisting) {
        row.style.display = 'none';
        row.setAttribute('data-remover', 'true');
      } else {
        row.remove();
      }
    }

    function salvarProfessorEdit(turmaId, grupoId, idsDiscsStr) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      const idsDiscs = idsDiscsStr.split(',').filter(s => s);

      const novoNome = document.getElementById(`ed-prof-nome-${grupoId}`).value.trim();
      const novaSenha = document.getElementById(`ed-prof-senha-${grupoId}`).value.trim();

      if (!novoNome) { alert('Digite o nome do professor!'); return; }
      if (!novaSenha) { alert('Digite a senha do professor!'); return; }

      const lista = document.getElementById(`ed-lista-disc-${grupoId}`);
      const rows = lista.querySelectorAll('.disc-edit-row');

      // Coletar novos nomes de disciplinas (excluindo as marcadas para remoção)
      const novosNomes = [];
      const removidos = [];
      rows.forEach(row => {
        if (row.getAttribute('data-remover') === 'true') {
          removidos.push(row.getAttribute('data-disc-id'));
          return;
        }
        const input = row.querySelector('.ed-disc-input');
        const v = input ? input.value.trim() : '';
        if (v) novosNomes.push(v);
      });

      if (novosNomes.length === 0) {
        alert('O professor precisa ter pelo menos 1 disciplina ativa!');
        return;
      }

      // Verificar duplicatas
      const duplicatas = [];
      novosNomes.forEach(n => {
        if (turma.disciplinas.some(d => !idsDiscs.includes(d.id) && d.nome.toLowerCase() === n.toLowerCase())) {
          duplicatas.push(n);
        }
      });
      if (duplicatas.length > 0) {
        alert(`Já existem estas disciplinas na turma: ${duplicatas.join(', ')}`);
        return;
      }

      // Atualizar nome e senha em todas as disciplinas do professor
      idsDiscs.forEach(id => {
        const d = turma.disciplinas.find(x => x.id === id);
        if (d) {
          d.professor = novoNome;
          d.senha = novaSenha;
        }
      });

      // Atualizar nomes das disciplinas existentes (manter IDs, só mudar nome)
      // E criar novas disciplinas com mesmo professor/senha
      let idx = 0;
      rows.forEach(row => {
        if (row.getAttribute('data-remover') === 'true') return;
        const input = row.querySelector('.ed-disc-input');
        const v = input ? input.value.trim() : '';
        if (!v) return;
        if (row.hasAttribute('data-disc-id')) {
          // Disciplina existente: atualizar nome
          const id = row.getAttribute('data-disc-id');
          const d = turma.disciplinas.find(x => x.id === id);
          if (d) d.nome = v;
        } else {
          // Nova disciplina: criar
          turma.disciplinas.push({ id: genId(), nome: v, professor: novoNome, senha: novaSenha });
        }
      });

      // Remover disciplinas marcadas
      removidos.forEach(id => {
        const idx = turma.disciplinas.findIndex(d => d.id === id);
        if (idx >= 0) {
          // Remover notas dessa disciplina
          for (const bim in turma.notas) {
            delete turma.notas[bim][id];
          }
          turma.disciplinas.splice(idx, 1);
        }
      });

      salvarStorage();
      renderAdmin();
      alert('Professor atualizado com sucesso!');
    }

    // ====================== ALUNOS ======================
    function adicionarAluno(turmaId) {
      const turma = getTurma(turmaId);
      const input = document.getElementById(`aluno-${turmaId}`);
      const nome = input.value.trim();
      if (!nome) { alert('Digite o nome do aluno!'); return; }
      if (turma.alunos.some(a => a.nome.toLowerCase() === nome.toLowerCase())) {
        alert('Aluno já cadastrado nesta turma!');
        return;
      }
      turma.alunos.push({ id: genId(), nome });
      input.value = '';
      salvarStorage();
      renderAdmin();
    }

    function removerAluno(turmaId, alunoId) {
      const turma = getTurma(turmaId);
      turma.alunos = turma.alunos.filter(a => a.id !== alunoId);
      for (const bim in turma.notas) {
        for (const discId in turma.notas[bim]) {
          delete turma.notas[bim][discId][alunoId];
        }
      }
      salvarStorage();
      renderAdmin();
    }

    function editarAlunoForm(turmaId, alunoId) {
      const turma = getTurma(turmaId);
      const aluno = turma.alunos.find(a => a.id === alunoId);
      if (!aluno) return;
      const box = document.getElementById(`edit-aluno-${alunoId}`);
      if (box) {
        box.innerHTML = `
      <div class="form-row" style="align-items:center; background:#fff3cd; padding:10px; border-radius:6px;">
        <div class="form-field" style="flex:1; min-width:250px;">
          <label>Nome do Aluno</label>
          <input type="text" id="ed-aluno-${alunoId}" value="${esc(aluno.nome)}">
        </div>
        <button class="btn-success btn-sm" onclick="salvarAlunoEdit('${turmaId}', '${alunoId}')">Salvar</button>
        <button class="btn-danger btn-sm" onclick="renderAdmin()">Cancelar</button>
      </div>
    `;
      }
    }

    function salvarAlunoEdit(turmaId, alunoId) {
      const turma = getTurma(turmaId);
      const aluno = turma.alunos.find(a => a.id === alunoId);
      if (!aluno) return;
      const nome = document.getElementById(`ed-aluno-${alunoId}`).value.trim();
      if (!nome) { alert('Digite o nome do aluno!'); return; }
      if (turma.alunos.some(a => a.id !== alunoId && a.nome.toLowerCase() === nome.toLowerCase())) {
        alert('Já existe um aluno com esse nome nesta turma!');
        return;
      }
      aluno.nome = nome;
      salvarStorage();
      renderAdmin();
      alert('Aluno atualizado com sucesso!');
    }

    function importarPlanilha(turmaId, event) {
      const file = event.target.files[0];
      if (!file) return;
      const turma = getTurma(turmaId);

      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1 });

          let add = 0, skip = 0;
          linhas.forEach((linha, idx) => {
            if (!linha || !linha[0]) return;
            const nome = String(linha[0]).trim();
            if (!nome) return;
            if (idx === 0 && /^(nome|aluno|alunos|name)$/i.test(nome)) return;
            if (turma.alunos.some(a => a.nome.toLowerCase() === nome.toLowerCase())) { skip++; return; }
            turma.alunos.push({ id: genId(), nome });
            add++;
          });

          salvarStorage();
          renderAdmin();
          alert(`Importação concluída!\n✅ ${add} aluno(s) adicionado(s)\n⚠️ ${skip} ignorado(s) (já cadastrados)`);
          event.target.value = '';
        } catch (err) {
          alert('Erro ao ler planilha: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function baixarTemplateAlunos() {
      const dados = [
        ['Nome'],
        ['Ana Silva'],
        ['Bruno Costa'],
        ['Carla Oliveira'],
        ['Daniel Santos']
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(dados);
      ws['!cols'] = [{ wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Alunos');
      XLSX.writeFile(wb, 'template_alunos.xlsx');
    }

    // ====================== RENDER ADMIN ======================
    function renderAdmin() {
      const container = document.getElementById('lista-turmas');
      const turmas = Object.entries(estado.turmas);

      if (turmas.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">🏫</div><p>Nenhuma turma cadastrada. Crie uma turma para começar.</p></div>';
        return;
      }

      container.innerHTML = turmas.map(([turmaId, turma]) => `
    <div class="card">
      <div class="card-header">
        <h3>${esc(turma.nome)}</h3>
        <div style="display:flex; gap:8px; align-items:center;">
          <span class="turma-badge">${turma.alunos.length} alunos | ${turma.disciplinas.length} disciplinas</span>
          <button class="btn-primary btn-sm" onclick="editarTurmaForm('${turmaId}')">Editar Turma</button>
          <button class="btn-danger btn-sm" onclick="removerTurma('${turmaId}')">Excluir Turma</button>
        </div>
      </div>
      <div id="edit-turma-${turmaId}"></div>

      <!-- DISCIPLINAS -->
      <h4 style="color:#1a237e; margin-bottom:8px;">Disciplinas</h4>
      <div style="background:#f0f4ff; padding:15px; border-radius:8px; margin-bottom:15px;">
        <div class="form-row">
          <div class="form-field" style="flex:1; min-width:200px;">
            <label>Nome do Professor</label>
            <input type="text" id="prof-${turmaId}" placeholder="Nome do professor">
          </div>
          <div class="form-field" style="flex:1; min-width:200px;">
            <label>Senha do Professor</label>
            <div class="senha-vis">
              <input type="password" id="senha-${turmaId}" placeholder="Senha para acesso">
              <button type="button" class="toggle-senha" onclick="toggleSenhaVis('senha-${turmaId}', this)">👁</button>
            </div>
          </div>
        </div>
        <div style="margin-top:10px;">
          <label style="font-size:12px; font-weight:700; color:#555; text-transform:uppercase; letter-spacing:0.5px;">Disciplinas que este professor leciona nesta turma:</label>
          <div id="lista-disc-inputs-${turmaId}">
            <div class="form-row disc-input-row" style="margin-top:8px;">
              <div class="form-field" style="flex:1; min-width:200px;">
                <input type="text" class="disc-input" placeholder="Ex: Matemática">
              </div>
              <button type="button" class="btn-danger btn-sm" onclick="removerDiscInput(this)">−</button>
            </div>
          </div>
          <button type="button" class="btn-primary btn-sm" style="margin-top:8px;" onclick="adicionarDiscInput('${turmaId}')">+ Adicionar outra disciplina</button>
        </div>
        <button class="btn-success" style="margin-top:12px;" onclick="adicionarDisciplina('${turmaId}')">Cadastrar Professor + Disciplinas</button>
      </div>

      ${turma.disciplinas.length === 0 ? '<p style="color:#999; font-size:13px;">Nenhuma disciplina cadastrada.</p>' : `
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Disciplina(s)</th><th>Professor</th><th>Ações</th></tr></thead>
            <tbody>
              ${(() => {
            // Agrupar disciplinas por professor (case-insensitive)
            const grupos = {};
            turma.disciplinas.forEach(d => {
              const chave = d.professor.toLowerCase();
              if (!grupos[chave]) grupos[chave] = { professor: d.professor, senha: d.senha, discs: [] };
              grupos[chave].discs.push(d);
            });
            return Object.values(grupos).map(g => {
              const grupoId = 'g-' + g.professor.replace(/[^a-z0-9]/gi, '');
              return `
                    <tr>
                      <td style="text-align:left; padding-left:15px;">
                        ${g.discs.map(d => `<div style="padding:2px 0;">• <strong>${esc(d.nome)}</strong> <button class="btn-danger btn-sm" style="font-size:9px; padding:1px 6px; margin-left:5px;" onclick="removerDisciplina('${turmaId}', '${d.id}')" title="Remover esta disciplina">×</button></div>`).join('')}
                      </td>
                      <td><strong>${esc(g.professor)}</strong></td>
                      <td>
                        <button class="btn-primary btn-sm" onclick="editarProfessorForm('${turmaId}', '${grupoId}')">Editar Professor</button>
                      </td>
                    </tr>
                    <tr><td colspan="3" style="padding:0;"><div id="edit-prof-${grupoId}-${turmaId}"></div></td></tr>
                  `;
            }).join('');
          })()}
            </tbody>
          </table>
        </div>
      `}

      <hr class="section-divider">

      <!-- ALUNOS -->
      <h4 style="color:#1a237e; margin-bottom:8px;">Alunos</h4>
      <div class="form-row">
        <div class="form-field" style="flex:1; min-width:250px;">
          <label>Nome do Aluno</label>
          <input type="text" id="aluno-${turmaId}" placeholder="Nome do aluno"
            onkeypress="if(event.key==='Enter') adicionarAluno('${turmaId}')">
        </div>
        <button class="btn-success" onclick="adicionarAluno('${turmaId}')">Adicionar</button>
        <div class="form-field">
          <label>Ou importar planilha (CSV/XLSX)</label>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn-secondary btn-sm" onclick="baixarTemplateAlunos()" title="Baixar modelo de planilha">📄 Baixar Template</button>
            <input type="file" accept=".csv,.xlsx,.xls" onchange="importarPlanilha('${turmaId}', event)">
          </div>
          <small style="color:#666; font-size:11px; display:block; margin-top:4px;">Coluna obrigatória: <b>Nome</b></small>
        </div>
      </div>

      ${turma.alunos.length === 0 ? '<p style="color:#999; font-size:13px;">Nenhum aluno cadastrado.</p>' : `
        <div class="table-wrapper" style="max-height:300px; overflow-y:auto;">
          <table>
            <thead><tr><th>Aluno</th><th>Ações</th></tr></thead>
            <tbody>
              ${turma.alunos.map(a => `
                <tr>
                  <td style="text-align:left; padding-left:15px;">${esc(a.nome)}</td>
                  <td>
                    <div style="display:flex; gap:6px; justify-content:center;">
                      <button class="btn-primary btn-sm" onclick="editarAlunoForm('${turmaId}', '${a.id}')">Editar</button>
                      <button class="btn-danger btn-sm" onclick="removerAluno('${turmaId}', '${a.id}')">Remover</button>
                    </div>
                  </td>
                </tr>
                <tr><td colspan="2" style="padding:0;"><div id="edit-aluno-${a.id}"></div></td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `).join('');
    }

    // ====================== TABELA DE NOTAS ======================
    function popularSelectTurmas() {
      const select = document.getElementById('select-turma-notas');
      const atual = select.value;
      select.innerHTML = '<option value="">-- Selecione uma turma --</option>';

      if (perfilAtual === 'admin') {
        // Admin vê todas as turmas
        Object.entries(estado.turmas).forEach(([id, turma]) => {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = turma.nome;
          select.appendChild(opt);
        });
      } else if (professorLogado) {
        // Professor só vê turmas onde tem disciplinas
        const turmasComDisciplinas = new Set(getDisciplinasProfessor().map(d => d.turmaId));
        Object.entries(estado.turmas).forEach(([id, turma]) => {
          if (turmasComDisciplinas.has(id)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = turma.nome;
            select.appendChild(opt);
          }
        });
      }

      select.value = atual;

      const selectBim = document.getElementById('select-bimestre-notas');
      if (selectBim.options.length === 0) {
        BIMESTRES.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b;
          opt.textContent = `${b}º Bimestre`;
          selectBim.appendChild(opt);
        });
      }
    }

    function validarNota(valor, callbackRender) {
      if (valor === '' || valor === null) return { valido: true, nota: '' };

      const nota = parseFloat(valor);
      if (isNaN(nota)) {
        alert('Nota inválida! Digite um número entre 0 e 10.');
        if (callbackRender) callbackRender();
        return { valido: false };
      }

      if (nota < 0 || nota > 10) {
        alert('A nota deve ser entre 0 e 10!');
        if (callbackRender) callbackRender();
        return { valido: false };
      }

      if (!Number.isInteger(nota)) {
        const notaBaixo = Math.floor(nota);
        const notaCima = Math.ceil(nota);
        alert(`⚠️ A nota deve ser um número INTEIRO entre 0 e 10.\n\nVocê digitou: ${nota}\n\nArredonde manualmente:\n  → Para baixo: ${notaBaixo}\n  → Para cima: ${notaCima}\n\nA nota NÃO foi salva. Digite um número inteiro.`);
        if (callbackRender) callbackRender();
        return { valido: false };
      }

      return { valido: true, nota: nota };
    }

    function salvarNota(turmaId, discId, alunoId, valor) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      const bimestre = parseInt(document.getElementById('select-bimestre-notas').value, 10) || estado.bimestreAtual;
      const notasBim = getNotasTurma(turma, bimestre);

      if (valor === '' || valor === null) {
        if (notasBim[discId]) delete notasBim[discId][alunoId];
        persistirAlteracao({ op: 'nota', turmaId, bimestre, disciplinaId: discId, alunoId, valor: null });
        return;
      }

      const resultado = validarNota(valor, renderTabelaNotas);
      if (!resultado.valido) return;

      if (!notasBim[discId]) notasBim[discId] = {};
      notasBim[discId][alunoId] = resultado.nota;
      persistirAlteracao({ op: 'nota', turmaId, bimestre, disciplinaId: discId, alunoId, valor: resultado.nota });
      renderTabelaNotas();
    }

    function salvarNotaAdminMultiBim(turmaId, discId, alunoId, bimestre, valor) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      const notasBim = getNotasTurma(turma, bimestre);

      if (valor === '' || valor === null) {
        if (notasBim[discId]) delete notasBim[discId][alunoId];
        persistirAlteracao({ op: 'nota', turmaId, bimestre, disciplinaId: discId, alunoId, valor: null });
        return;
      }

      const resultado = validarNota(valor, renderTabelaNotas);
      if (!resultado.valido) return;

      if (!notasBim[discId]) notasBim[discId] = {};
      notasBim[discId][alunoId] = resultado.nota;
      persistirAlteracao({ op: 'nota', turmaId, bimestre, disciplinaId: discId, alunoId, valor: resultado.nota });
    }

    function renderTabelaNotas() {
      const container = document.getElementById('tabela-notas-container');
      const turmaId = document.getElementById('select-turma-notas').value;
      const bimestre = sincronizarSelectBimestre();

      const selectBimContainer = document.getElementById('select-bimestre-notas');
      if (selectBimContainer) {
        selectBimContainer.parentElement.style.display = perfilAtual === 'admin' ? 'none' : '';
      }

      if (!turmaId) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">📋</div><p>Selecione uma turma para visualizar a tabela de notas.</p></div>';
        return;
      }

      const turma = getTurma(turmaId);
      if (!turma) { container.innerHTML = '<div class="error-box">Turma não encontrada.</div>'; return; }

      if (!turma.disciplinas || turma.disciplinas.length === 0 || turma.alunos.length === 0) {
        container.innerHTML = `<div class="warning-box">Cadastre pelo menos uma disciplina e um aluno na turma "<strong>${esc(turma.nome)}</strong>" antes de lançar notas.</div>`;
        return;
      }

      // Professor vê TODAS as disciplinas da turma, mas só edita as suas
      let disciplinasVisiveis = turma.disciplinas;
      let discIdsProfessor = [];
      if (perfilAtual === 'professor' && professorLogado) {
        discIdsProfessor = getDisciplinasProfessor()
          .filter(d => d.turmaId === turmaId)
          .map(d => d.discId);
        // NÃO filtra disciplinasVisiveis — professor vê todas
      }

      if (perfilAtual === 'admin') {
        const notasBimRefs = {};
        BIMESTRES.forEach(b => { notasBimRefs[b] = getNotasTurma(turma, b); });

        container.innerHTML = `
      <div class="info-box" style="margin-bottom:12px;">
        <strong>👑 Modo Administrador:</strong> Editando notas de <strong>todas</strong> as disciplinas nos <strong>4 bimestres</strong> simultaneamente.
        Alterações são salvas imediatamente e refletidas para os professores.
      </div>
      <div class="table-wrapper">
        <table class="admin-notas-table">
          <thead>
            <tr>
              <th class="aluno-hdr" rowspan="2">Aluno</th>
              ${disciplinasVisiveis.map(d => `
                <th class="disc-col" colspan="4" style="text-align:center;">
                  <div class="disc-header-info">
                    <strong>${esc(d.nome)}</strong>
                    <small>Prof: ${esc(d.professor)}</small>
                  </div>
                </th>
              `).join('')}
            </tr>
            <tr>
              ${disciplinasVisiveis.map(() => `
                <th class="bim-sub"><span class="admin-bim-tag b1">1B</span></th>
                <th class="bim-sub"><span class="admin-bim-tag b2">2B</span></th>
                <th class="bim-sub"><span class="admin-bim-tag b3">3B</span></th>
                <th class="bim-sub"><span class="admin-bim-tag b4">4B</span></th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${turma.alunos.map(aluno => `
              <tr>
                <td class="aluno-cell">${esc(aluno.nome)}</td>
                ${disciplinasVisiveis.map(d => {
          return BIMESTRES.map(b => {
            const nota = notasBimRefs[b][d.id]?.[aluno.id];
            return `
                      <td>
                        <input type="number" class="nota-input" min="0" max="10" step="1"
                          value="${nota !== undefined ? nota : ''}"
                          placeholder="0-10"
                          onchange="salvarNotaAdminMultiBim('${turmaId}', '${d.id}', '${aluno.id}', ${b}, this.value)">
                      </td>
                    `;
          }).join('');
        }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="margin-top:8px; font-size:12px; color:#666;">
        <strong>${esc(turma.nome)}</strong> — Todos os bimestres (1B, 2B, 3B, 4B) de todas as disciplinas. Notas salvas automaticamente.
      </p>
    `;
      } else {
        const notasBim = getNotasTurma(turma, bimestre);

        container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="aluno-hdr">Aluno</th>
              ${disciplinasVisiveis.map(d => {
          const isMinhaDisciplina = discIdsProfessor.includes(d.id);
          return `
                  <th class="disc-col">
                    <div class="disc-header-info">
                      <strong>${esc(d.nome)}</strong>
                      <small>Prof: ${esc(d.professor)}</small>
                      ${perfilAtual === 'professor' && professorLogado && isMinhaDisciplina ? `
                        <div class="logado-badge">
                          &#10003; Logado: ${esc(d.professor)}
                        </div>
                      ` : ''}
                    </div>
                  </th>
                `;
        }).join('')}
              ${perfilAtual === 'admin' ? '' : '<th class="disc-col">Frequência ' + bimestre + 'º Bimestre (%)</th>'}
            </tr>
          </thead>
          <tbody>
            ${turma.alunos.map(aluno => `
              <tr>
                <td class="aluno-cell">${esc(aluno.nome)}</td>
                ${disciplinasVisiveis.map(d => {
          const nota = notasBim[d.id]?.[aluno.id];
          const isMinhaDisciplina = discIdsProfessor.includes(d.id);
          if (perfilAtual === 'professor' && professorLogado) {
            if (isMinhaDisciplina) {
              // Disciplina do professor logado: input editável
              return `
                        <td>
                          <input type="number" class="nota-input" min="0" max="10" step="1"
                            value="${nota !== undefined ? nota : ''}"
                            placeholder="0-10"
                            onchange="salvarNota('${turmaId}', '${d.id}', '${aluno.id}', this.value)">
                        </td>
                      `;
            } else {
              // Disciplina de outro professor: nota visível mas travada (somente leitura)
              if (nota !== undefined) {
                return `<td><span class="nota-travada" title="Nota de outra disciplina — somente leitura">${Number(nota).toFixed(1)}</span></td>`;
              }
              return `<td><span class="nota-vazia">—</span></td>`;
            }
          }
          // Admin ou outros perfis
          if (nota !== undefined) {
            return `<td><span class="nota-travada" title="Nota visível mas travada">${Number(nota).toFixed(1)}</span></td>`;
          }
          return `<td><span class="nota-bloqueada">Bloqueado</span></td>`;
        }).join('')}
                ${perfilAtual === 'admin' ? '' : `
                  <td style="text-align:center; background:${bgFrequencia(classificarFrequencia(getFrequenciaBimestre(turma, bimestre, aluno.id)))};">
                    ${htmlFrequencia(getFrequenciaBimestre(turma, bimestre, aluno.id))}
                  </td>
                `}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="margin-top:8px; font-size:12px; color:#666;">
        Selecionado: <strong>${esc(turma.nome)}</strong> - <strong>${bimestre}º Bimestre</strong>
      </p>
    `;
      }
    }

    // ====================== CONCEITO FINAL (5º Conceito) ======================
    function popularSelectTurmasConceito() {
      const select = document.getElementById('select-turma-conceito');
      const atual = select.value;
      select.innerHTML = '<option value="">-- Selecione uma turma --</option>';

      if (perfilAtual === 'admin') {
        // Admin vê todas as turmas
        Object.entries(estado.turmas).forEach(([id, turma]) => {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = turma.nome;
          select.appendChild(opt);
        });
      } else if (professorLogado) {
        // Professor só vê turmas onde tem disciplinas
        const turmasComDisciplinas = new Set(getDisciplinasProfessor().map(d => d.turmaId));
        Object.entries(estado.turmas).forEach(([id, turma]) => {
          if (turmasComDisciplinas.has(id)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = turma.nome;
            select.appendChild(opt);
          }
        });
      }

      select.value = atual;
    }

    function calcularMediaFinal(turma, discId, alunoId) {
      let soma = 0, count = 0;
      BIMESTRES.forEach(b => {
        const nota = turma.notas?.[b]?.[discId]?.[alunoId];
        if (nota !== undefined && nota !== null && !isNaN(nota)) { soma += nota; count++; }
      });
      if (count === 0) return null;
      return soma / count;
    }

    function renderConceitoFinal() {
      const container = document.getElementById('tabela-conceito-container');
      const turmaId = document.getElementById('select-turma-conceito').value;

      if (!turmaId) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">🧮</div><p>Selecione uma turma para calcular o 5º Conceito (média dos bimestres).</p></div>';
        return;
      }

      const turma = getTurma(turmaId);
      if (!turma) { container.innerHTML = '<div class="error-box">Turma não encontrada.</div>'; return; }

      if (turma.disciplinas.length === 0 || turma.alunos.length === 0) {
        container.innerHTML = `<div class="warning-box">Cadastre pelo menos uma disciplina e um aluno na turma "<strong>${esc(turma.nome)}</strong>".</div>`;
        return;
      }

      // Filtrar disciplinas conforme o perfil
      // Professor vê TODAS as disciplinas da turma (somente leitura, já que 5º Conceito só admin edita)
      let disciplinasVisiveis = turma.disciplinas;
      let discIdsProfessor = [];
      if (perfilAtual === 'professor' && professorLogado) {
        discIdsProfessor = getDisciplinasProfessor()
          .filter(d => d.turmaId === turmaId)
          .map(d => d.discId);
        // NÃO filtra disciplinasVisiveis — professor vê todas (somente leitura)
      }

      const linhas = turma.alunos.map(aluno => {
        const medias = disciplinasVisiveis.map(d => {
          const conceitoEditado = turma.conceitosFinais?.[aluno.id]?.[d.id];
          if (conceitoEditado !== undefined && conceitoEditado !== null) {
            return Number(conceitoEditado).toFixed(1);
          }
          const med = calcularMediaFinal(turma, d.id, aluno.id);
          return med !== null ? Number(med).toFixed(1) : '—';
        });
        const vals = medias.map(Number).filter(v => !isNaN(v));
        const mediaGeral = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
        return { nome: aluno.nome, medias, mediaGeral };
      });

      // Média da sala por disciplina (5º conceito da sala)
      const mediaSalaPorDisc = disciplinasVisiveis.map(d => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const conceitoEditado = turma.conceitosFinais?.[aluno.id]?.[d.id];
          let med;
          if (conceitoEditado !== undefined && conceitoEditado !== null) {
            med = Number(conceitoEditado);
          } else {
            med = calcularMediaFinal(turma, d.id, aluno.id);
          }
          if (med !== null) { soma += med; count++; }
        });
        return count ? (soma / count).toFixed(1) : '—';
      });

      // Média da sala por disciplina por bimestre
      const mediaSalaBimestre = BIMESTRES.map(b => disciplinasVisiveis.map(d => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const n = turma.notas?.[b]?.[d.id]?.[aluno.id];
          if (n !== undefined && n !== null) { soma += Number(n); count++; }
        });
        return count ? (soma / count).toFixed(1) : '—';
      }));

      // Média geral da sala (média das médias gerais dos alunos com dados)
      const mediaSalaGeralVals = linhas.map(l => Number(l.mediaGeral)).filter(v => !isNaN(v));
      const mediaSalaGeral = mediaSalaGeralVals.length ? (mediaSalaGeralVals.reduce((a, b) => a + b, 0) / mediaSalaGeralVals.length).toFixed(1) : '—';

      const isAdmin = perfilAtual === 'admin';

      container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="aluno-hdr"><div class="disc-header-info"><strong>Aluno</strong><small>Prof: Sala</small></div></th>
            ${disciplinasVisiveis.map(d => {
              const isMinhaDisciplina = discIdsProfessor.includes(d.id);
              return `<th class="disc-col"><div class="disc-header-info"><strong>${esc(d.nome)}</strong><small>Prof: ${esc(d.professor)}</small>${perfilAtual === 'professor' && professorLogado && isMinhaDisciplina ? `<div class="logado-badge">&#10003; Logado: ${esc(d.professor)}</div>` : ''}</div></th>`;
            }).join('')}
            <th style="background:#1a237e;">Média Geral</th>
          </tr>
        </thead>
        <tbody>
          ${linhas.map(l => `
            <tr>
              <td class="aluno-cell">${esc(l.nome)}</td>
              ${l.medias.map(m => `<td>${m}</td>`).join('')}
              <td style="background:#e8eaf6; font-weight:700;">${l.mediaGeral}</td>
            </tr>
          `).join('')}
          <tr style="background:#e3f2fd; font-weight:700;">
            <td class="aluno-cell" style="background:#bbdefb;">🏫 Média da Sala</td>
            ${mediaSalaPorDisc.map(m => `<td style="background:#e3f2fd; color:#0d47a1;">${m}</td>`).join('')}
            <td style="background:#bbdefb; color:#0d47a1;">${mediaSalaGeral}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="table-wrapper" style="margin-top:15px;">
      <table>
        <thead>
          <tr>
            <th class="aluno-hdr">Média da Sala por Bimestre</th>
            ${disciplinasVisiveis.map(d => {
              const isMinhaDisciplina = discIdsProfessor.includes(d.id);
              return `<th class="disc-col"><div class="disc-header-info"><strong>${esc(d.nome)}</strong><small>Prof: ${esc(d.professor)}</small>${perfilAtual === 'professor' && professorLogado && isMinhaDisciplina ? `<div class="logado-badge">&#10003; Logado: ${esc(d.professor)}</div>` : ''}</div></th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>
          ${BIMESTRES.map((b, i) => `
            <tr>
              <td class="aluno-cell">${b}º Bimestre</td>
              ${mediaSalaBimestre[i].map(m => `<td>${m}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p style="margin-top:8px; font-size:12px; color:#666;">
      <strong>${esc(turma.nome)}</strong> — 5º Conceito (média aritmética dos ${BIMESTRES.length} bimestres ou valor definido pelo administrador${isAdmin ? ' — <strong>editável no Boletim Final</strong>' : ''}). Disciplinas sem nota aparecem como "—".
      <br>A <strong>Média da Sala</strong> mostra a média do 5º Conceito de cada disciplina (e a média geral). A tabela de <strong>Média da Sala por Bimestre</strong> mostra a média da turma em cada disciplina em cada bimestre.
    </p>
  `;
    }

    // ====================== CONTROLE DE ACESSO ======================
    let perfilAtual = null; // 'admin' ou 'professor'
    let professorLogado = null; // { nome, disciplinas: [discId, ...] }

    function entrarComoAdmin() {
      // Recarregar dados do localStorage para garantir que o admin
      // veja as últimas alterações feitas pelo professor
      recarregarDados();

      const senha = prompt('Digite a senha do administrador:');
      if (senha === null) return;
      // Compara apenas com a senha configurada (o fallback fixo 'admin123'
      // era uma brecha: continuava funcionando mesmo após trocar a senha).
      if (senha !== estado.senhaAdmin) {
        alert('Senha incorreta!');
        return;
      }
      perfilAtual = 'admin';
      mostrarSistema();
    }

    function entrarComoProfessor() {
      // Recarregar dados do localStorage para garantir que o professor
      // veja as últimas alterações feitas pelo admin (ou por ele mesmo)
      recarregarDados();

      const nome = prompt('Digite seu nome de professor:');
      if (nome === null || !nome.trim()) return;

      // Buscar todas as disciplinas do professor em todas as turmas
      const disciplinasProfessor = [];
      Object.entries(estado.turmas).forEach(([turmaId, turma]) => {
        if (!turma.disciplinas) return;
        turma.disciplinas.forEach(disc => {
          if (disc.professor && disc.professor.toLowerCase().trim() === nome.trim().toLowerCase()) {
            disciplinasProfessor.push({
              turmaId,
              turmaNome: turma.nome,
              discId: disc.id,
              discNome: disc.nome,
              senha: disc.senha || ''
            });
          }
        });
      });

      if (disciplinasProfessor.length === 0) {
        alert('Nenhuma disciplina encontrada para esse nome de professor!\n\nVerifique se o nome está cadastrado corretamente nas turmas.');
        return;
      }

      // Listar disciplinas encontradas
      const listaDisc = disciplinasProfessor.map(d => `- ${d.discNome} (${d.turmaNome})`).join('\n');

      // Verificar senha
      const senha = prompt(`Disciplinas encontradas:\n${listaDisc}\n\nDigite sua senha:`);
      if (senha === null) return;

      const senhaLimpa = senha.trim();
      const senhaValida = disciplinasProfessor.some(d => d.senha === senhaLimpa);
      if (!senhaValida) {
        // Por segurança, NÃO exibir as senhas na mensagem de erro.
        alert('Senha incorreta!\n\nSuas disciplinas encontradas:\n' + listaDisc + '\n\nSe esqueceu a senha, solicite ao administrador.');
        return;
      }

      perfilAtual = 'professor';
      professorLogado = {
        nome: nome.trim(),
        disciplinas: disciplinasProfessor
      };
      mostrarSistema();
    }

    function sair() {
      perfilAtual = null;
      professorLogado = null;
      document.getElementById('tela-estatisticas').style.display = 'none';
      document.getElementById('tela-login').style.display = 'block';
      document.getElementById('sistema-principal').style.display = 'none';
    }

    // ----- Disciplinas do professor em TEMPO REAL -----
    // O snapshot salvo no login fica defasado quando o admin cadastra/edita
    // disciplinas (ou a nuvem sincroniza dados novos) DEPOIS que o professor entrou.
    // Esta função recalcula pelo MESMO critério do login — nome do professor, sem
    // diferenciar maiúsculas/minúsculas — e mescla com os vínculos concedidos no
    // login (fallback, caso o nome tenha sido alterado depois nas disciplinas).
    function getDisciplinasProfessor() {
      if (!professorLogado) return [];
      const nomeAlvo = (professorLogado.nome || '').trim().toLowerCase();
      const lista = [];
      const vistas = new Set();
      Object.entries(estado.turmas || {}).forEach(([turmaId, turma]) => {
        (turma.disciplinas || []).forEach(d => {
          if (d.professor && d.professor.trim().toLowerCase() === nomeAlvo) {
            lista.push({ turmaId, turmaNome: turma.nome, discId: d.id, discNome: d.nome, senha: d.senha || '' });
            vistas.add(turmaId + '|' + d.id);
          }
        });
      });
      // Fallback: vínculos do login que ainda existem nos dados atuais
      (professorLogado.disciplinas || []).forEach(d => {
        const chave = d.turmaId + '|' + d.discId;
        const existe = ((estado.turmas || {})[d.turmaId]?.disciplinas || []).some(x => x.id === d.discId);
        if (!vistas.has(chave) && existe) { lista.push(d); vistas.add(chave); }
      });
      return lista;
    }

    function mostrarSistema() {
      document.getElementById('tela-estatisticas').style.display = 'none';
      document.getElementById('tela-login').style.display = 'none';
      document.getElementById('sistema-principal').style.display = 'block';

      const infoUsuario = document.getElementById('usuario-logado-info');
      const tabsContainer = document.getElementById('tabs-container');

      if (perfilAtual === 'admin') {
        infoUsuario.innerHTML = '<span style="color:#1a237e; font-weight:700;">👑 Administrador</span>';
        tabsContainer.innerHTML = `
      <div class="tabs">
        <button class="tab active" onclick="mudarAba('admin')">Turmas</button>
        <button class="tab" onclick="mudarAba('notas')">Lançar Notas</button>
        <button class="tab" onclick="mudarAba('frequencias')">Frequências</button>
        <button class="tab" onclick="mudarAba('boletim')">Boletim Final</button>
        <button class="tab" onclick="mudarAba('estatisticas')">📊 Estatísticas</button>
      </div>
    `;
        mudarAba('admin');
      } else {
        infoUsuario.innerHTML = `<span style="color:#2e7d32; font-weight:700;">📚 ${esc(professorLogado.nome)}</span>`;
        tabsContainer.innerHTML = `
      <div class="tabs">
        <button class="tab active" onclick="mudarAba('notas')">Lançar Notas</button>
        <button class="tab" onclick="mudarAba('frequencias')">Frequências</button>
        <button class="tab" onclick="mudarAba('boletim')">Boletim Final</button>
        <button class="tab" onclick="mudarAba('conceito')">5º Conceito</button>
        <button class="tab" onclick="mudarAba('estatisticas')">📊 Estatísticas</button>
      </div>
    `;
        mudarAba('notas');
      }
    }

    // ====================== BOLETIM FINAL ======================
    function popularSelectTurmasBoletim() {
      const select = document.getElementById('select-turma-boletim');
      if (!select) return;
      const atual = select.value;
      select.innerHTML = '<option value="">-- Selecione uma turma --</option>';
      const turmasDoProfessor = professorLogado
        ? new Set(getDisciplinasProfessor().map(d => d.turmaId))
        : null;
      Object.entries(estado.turmas).forEach(([id, turma]) => {
        // Professor só vê turmas onde tem disciplinas; admin vê todas
        if (turmasDoProfessor && perfilAtual !== 'admin' && !turmasDoProfessor.has(id)) return;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = turma.nome;
        select.appendChild(opt);
      });
      select.value = atual;
    }

    // ====================== FREQUÊNCIAS POR BIMESTRE ======================
    // Critério: > 75% = OK | = 75% = Limite | < 75% = Atenção
    const FREQUENCIA_MINIMA = 75;

    function getFrequenciaBimestre(turma, bimestre, alunoId) {
      if (!turma.frequencias) turma.frequencias = {};
      if (!turma.frequencias[bimestre]) turma.frequencias[bimestre] = {};
      const v = turma.frequencias[bimestre][alunoId];
      return (v === undefined || v === null) ? '' : v;
    }

    function salvarFrequencia(turmaId, bimestre, alunoId, valor) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      if (!turma.frequencias) turma.frequencias = {};
      if (!turma.frequencias[bimestre]) turma.frequencias[bimestre] = {};
      if (valor === '' || valor === null) {
        delete turma.frequencias[bimestre][alunoId];
        persistirAlteracao({ op: 'frequencia', turmaId, bimestre, alunoId, valor: null });
        renderFrequencias();
        return;
      }
      const num = Number(valor);
      if (isNaN(num) || num < 0 || num > 100) {
        alert('Frequência deve ser um valor entre 0 e 100 (%).');
        return;
      }
      turma.frequencias[bimestre][alunoId] = num;
      persistirAlteracao({ op: 'frequencia', turmaId, bimestre, alunoId, valor: num });
      renderFrequencias();
    }

    function classificarFrequencia(pct) {
      if (pct === undefined || pct === null || pct === '' || isNaN(Number(pct))) return null;
      const n = Number(pct);
      if (n > FREQUENCIA_MINIMA) return 'ok';
      if (n === FREQUENCIA_MINIMA) return 'limite';
      return 'atencao';
    }

    function labelFrequencia(classificacao) {
      if (classificacao === 'ok') return 'OK';
      if (classificacao === 'limite') return 'Limite';
      if (classificacao === 'atencao') return 'Atenção';
      return '—';
    }

    // Cores de TEXTO legíveis no tema ESCURO do sistema (tom claro, nunca escuro)
    function corFrequencia(classificacao) {
      if (classificacao === 'ok') return '#6ee7b7';      // verde claro
      if (classificacao === 'limite') return '#fde68a';  // amarelo claro
      if (classificacao === 'atencao') return '#fca5a5'; // vermelho claro
      return '#8fa0bd';                                   // sem dado (muted)
    }

    // Fundo translúcido (RGBA) — sobrepõe bem ao fundo escuro da tabela e do input,
    // sem passar pelas regras de "compatibilidade" de cores claras do CSS.
    function bgFrequencia(classificacao) {
      if (classificacao === 'ok') return 'rgba(52,211,153,0.16)';
      if (classificacao === 'limite') return 'rgba(251,191,36,0.18)';
      if (classificacao === 'atencao') return 'rgba(248,113,113,0.16)';
      return 'rgba(255,255,255,0.05)';
    }

    // Estilo inline do campo de lançamento de frequência (fundo + texto juntos)
    function estiloFrequencia(pct) {
      const cls = classificarFrequencia(pct);
      return `background:${bgFrequencia(cls)}; color:${corFrequencia(cls)}; border-color:${corFrequencia(cls)}55;`;
    }

    // Exibe "87.5%" e o rótulo da classificação quando houver dado.
    function htmlFrequencia(pct) {
      const cls = classificarFrequencia(pct);
      if (cls === null) return '<span style="color:#999;">—</span>';
      return `<span style="color:${corFrequencia(cls)}; font-weight:700;">${Number(pct).toFixed(1)}%</span>
          <small style="display:block; color:${corFrequencia(cls)}; font-size:10px;">${labelFrequencia(cls)}</small>`;
    }

    // ====================== SITUAÇÃO FINAL (decisão manual do professor) ========
    const OPCOES_SITUACAO_FINAL = {
      aprovado_nota_freq: 'Aprovado por Nota e Frequência',
      aprovado_conselho: 'Aprovado pelo Conselho',
      reprovado_nota: 'Reprovado por Nota',
      reprovado_freq: 'Reprovado por Frequência'
    };

    function labelSituacaoFinal(valor) {
      return OPCOES_SITUACAO_FINAL[valor] || '—';
    }

    function corSituacaoFinal(valor) {
      if (valor === 'aprovado_nota_freq' || valor === 'aprovado_conselho') return '#2e7d32';
      if (valor === 'reprovado_nota' || valor === 'reprovado_freq') return '#c62828';
      return '#666';
    }

    // ====================== ABA FREQUÊNCIAS (tela dedicada) =====================
    function popularSelectTurmasFrequencias() {
      const select = document.getElementById('select-turma-frequencias');
      if (!select) return;
      const atual = select.value;
      select.innerHTML = '<option value="">-- Selecione uma turma --</option>';
      const turmasDoProfessor = professorLogado
        ? new Set(getDisciplinasProfessor().map(d => d.turmaId))
        : null;
      Object.entries(estado.turmas).forEach(([id, turma]) => {
        // Professor só vê turmas onde tem disciplinas; admin vê todas
        if (turmasDoProfessor && perfilAtual !== 'admin' && !turmasDoProfessor.has(id)) return;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = turma.nome;
        select.appendChild(opt);
      });
      select.value = atual;
    }

    function renderFrequencias() {
      const container = document.getElementById('tabela-frequencias-container');
      if (!container) return;
      const turmaId = document.getElementById('select-turma-frequencias').value;

      if (!turmaId) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">🗓️</div><p>Selecione uma turma para visualizar as frequências.</p></div>';
        return;
      }
      const turma = getTurma(turmaId);
      if (!turma) { container.innerHTML = '<div class="error-box">Turma não encontrada.</div>'; return; }
      if (!turma.alunos || turma.alunos.length === 0) {
        container.innerHTML = `<div class="warning-box">Cadastre alunos na turma "<strong>${esc(turma.nome)}</strong>" antes de lançar frequências.</div>`;
        return;
      }
      if (!turma.frequencias) turma.frequencias = {};
      const isAdmin = perfilAtual === 'admin';

      container.innerHTML = `
    ${isAdmin ? '' : '<div class="info-box" style="margin-bottom:10px;">👁️ Somente leitura — as frequências são lançadas pelo administrador.</div>'}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="aluno-hdr">Aluno</th>
            <th style="background:#1565c0;">1º Bimestre</th>
            <th style="background:#1565c0;">2º Bimestre</th>
            <th style="background:#1565c0;">3º Bimestre</th>
            <th style="background:#1565c0;">4º Bimestre</th>
            <th style="background:#1a237e;">Média de Frequência</th>
          </tr>
        </thead>
        <tbody>
          ${turma.alunos.map(aluno => `
            <tr>
              <td class="aluno-cell">${esc(aluno.nome)}</td>
              ${[1, 2, 3, 4].map(b => {
        const pct = getFrequenciaBimestre(turma, b, aluno.id);
        if (!isAdmin) {
          return `<td style="text-align:center; background:${bgFrequencia(classificarFrequencia(pct))};">${htmlFrequencia(pct)}</td>`;
        }
        return `
                  <td style="text-align:center;">
                    <input type="number" class="nota-input freq-in" min="0" max="100" step="1"
                      value="${pct}"
                      placeholder="%"
                      autocomplete="off"
                      title="Frequência do ${b}º bimestre (0 a 100)"
                      style="${estiloFrequencia(pct)}"
                      onchange="salvarFrequencia('${turmaId}', ${b}, '${aluno.id}', this.value)">
                    <small style="color:${corFrequencia(classificarFrequencia(pct))}; font-size:10px;">${labelFrequencia(classificarFrequencia(pct))}</small>
                  </td>
                `;
      }).join('')}
              <td style="text-align:center; background:#e3f2fd;">${getFrequenciaMedia(turma, aluno.id)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p style="margin-top:8px; font-size:12px; color:#666;">
      <strong>${esc(turma.nome)}</strong> — frequência em % (0 a 100).
      Critério: <span style="color:#6ee7b7; font-weight:700;">&gt;75% OK</span> ·
      <span style="color:#fde68a; font-weight:700;">=75% Limite</span> ·
      <span style="color:#fca5a5; font-weight:700;">&lt;75% Atenção</span>.
    </p>
  `;
    }

    function getFrequenciaMediaNum(turma, alunoId) {
      if (!turma.frequencias) turma.frequencias = {};
      let soma = 0, cont = 0;
      [1, 2, 3, 4].forEach(b => {
        const fb = turma.frequencias[b];
        if (fb && fb[alunoId] !== undefined && fb[alunoId] !== null) {
          soma += Number(fb[alunoId]);
          cont++;
        }
      });
      if (cont === 0) return null;
      return Number((soma / cont).toFixed(1));
    }

    function getFrequenciaMedia(turma, alunoId) {
      const media = getFrequenciaMediaNum(turma, alunoId);
      if (media === null) return '<span style="color:#8fa0bd;">—</span>';
      const cls = classificarFrequencia(media);
      return `<span style="color:${corFrequencia(cls)}; font-weight:700;">${media.toFixed(1)}%</span>`;
    }

    function calcularFreqMediaGeral(turma) {
      if (!turma.frequencias) turma.frequencias = {};
      let soma = 0, cont = 0;
      turma.alunos.forEach(al => {
        [1, 2, 3, 4].forEach(b => {
          const fb = turma.frequencias[b];
          if (fb && fb[al.id] !== undefined && fb[al.id] !== null) {
            soma += Number(fb[al.id]);
            cont++;
          }
        });
      });
      if (cont === 0) return '—';
      return Number((soma / cont).toFixed(1)) + '%';
    }

    // Versão numérica para uso em cálculos (retorna número ou null)
    function getFrequenciaMediaSalaNum(turma) {
      if (!turma.frequencias) turma.frequencias = {};
      let soma = 0, cont = 0;
      turma.alunos.forEach(al => {
        [1, 2, 3, 4].forEach(b => {
          const fb = turma.frequencias[b];
          if (fb && fb[al.id] !== undefined && fb[al.id] !== null) {
            soma += Number(fb[al.id]);
            cont++;
          }
        });
      });
      if (cont === 0) return null;
      return Number((soma / cont).toFixed(1));
    }

    function getSituacaoFinal(turma, alunoId, discId) {
      if (!turma.situacoesFinais) turma.situacoesFinais = {};
      if (!turma.situacoesFinais[alunoId]) return '';
      return turma.situacoesFinais[alunoId][discId] || '';
    }

    function salvarSituacaoFinal(turmaId, alunoId, discId, valor) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      if (!turma.situacoesFinais) turma.situacoesFinais = {};
      if (!turma.situacoesFinais[alunoId]) turma.situacoesFinais[alunoId] = {};
      if (valor === '' || valor === null) {
        delete turma.situacoesFinais[alunoId][discId];
      } else {
        turma.situacoesFinais[alunoId][discId] = valor;
      }
      persistirAlteracao({ op: 'situacao', turmaId, alunoId, disciplinaId: discId, valor: valor || null });
      renderBoletimFinal();
    }

    function salvarConceitoFinal(turmaId, alunoId, discId, valor) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      if (!turma.conceitosFinais) turma.conceitosFinais = {};
      if (!turma.conceitosFinais[alunoId]) turma.conceitosFinais[alunoId] = {};

      if (valor === '' || valor === null) {
        delete turma.conceitosFinais[alunoId][discId];
        persistirAlteracao({ op: 'conceito', turmaId, alunoId, disciplinaId: discId, valor: null });
        renderBoletimFinal();
        salvarStorage();
        return;
      }

      const resultado = validarNota(valor, renderBoletimFinal);
      if (!resultado.valido) return;

      turma.conceitosFinais[alunoId][discId] = resultado.nota;
      persistirAlteracao({ op: 'conceito', turmaId, alunoId, disciplinaId: discId, valor: resultado.nota });
      renderBoletimFinal();
      salvarStorage();
    }

    function renderBoletimFinal() {
      const container = document.getElementById('tabela-boletim-container');
      const turmaId = document.getElementById('select-turma-boletim').value;
      const btnExportar = document.getElementById('btn-exportar-boletim');
      if (btnExportar) btnExportar.disabled = !turmaId;
      const btnExportarPdf = document.getElementById('btn-exportar-boletim-pdf');
      if (btnExportarPdf) btnExportarPdf.disabled = !turmaId;

      if (!turmaId) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">📊</div><p>Selecione uma turma para visualizar o boletim final.</p></div>';
        return;
      }

      const turma = getTurma(turmaId);
      if (!turma) { container.innerHTML = '<div class="error-box">Turma não encontrada.</div>'; return; }

      // Professor vê TODAS as disciplinas da turma, mas só edita Situação Final das suas
      let disciplinasVisiveis = (turma.disciplinas || []);
      let discIdsProfessor = [];
      if (perfilAtual === 'professor' && professorLogado) {
        discIdsProfessor = getDisciplinasProfessor()
          .filter(d => d.turmaId === turmaId)
          .map(d => d.discId);
        // NÃO filtra disciplinasVisiveis — professor vê todas
      }

      if (disciplinasVisiveis.length === 0 || turma.alunos.length === 0) {
        container.innerHTML = (perfilAtual === 'professor' && professorLogado)
          ? `<div class="warning-box">O professor <strong>${esc(professorLogado.nome)}</strong> não possui disciplinas cadastradas na turma "<strong>${esc(turma.nome)}</strong>".</div>`
          : `<div class="warning-box">Cadastre pelo menos uma disciplina e um aluno na turma "<strong>${esc(turma.nome)}</strong>".</div>`;
        return;
      }

      if (!turma.conceitosFinais) turma.conceitosFinais = {};

      // ----- Médias da sala (5º conceito por disciplina) -----
      const mediaSalaPorDiscBoletim = disciplinasVisiveis.map(disc => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const n1 = turma.notas?.[1]?.[disc.id]?.[aluno.id];
          const n2 = turma.notas?.[2]?.[disc.id]?.[aluno.id];
          const n3 = turma.notas?.[3]?.[disc.id]?.[aluno.id];
          const n4 = turma.notas?.[4]?.[disc.id]?.[aluno.id];
          const a1 = (n1 === undefined || n1 === null) ? 0 : Number(n1);
          const a2 = (n2 === undefined || n2 === null) ? 0 : Number(n2);
          const a3 = (n3 === undefined || n3 === null) ? 0 : Number(n3);
          const a4 = (n4 === undefined || n4 === null) ? 0 : Number(n4);
          const temNota = [n1, n2, n3, n4].some(n => n !== undefined && n !== null);
          if (!temNota) return;
          const editado = turma.conceitosFinais?.[aluno.id]?.[disc.id];
          const med = editado !== undefined && editado !== null ? Number(editado) : (a1 + a2 + a3 + a4) / 4;
          soma += med; count++;
        });
        return count ? Number((soma / count).toFixed(1)) : null;
      });

      // ---------------------------------------------------------------------------
      // Média da sala por bimestre por disciplina (linha "🏫 Média da Sala" no rodapé)
      // NOTA SOBRE O MÉTODO (diferença com as Estatísticas):
      //   Aqui, para cada bimestre, entram na conta APENAS os alunos que TÊM nota
      //   lançada naquele bimestre (aluno sem nota naquele bimestre = traço NÃO conta).
      //   Ou seja: NÃO inclui 0 para quem não tem nota e divide somente pelo nº de
      //   alunos que possuem nota naquele bimestre.
      //   Já nas Estatísticas ("Média Geral por Bimestre"), por escolha do usuário,
      //   o bimestre vazio vale 0 e a divisão é pelo TOTAL de alunos × disciplinas.
      // ---------------------------------------------------------------------------
      const mediaSalaBimestreBoletim = [1, 2, 3, 4].map(b => disciplinasVisiveis.map(disc => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const n = turma.notas?.[b]?.[disc.id]?.[aluno.id];
          if (n !== undefined && n !== null) { soma += Number(n); count++; }
        });
        return count ? Number((soma / count).toFixed(1)) : null;
      }));

      container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="aluno-hdr" rowspan="2">Aluno</th>
            ${disciplinasVisiveis.map(d => {
              const isMinhaDisciplina = discIdsProfessor.includes(d.id);
              return `<th class="disc-col" colspan="8" style="text-align:center;"><div class="disc-header-info"><strong>${esc(d.nome)}</strong><small>Prof: ${esc(d.professor)}</small>${perfilAtual === 'professor' && professorLogado && isMinhaDisciplina ? `<div class="logado-badge">&#10003; Logado: ${esc(d.professor)}</div>` : ''}</div></th>`;
            }).join('')}
            <th rowspan="2" style="background:#1a237e; min-width:100px;">Média Geral</th>
          </tr>
          <tr>
            ${disciplinasVisiveis.map(() => `
              <th style="background:#263238; font-size:10px; padding:5px;">1ºB</th>
              <th style="background:#263238; font-size:10px; padding:5px;">2ºB</th>
              <th style="background:#263238; font-size:10px; padding:5px;">3ºB</th>
              <th style="background:#263238; font-size:10px; padding:5px;">4ºB</th>
              <th style="background:#2e7d32; font-size:10px; padding:5px;">5º Conceito</th>
              <th style="background:#e65100; font-size:10px; padding:5px;">Recuperação</th>
              <th style="background:#1565c0; font-size:10px; padding:5px;">Freq. (%)</th>
              <th style="background:#4a148c; color:#fff; font-size:10px; padding:5px;">Situação Final</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${turma.alunos.map(aluno => {
        const mediasAluno = [];
        const linhaDisciplinas = disciplinasVisiveis.map(disc => {
          const n1 = turma.notas?.[1]?.[disc.id]?.[aluno.id];
          const n2 = turma.notas?.[2]?.[disc.id]?.[aluno.id];
          const n3 = turma.notas?.[3]?.[disc.id]?.[aluno.id];
          const n4 = turma.notas?.[4]?.[disc.id]?.[aluno.id];
          // 5º Conceito: nota ausente = 0, denominador fixo 4
          const v1 = (n1 === undefined || n1 === null) ? 0 : Number(n1);
          const v2 = (n2 === undefined || n2 === null) ? 0 : Number(n2);
          const v3 = (n3 === undefined || n3 === null) ? 0 : Number(n3);
          const v4 = (n4 === undefined || n4 === null) ? 0 : Number(n4);
          const mediaCalc = (v1 + v2 + v3 + v4) / 4;
          const notasLancadas = [n1, n2, n3, n4].filter(n => n !== undefined && n !== null);
          const conceitoFinalSalvo = turma.conceitosFinais?.[aluno.id]?.[disc.id];
          const conceitoFinalNum = conceitoFinalSalvo !== undefined
            ? Number(conceitoFinalSalvo)
            : Number(mediaCalc.toFixed(1));
          mediasAluno.push(mediaCalc);
          // Médias de semestre: nota ausente = 0, denominador fixo 2
          const mediaSem1 = (v1 + v2) / 2;
          const mediaSem2 = (v3 + v4) / 2;
          const aprovDisc = classificarAprovacao(conceitoFinalNum);
          const recDisc = classificarRecuperacao(mediaSem1, mediaSem2);
          const aprCor = aprovDisc === 'aprovado' ? 'status-aprovado' : (aprovDisc === 'reprovado' ? 'status-reprovado' : '');
          const recCor = (recDisc === 'rec1' || recDisc === 'rec2' || recDisc === 'rec1+rec2') ? 'status-recuperacao' : '';
          return `
                <td>${n1 !== undefined ? Number(n1).toFixed(1) : '—'}</td>
                <td>${n2 !== undefined ? Number(n2).toFixed(1) : '—'}</td>
                <td>${n3 !== undefined ? Number(n3).toFixed(1) : '—'}</td>
                <td>${n4 !== undefined ? Number(n4).toFixed(1) : '—'}</td>
                <td style="background:#e8f5e9;">
                  ${(() => {
                    const isMinhaDisciplina = discIdsProfessor.includes(disc.id);
                    const podeEditarConceito = perfilAtual === 'admin' || (perfilAtual === 'professor' && professorLogado && isMinhaDisciplina);
                    if (podeEditarConceito) {
                      const titulo = perfilAtual === 'admin' 
                        ? '5º Conceito (administrador edita — sobrescreve a média automática)'
                        : '5º Conceito (edite para sobrescrever a média automática dos 4 bimestres)';
                      const corBorda = perfilAtual === 'admin' ? '#2e7d32' : '#e65100';
                      return `
                        <input type="number" class="nota-input" min="0" max="10" step="1"
                          value="${conceitoFinalNum !== null ? conceitoFinalNum : ''}"
                          placeholder="0-10"
                          title="${titulo}"
                          style="background:#fff3cd; border-color:${corBorda};"
                          onchange="salvarConceitoFinal('${turmaId}', '${aluno.id}', '${disc.id}', this.value)">
                      `;
                    } else {
                      return `
                        <span title="5º Conceito — média automática dos 4 bimestres (editável pelo professor da disciplina ou admin)"
                          style="font-weight:700; color:#6ee7b7;">${conceitoFinalNum !== null ? Number(conceitoFinalNum).toFixed(1) : '—'}</span>
                      `;
                    }
                  })()}
                </td>
                <td class="${recCor}" style="font-size:11px; padding:4px;">${labelRecuperacao(recDisc)}</td>
                <td style="font-size:11px; padding:4px; text-align:center;">${getFrequenciaMedia(turma, aluno.id)}</td>
                <td>
                  ${(() => {
                    const isMinhaDisciplina = discIdsProfessor.includes(disc.id);
                    if (perfilAtual === 'professor' && professorLogado && isMinhaDisciplina) {
                      // Disciplina do professor: dropdown editável
                      return `
                        <select class="nota-input" style="width:140px; font-size:11px;" onchange="salvarSituacaoFinal('${turmaId}', '${aluno.id}', '${disc.id}', this.value)">
                          <option value="">Selecione</option>
                          <option value="aprovado_nota_freq" ${getSituacaoFinal(turma, aluno.id, disc.id) === 'aprovado_nota_freq' ? 'selected' : ''}>Aprovado por nota e frequência</option>
                          <option value="aprovado_conselho" ${getSituacaoFinal(turma, aluno.id, disc.id) === 'aprovado_conselho' ? 'selected' : ''}>Aprovado pelo conselho</option>
                          <option value="reprovado_nota" ${getSituacaoFinal(turma, aluno.id, disc.id) === 'reprovado_nota' ? 'selected' : ''}>Reprovado por nota</option>
                          <option value="reprovado_freq" ${getSituacaoFinal(turma, aluno.id, disc.id) === 'reprovado_freq' ? 'selected' : ''}>Reprovado por frequência</option>
                        </select>
                      `;
                    } else {
                      // Outras disciplinas ou admin: somente leitura
                      const sit = getSituacaoFinal(turma, aluno.id, disc.id);
                      if (sit) {
                        return `<span style="color:${corSituacaoFinal(sit)}; font-weight:700;">${labelSituacaoFinal(sit)}</span>`;
                      }
                      return '<span style="color:#999;">—</span>';
                    }
                  })()}
                </td>
              `;
        }).join('');
        const mediaGeral = mediasAluno.length ? (mediasAluno.reduce((a, b) => a + b, 0) / mediasAluno.length).toFixed(1) : '—';
        return `
              <tr>
                <td class="aluno-cell">${esc(aluno.nome)}</td>
                ${linhaDisciplinas}
                <td style="background:#e8eaf6; font-weight:700;">${mediaGeral}</td>
              </tr>
            `;
      }).join('')}
          <tr style="background:#e3f2fd; font-weight:700;">
            <td class="aluno-cell" style="background:#bbdefb;">🏫 Média da Sala</td>
            ${disciplinasVisiveis.map((disc, di) => {
        const m = mediaSalaPorDiscBoletim[di];
        // células: 1ºB, 2ºB, 3ºB, 4ºB, 5º Conceito, Recuperação, Freq. (%), Situação Final
        const c1 = mediaSalaBimestreBoletim[0][di];
        const c2 = mediaSalaBimestreBoletim[1][di];
        const c3 = mediaSalaBimestreBoletim[2][di];
        const c4 = mediaSalaBimestreBoletim[3][di];
        const aprSala = m !== null ? labelAprovacao(classificarAprovacao(m)) : '—';
        const sem1 = (c1 !== null || c2 !== null) ? ((c1 ?? 0) + (c2 ?? 0)) / 2 : null;
        const sem2 = (c3 !== null || c4 !== null) ? ((c3 ?? 0) + (c4 ?? 0)) / 2 : null;
        const recSala = (sem1 !== null || sem2 !== null) ? labelRecuperacao(classificarRecuperacao(sem1, sem2)) : '—';
        return `
                <td style="background:#e3f2fd; color:#0d47a1;">${c1 !== null ? c1.toFixed(1) : '—'}</td>
                <td style="background:#e3f2fd; color:#0d47a1;">${c2 !== null ? c2.toFixed(1) : '—'}</td>
                <td style="background:#e3f2fd; color:#0d47a1;">${c3 !== null ? c3.toFixed(1) : '—'}</td>
                <td style="background:#e3f2fd; color:#0d47a1;">${c4 !== null ? c4.toFixed(1) : '—'}</td>
                <td style="background:#c8e6c9; color:#0d47a1; font-weight:700;">${m !== null ? m.toFixed(1) : '—'}</td>
                <td style="background:#e3f2fd;">${recSala}</td>
                <td style="background:#e3f2fd; color:#0d47a1;">${calcularFreqMediaGeral(turma)}</td>
                <td style="background:#e3f2fd;">—</td>
              `;
      }).join('')}
            <td style="background:#bbdefb; color:#0d47a1; font-weight:700;">${(() => {
          const vals = mediaSalaPorDiscBoletim.filter(v => v !== null);
          return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
        })()}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="metodo-nota">ℹ️ A <b>"Média da Sala por Bimestre"</b> desta tabela usa <b>apenas os alunos que têm nota lançada</b> naquele bimestre — quem ficou sem nota (traço) <b>não entra</b> na conta. Por isso ela pode <b>diferir</b> da "Média Geral por Bimestre" das Estatísticas (que trata bimestre vazio como 0 e divide pelo total).</div>

    <div class="table-wrapper" style="margin-top:15px;">
      <table>
        <thead>
          <tr>
            <th class="aluno-hdr"><div class="disc-header-info"><strong>Média da Sala por Bimestre</strong><small>Prof: Sala</small></div></th>
            ${disciplinasVisiveis.map(d => `<th class="disc-col"><div class="disc-header-info"><strong>${esc(d.nome)}</strong><small>Prof: ${esc(d.professor)}</small></div></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${[1, 2, 3, 4].map((b, i) => `
            <tr>
              <td class="aluno-cell">${b}º Bimestre</td>
              ${mediaSalaBimestreBoletim[i].map(m => `<td>${m !== null ? m.toFixed(1) : '—'}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="info-box" style="margin-top:15px;">
      <strong>📌 ${esc(turma.nome)}</strong> — Tabela com notas de cada bimestre, 5º Conceito, <strong>Recuperação</strong>, <strong>Frequência (%)</strong> e <strong>Situação Final</strong> por disciplina.
      ${(perfilAtual === 'professor' && professorLogado) ? `<br><strong>👁️ Visão do professor:</strong> <strong>TODAS</strong> as disciplinas da turma são exibidas (notas dos bimestres somente leitura). O <strong>5º Conceito</strong> e a <strong>Situação Final</strong> das suas disciplinas são editáveis — e é o que vai também para o Excel/PDF.` : ''}
      O <strong>5º Conceito</strong> é preenchido automaticamente com a média dos 4 bimestres, mas o <strong>administrador</strong> e o <strong>professor da disciplina</strong> podem <strong>clicar no campo amarelo</strong> para editá-lo (sobrescreve a média automática). Apenas notas <strong>inteiras</strong> de 0 a 10 são aceitas — se digituar um decimal, um alerta pedirá para arredondar manualmente.
      <br><strong>🗓️ Frequência (%):</strong> média das frequências lançadas pelo admin nos bimestres (aba <strong>Frequências</strong>) —
      <span style="color:#6ee7b7; font-weight:700;">>75% = OK</span> ·
      <span style="color:#fde68a; font-weight:700;">=75% = Limite</span> ·
      <span style="color:#fca5a5; font-weight:700;"><75% = Atenção</span>.
      <br><strong>⚖️ Situação Final:</strong> escolhida <strong>manualmente</strong> em cada campo (não há cálculo automático) entre
      <em>Aprovado por nota e frequência</em>, <em>Aprovado pelo conselho</em>, <em>Reprovado por nota</em> e <em>Reprovado por frequência</em> — disponível também para o professor (apenas nas suas disciplinas).<strong>Regras de referência:</strong>
      <strong>Aprovação:</strong>
      <code>5º Conceito ≥ 5</code> → ✅ Aprovado &nbsp;|&nbsp;
      <code>5º Conceito &lt; 5</code> → ❌ Reprovado.
      &nbsp;&nbsp;
      <strong>Recuperação:</strong>
      <code>Média 1º Sem &lt; 5</code> → 🟠 Rec. 1º Sem &nbsp;|&nbsp;
      <code>Média 2º Sem &lt; 5</code> → 🟠 Rec. 2º Sem &nbsp;|&nbsp;
      <code>Ambos &lt; 5</code> → 🟠🟠 Rec. 1º e 2º Sem &nbsp;|&nbsp;
      <code>Ambos ≥ 5</code> → ⚪ Sem Recuperação.
      <br><small>As regras são independentes: o aluno pode estar <b>Aprovado</b> E em <b>Recuperação</b> (inclusive nos dois semestres ao mesmo tempo).</small>
      <br><strong>🏫 Média da Sala</strong>: linha azul no final da tabela com a média do 5º Conceito, bimestres, <strong>recuperação</strong>, frequência e a situação da turma em cada disciplina. A tabela <strong>Média da Sala por Bimestre</strong> mostra a média por bimestre de cada disciplina.
    </div>
  `;
    }

    // Exporta o boletim final da turma selecionada em Excel (.xlsx)
    function exportarBoletimExcel() {
      const turmaId = document.getElementById('select-turma-boletim').value;
      const btn = document.getElementById('btn-exportar-boletim');
      if (!turmaId) {
        if (btn) btn.disabled = true;
        alert('Selecione uma turma para exportar o boletim.');
        return;
      }
      const turma = getTurma(turmaId);
      if (!turma) return;

      // ----- Professor exporta APENAS as disciplinas dele nesta turma -----
      let disciplinasVisiveis = (turma.disciplinas || []);
      if (perfilAtual === 'professor' && professorLogado) {
        const discIdsProfessor = getDisciplinasProfessor()
          .filter(d => d.turmaId === turmaId)
          .map(d => d.discId);
        disciplinasVisiveis = (turma.disciplinas || []).filter(d => discIdsProfessor.includes(d.id));
        if (disciplinasVisiveis.length === 0) {
          alert('O professor ' + professorLogado.nome + ' não possui disciplinas nesta turma.');
          return;
        }
      }

      exportarBoletimExcelInterno(turma, disciplinasVisiveis, false);
    }

    // Exporta o boletim final da turma selecionada em PDF (A4 paisagem, tabela nativa — nada é cortado)
    function exportarBoletimPDF() {
      const turmaId = document.getElementById('select-turma-boletim').value;
      const btn = document.getElementById('btn-exportar-boletim-pdf');
      if (!turmaId) {
        if (btn) btn.disabled = false;
        alert('Selecione uma turma para exportar o boletim.');
        return;
      }
      const turma = getTurma(turmaId);
      if (!turma || !turma.disciplinas || !turma.alunos) return;
      if (!turma.conceitosFinais) turma.conceitosFinais = {};

      const { jsPDF } = (window.jspdf || {});
      let autoTableDisponivel = false;
      try {
        const probe = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        autoTableDisponivel = typeof probe.autoTable === 'function';
      } catch (e) { autoTableDisponivel = false; }
      if (!jsPDF || !autoTableDisponivel) {
        alert('A biblioteca de PDF não pôde ser carregada. Verifique sua conexão.');
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando PDF...'; }

      // ----- Professor exporta APENAS as disciplinas dele nesta turma -----
      let disc = (turma.disciplinas || []);
      if (perfilAtual === 'professor' && professorLogado) {
        const discIdsProfessor = getDisciplinasProfessor()
          .filter(x => x.turmaId === turmaId)
          .map(x => x.discId);
        disc = disc.filter(d => discIdsProfessor.includes(d.id));
        if (disc.length === 0) {
          alert('O professor ' + professorLogado.nome + ' não possui disciplinas nesta turma.');
          if (btn) { btn.disabled = false; btn.textContent = '🖨️ Exportar em PDF'; }
          return;
        }
      }

      exportarBoletimPDFInterno(turma, disc, false);
      if (btn) { btn.disabled = false; btn.textContent = '🖨️ Exportar em PDF'; }
    }

    // ====================== EXPORTAÇÃO INTERNA REUTILIZÁVEL ======================
    // Exporta boletim para Excel recebendo a turma e disciplinas diretamente (usado pelo admin e público)
    function exportarBoletimExcelInterno(turma, disciplinasVisiveis, isPublico = false) {
      if (typeof XLSX === 'undefined') {
        alert('A biblioteca para exportar Excel não pôde ser carregada. Verifique sua conexão.');
        return;
      }

      const header1 = ['Aluno'];
      disciplinasVisiveis.forEach(d => {
        header1.push(d.nome, '', '', '', '', '', '', '');
      });
      header1.push('Média Geral');

      const header2 = [''];
      disciplinasVisiveis.forEach(() => {
        header2.push('1ºB', '2ºB', '3ºB', '4ºB', '5º Conceito', 'Recuperação', 'Freq. (%)', 'Situação Final');
      });
      header2.push('');

      const rows = [header1, header2];

      turma.alunos.forEach(aluno => {
        const mediasAluno = [];
        const linha = [aluno.nome];
        const freqMediaAluno = getFrequenciaMediaNum(turma, aluno.id);
        disciplinasVisiveis.forEach(disc => {
          const n1 = turma.notas?.[1]?.[disc.id]?.[aluno.id];
          const n2 = turma.notas?.[2]?.[disc.id]?.[aluno.id];
          const n3 = turma.notas?.[3]?.[disc.id]?.[aluno.id];
          const n4 = turma.notas?.[4]?.[disc.id]?.[aluno.id];
          const v1 = (n1 === undefined || n1 === null) ? 0 : Number(n1);
          const v2 = (n2 === undefined || n2 === null) ? 0 : Number(n2);
          const v3 = (n3 === undefined || n3 === null) ? 0 : Number(n3);
          const v4 = (n4 === undefined || n4 === null) ? 0 : Number(n4);
          const mediaCalc = (v1 + v2 + v3 + v4) / 4;
          const editado = turma.conceitosFinais?.[aluno.id]?.[disc.id];
          const conceito = editado !== undefined && editado !== null ? Number(editado) : Number(mediaCalc.toFixed(1));
          mediasAluno.push(mediaCalc);
          const mediaSem1 = (v1 + v2) / 2;
          const mediaSem2 = (v3 + v4) / 2;
          const aprov = classificarAprovacao(conceito);
          const rec = classificarRecuperacao(mediaSem1, mediaSem2);
          linha.push(
            n1 !== undefined ? Number(n1) : null,
            n2 !== undefined ? Number(n2) : null,
            n3 !== undefined ? Number(n3) : null,
            n4 !== undefined ? Number(n4) : null,
            conceito,
            labelRecuperacao(rec),
            freqMediaAluno !== null ? Number(freqMediaAluno.toFixed(1)) : null,
            labelSituacaoFinal(getSituacaoFinal(turma, aluno.id, disc.id))
          );
        });
        const mediaGeral = mediasAluno.length ? (mediasAluno.reduce((a, b) => a + b, 0) / mediasAluno.length) : null;
        linha.push(mediaGeral !== null ? Number(mediaGeral.toFixed(2)) : null);
        rows.push(linha);
      });

      // Linha da Média da Sala
      const mediaSalaPorDisc = disciplinasVisiveis.map(disc => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const n1 = turma.notas?.[1]?.[disc.id]?.[aluno.id];
          const n2 = turma.notas?.[2]?.[disc.id]?.[aluno.id];
          const n3 = turma.notas?.[3]?.[disc.id]?.[aluno.id];
          const n4 = turma.notas?.[4]?.[disc.id]?.[aluno.id];
          const temNota = [n1, n2, n3, n4].some(n => n !== undefined && n !== null);
          if (!temNota) return;
          const editado = turma.conceitosFinais?.[aluno.id]?.[disc.id];
          const med = editado !== undefined && editado !== null ? Number(editado) : (Number(n1 || 0) + Number(n2 || 0) + Number(n3 || 0) + Number(n4 || 0)) / 4;
          soma += med; count++;
        });
        return count ? soma / count : null;
      });
      const mediaSalaBim = [1, 2, 3, 4].map(b => disciplinasVisiveis.map(disc => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const n = turma.notas?.[b]?.[disc.id]?.[aluno.id];
          if (n !== undefined && n !== null) { soma += Number(n); count++; }
        });
        return count ? soma / count : null;
      }));

      let freqSalaNum = null;
      {
        let somaF = 0, contF = 0;
        turma.alunos.forEach(al => {
          [1, 2, 3, 4].forEach(b => {
            const v = turma.frequencias?.[b]?.[al.id];
            if (v !== undefined && v !== null && v !== '') { somaF += Number(v); contF++; }
          });
        });
        if (contF) freqSalaNum = Number((somaF / contF).toFixed(1));
      }

      const linhaSala = ['🏫 Média da Sala'];
      disciplinasVisiveis.forEach((disc, di) => {
        const m = mediaSalaPorDisc[di];
        const c1 = mediaSalaBim[0][di];
        const c2 = mediaSalaBim[1][di];
        const c3 = mediaSalaBim[2][di];
        const c4 = mediaSalaBim[3][di];
        const sem1 = (c1 !== null || c2 !== null) ? ((c1 ?? 0) + (c2 ?? 0)) / 2 : null;
        const sem2 = (c3 !== null || c4 !== null) ? ((c3 ?? 0) + (c4 ?? 0)) / 2 : null;
        const recSala = (sem1 !== null || sem2 !== null) ? labelRecuperacao(classificarRecuperacao(sem1, sem2)) : '—';
        linhaSala.push(
          c1 !== null ? Number(c1.toFixed(1)) : null,
          c2 !== null ? Number(c2.toFixed(1)) : null,
          c3 !== null ? Number(c3.toFixed(1)) : null,
          c4 !== null ? Number(c4.toFixed(1)) : null,
          m !== null ? Number(m.toFixed(1)) : null,
          recSala,
          freqSalaNum,
          '—'
        );
      });
      const valsSala = mediaSalaPorDisc.filter(v => v !== null);
      linhaSala.push(valsSala.length ? Number((valsSala.reduce((a, b) => a + b, 0) / valsSala.length).toFixed(1)) : null);
      rows.push(linhaSala);

      const nomeArquivo = `Boletim_${turma.nome.replace(/[\\\/:*?"<>|]+/g, '').replace(/\s+/g, '_')}.xlsx`;

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);

      ws['!cols'] = [{ wch: 25 }];
      disciplinasVisiveis.forEach(() => ws['!cols'].push({ wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 34 }, { wch: 12 }, { wch: 26 }));
      ws['!cols'].push({ wch: 12 });

      XLSX.utils.book_append_sheet(wb, ws, 'Boletim');

      // Segunda aba: frequências por bimestre
      const freqRows = [['Aluno', '1ºB (%)', '2ºB (%)', '3ºB (%)', '4ºB (%)', 'Média (%)', 'Situação (>75 OK / =75 Limite / <75 Atenção)']];
      turma.alunos.forEach(al => {
        const f1 = getFrequenciaBimestre(turma, 1, al.id);
        const f2 = getFrequenciaBimestre(turma, 2, al.id);
        const f3 = getFrequenciaBimestre(turma, 3, al.id);
        const f4 = getFrequenciaBimestre(turma, 4, al.id);
        const media = getFrequenciaMediaNum(turma, al.id);
        freqRows.push([
          al.nome,
          f1 === '' ? null : Number(f1),
          f2 === '' ? null : Number(f2),
          f3 === '' ? null : Number(f3),
          f4 === '' ? null : Number(f4),
          media !== null ? Number(media.toFixed(1)) : null,
          media !== null ? labelFrequencia(classificarFrequencia(media)) : '—'
        ]);
      });
      const wsFreq = XLSX.utils.aoa_to_sheet(freqRows);
      wsFreq['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 42 }];
      XLSX.utils.book_append_sheet(wb, wsFreq, 'Frequências');

      XLSX.writeFile(wb, nomeArquivo);
    }

    // Exporta boletim para PDF recebendo a turma e disciplinas diretamente
    function exportarBoletimPDFInterno(turma, disciplinasVisiveis, isPublico = false) {
      const { jsPDF } = (window.jspdf || {});
      let autoTableDisponivel = false;
      try {
        const probe = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        autoTableDisponivel = typeof probe.autoTable === 'function';
      } catch (e) { autoTableDisponivel = false; }
      if (!jsPDF || !autoTableDisponivel) {
        alert('A biblioteca de PDF não pôde ser carregada. Verifique sua conexão.');
        return;
      }

      const N = disciplinasVisiveis.length;
      const vnota = (b, discId, a) => turma.notas?.[b]?.[discId]?.[a];
      const notaOuT = (n) => (n !== undefined && n !== null) ? Number(n).toFixed(1) : '—';

      const conceitoFinal = (a, discId) => {
        const editado = turma.conceitosFinais?.[a]?.[discId];
        if (editado !== undefined && editado !== null) return Number(editado);
        const v1 = vnota(1, discId, a) ?? 0, v2 = vnota(2, discId, a) ?? 0, v3 = vnota(3, discId, a) ?? 0, v4 = vnota(4, discId, a) ?? 0;
        return Number(((v1 + v2 + v3 + v4) / 4).toFixed(1));
      };
      const mediaCalcDisc = (a, discId) => {
        const v1 = vnota(1, discId, a) ?? 0, v2 = vnota(2, discId, a) ?? 0, v3 = vnota(3, discId, a) ?? 0, v4 = vnota(4, discId, a) ?? 0;
        return (v1 + v2 + v3 + v4) / 4;
      };
      const aprovPDF = (c) => (c !== undefined && c !== null && !isNaN(c)) ? (c >= 5 ? 'Aprovado' : 'Reprovado') : '—';
      const recLabel = (sit) => sit === 'rec1' ? 'Rec 1ºS' : sit === 'rec2' ? 'Rec 2ºS' : sit === 'rec1+rec2' ? 'Rec 1º+2ºS' : 'Sem Rec';
      const recPDF = (a, discId) => {
        const v1 = vnota(1, discId, a) ?? 0, v2 = vnota(2, discId, a) ?? 0, v3 = vnota(3, discId, a) ?? 0, v4 = vnota(4, discId, a) ?? 0;
        return recLabel(classificarRecuperacao((v1 + v2) / 2, (v3 + v4) / 2));
      };

      // Cabeçalho em 2 linhas
      const head1 = [{ content: 'Aluno', rowSpan: 2 }];
      disciplinasVisiveis.forEach(d => head1.push({ content: `${d.nome}\n(${d.professor})`, colSpan: 8 }));
      head1.push({ content: 'Média\nGeral', rowSpan: 2 });

      const head2 = [];
      disciplinasVisiveis.forEach(() => head2.push(
        { content: '1ºB' }, { content: '2ºB' }, { content: '3ºB' }, { content: '4ºB' },
        { content: '5º Conc' }, { content: 'Recup.' }, { content: 'Freq' }, { content: 'Situação Final' }
      ));

      const sitCurta = {
        aprovado_nota_freq: 'Aprov. Nota+Freq',
        aprovado_conselho: 'Aprov. Conselho',
        reprovado_nota: 'Reprov. Nota',
        reprovado_freq: 'Reprov. Freq'
      };

      // Linhas de cada aluno
      const body = [];
      turma.alunos.forEach(aluno => {
        const mediasAluno = [];
        const linha = [aluno.nome];
        const freqMedia = getFrequenciaMediaNum(turma, aluno.id);
        const freqTexto = freqMedia !== null
          ? freqMedia.toFixed(1) + '% ' + labelFrequencia(classificarFrequencia(freqMedia))
          : '—';
        disciplinasVisiveis.forEach(d => {
          const v1 = vnota(1, d.id, aluno.id), v2 = vnota(2, d.id, aluno.id), v3 = vnota(3, d.id, aluno.id), v4 = vnota(4, d.id, aluno.id);
          const c = conceitoFinal(aluno.id, d.id);
          mediasAluno.push(mediaCalcDisc(aluno.id, d.id));
          const sit = getSituacaoFinal(turma, aluno.id, d.id);
          linha.push(notaOuT(v1), notaOuT(v2), notaOuT(v3), notaOuT(v4), Number(c).toFixed(1), recPDF(aluno.id, d.id), freqTexto, sitCurta[sit] || '—');
        });
        const mg = mediasAluno.length ? (mediasAluno.reduce((a, b) => a + b, 0) / mediasAluno.length).toFixed(1) : '—';
        linha.push(mg);
        body.push(linha);
      });

      // Média da sala
      const mediaSalaPorDisc = disciplinasVisiveis.map(d => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const v1 = vnota(1, d.id, aluno.id), v2 = vnota(2, d.id, aluno.id), v3 = vnota(3, d.id, aluno.id), v4 = vnota(4, d.id, aluno.id);
          const tem = [v1, v2, v3, v4].some(n => n !== undefined && n !== null);
          if (!tem) return;
          soma += conceitoFinal(aluno.id, d.id); count++;
        });
        return count ? Number((soma / count).toFixed(1)) : null;
      });
      const linhaSala = ['Média da Sala'];
      let freqSalaPDF = '—';
      {
        let somaF = 0, contF = 0;
        turma.alunos.forEach(al => {
          [1, 2, 3, 4].forEach(b => {
            const v = turma.frequencias?.[b]?.[al.id];
            if (v !== undefined && v !== null && v !== '') { somaF += Number(v); contF++; }
          });
        });
        if (contF) {
          const mediaFSala = Number((somaF / contF).toFixed(1));
          freqSalaPDF = mediaFSala.toFixed(1) + '% ' + labelFrequencia(classificarFrequencia(mediaFSala));
        }
      }
      disciplinasVisiveis.forEach((d, di) => {
        const m = mediaSalaPorDisc[di];
        const mediaBimSala = (b) => {
          let s = 0, c = 0;
          turma.alunos.forEach(al => { const n = vnota(b, d.id, al.id); if (n !== undefined && n !== null) { s += Number(n); c++; } });
          return c ? s / c : null;
        };
        const b1 = mediaBimSala(1), b2 = mediaBimSala(2), b3 = mediaBimSala(3), b4 = mediaBimSala(4);
        const s1 = (b1 !== null || b2 !== null) ? ((b1 ?? 0) + (b2 ?? 0)) / 2 : null;
        const s2 = (b3 !== null || b4 !== null) ? ((b3 ?? 0) + (b4 ?? 0)) / 2 : null;
        const recSalaTxt = (s1 !== null || s2 !== null) ? recLabel(classificarRecuperacao(s1, s2)) : '—';
        linhaSala.push('', '', '', '', m !== null ? m.toFixed(1) : '—', recSalaTxt, freqSalaPDF, '—');
      });
      const vals = mediaSalaPorDisc.filter(v => v !== null);
      linhaSala.push(vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—');
      body.push(linhaSala);

      // Média da Sala por Bimestre
      const mediaSalaBimestreBoletim = [1, 2, 3, 4].map(b => disciplinasVisiveis.map(d => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const n = vnota(b, d.id, aluno.id);
          if (n !== undefined && n !== null) { soma += Number(n); count++; }
        });
        return count ? Number((soma / count).toFixed(1)) : null;
      }));

      // A4 paisagem
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const marginL = 8, marginR = 8;
      const contentW = pageW - marginL - marginR;

      const totalWeight = 3 + 8 * N + 1.5;
      const baseCol = contentW / totalWeight;
      const colWidths = [baseCol * 3];
      for (let i = 0; i < N; i++) {
        for (let c = 0; c < 8; c++) colWidths.push(baseCol);
      }
      colWidths.push(baseCol * 1.5);

      const fontSize = Math.max(4.5, Math.min(6.5, baseCol * 0.42));

      const turmaNome = turma.nome;

      // Título
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('Boletim Final — ' + turmaNome + (isPublico ? ' (Visualização Pública)' : ''), marginL, 9);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(90, 90, 90);
      doc.text(`Emitido em ${new Date().toLocaleDateString('pt-BR')} · Notas 0–10 · Recuperação: média do semestre < 5 · Frequências em % (mínimo 75%) · Situação Final definida manualmente`, marginL, 14);
      doc.setTextColor(0, 0, 0);

      doc.autoTable({
        startY: 17,
        head: [head1, head2],
        body: body,
        theme: 'grid',
        margin: { left: marginL, right: marginR, top: 15, bottom: 10 },
        styles: {
          font: 'helvetica',
          fontSize: fontSize,
          cellPadding: 1.2,
          halign: 'center',
          valign: 'middle',
          lineColor: [180, 180, 180],
          lineWidth: 0.15,
          textColor: [20, 20, 20],
          overflow: 'linebreak'
        },
        headStyles: {
          fillColor: [63, 81, 181],
          fontStyle: 'bold',
          textColor: [255, 255, 255],
          fontSize: fontSize
        },
        columnStyles: {
          0: { halign: 'left', cellPadding: { left: 2, right: 1, top: 1.2, bottom: 1.2 } }
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === body.length - 1) {
            data.cell.styles.fillColor = [227, 242, 253];
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [13, 71, 161];
          }
          if (data.section === 'body' && data.column.index === colWidths.length - 1) {
            data.cell.styles.fontStyle = 'bold';
          }
        },
        didDrawPage: () => {
          const pageCount = doc.internal.getNumberOfPages();
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(120, 120, 120);
          doc.text(`Página ${pageCount}`, doc.internal.pageSize.getWidth() - marginR, doc.internal.pageSize.getHeight() - 4, { align: 'right' });
          doc.text(`Boletim Final — ${turmaNome}`, marginL, doc.internal.pageSize.getHeight() - 4);
          doc.setTextColor(0, 0, 0);
        }
      });

      // Segunda tabela: Média da Sala por Bimestre
      const abaixo = (doc.lastAutoTable && doc.lastAutoTable.finalY) || 20;
      const fimTabela = abaixo + 8;
      const alturaPagina = doc.internal.pageSize.getHeight();
      if (fimTabela + 25 > alturaPagina) doc.addPage();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(33, 33, 33);
      doc.text('Média da Sala por Bimestre', marginL, fimTabela + 3);
      doc.setTextColor(0, 0, 0);

      const bimHead = [{ content: 'Bimestre', styles: { halign: 'left', fontStyle: 'bold' } }];
      disciplinasVisiveis.forEach(d => bimHead.push({ content: d.nome }));

      const bimBody = [1, 2, 3, 4].map(b => {
        const linha = [`${b}º Bimestre`];
        disciplinasVisiveis.forEach((d, di) => {
          const m = mediaSalaBimestreBoletim[b - 1][di];
          linha.push(m !== null ? m.toFixed(1) : '—');
        });
        return linha;
      });

      doc.autoTable({
        startY: fimTabela + 5,
        head: [bimHead],
        body: bimBody,
        theme: 'grid',
        margin: { left: marginL, right: marginR, top: 15, bottom: 10 },
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle', lineColor: [180, 180, 180], lineWidth: 0.15, textColor: [20, 20, 20] },
        headStyles: { fillColor: [25, 118, 210], fontStyle: 'bold', textColor: [255, 255, 255] },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
      });

      const nomeArquivo = `Boletim_${String(turmaNome).replace(/[\\\/:*?"<>|]+/g, '').replace(/\s+/g, '_')}.pdf`;
      doc.save(nomeArquivo);
    }

    // ====================== ESTATÍSTICAS ======================
    let statsCharts = {};

    /**
     * Aplica a regra de negócio da aprovação (baseada APENAS no 5º Conceito).
     *   - 5º Conceito >= 5  → APROVADO
     *   - 5º Conceito <  5  → REPROVADO
     *   - Sem dados        → INDETERMINADO (não classifica)
     */
    function classificarAprovacao(quintoConceito) {
      if (quintoConceito === null || quintoConceito === undefined) return 'indeterminado';
      return quintoConceito >= 5 ? 'aprovado' : 'reprovado';
    }

    /**
     * Aplica a regra de negócio da recuperação (baseada nas médias de semestre).
     * Independente da aprovação: um aluno pode estar aprovado E em recuperação ao
     * mesmo tempo (ex: 5º Conc=6 com Sem1=4 → Aprovado + Rec 1º Sem).
     * Um aluno pode estar em recuperação nos DOIS semestres simultaneamente.
     *
     * Retorna uma string com os semestres em recuperação concatenados:
     *   - 'nenhuma'      → ambos os semestres ≥ 5 (ou sem dados)
     *   - 'rec1'         → apenas 1º semestre < 5
     *   - 'rec2'         → apenas 2º semestre < 5
     *   - 'rec1+rec2'    → ambos os semestres < 5
     *   - 'indeterminado' → sem dados de semestre
     */
    function classificarRecuperacao(mediaSem1, mediaSem2) {
      const s1 = (mediaSem1 !== null && mediaSem1 !== undefined);
      const s2 = (mediaSem2 !== null && mediaSem2 !== undefined);
      const s1Baixo = s1 && mediaSem1 < 5;
      const s2Baixo = s2 && mediaSem2 < 5;
      if (s1Baixo && s2Baixo) return 'rec1+rec2';
      if (s1Baixo) return 'rec1';
      if (s2Baixo) return 'rec2';
      if (s1 || s2) return 'nenhuma';
      return 'indeterminado';
    }

    /**
     * Helper: classifica o aluno em UMA label curta de situação para a tabela.
     * (Combina aprovação + recuperação; a recuperação é exibida como sufixo.)
     */
    function classificarSituacao(quintoConceito, mediaSem1, mediaSem2) {
      const aprov = classificarAprovacao(quintoConceito);
      const rec = classificarRecuperacao(mediaSem1, mediaSem2);
      if (aprov === 'indeterminado' && rec === 'indeterminado') return 'indeterminado';
      return aprov + '|' + rec;
    }

    function labelAprovacao(sit) {
      switch (sit) {
        case 'aprovado': return '✅ Aprovado';
        case 'reprovado': return '❌ Reprovado';
        default: return '—';
      }
    }

    function labelRecuperacao(sit) {
      switch (sit) {
        case 'rec1': return '🟠 Recuperação (1º Semestre)';
        case 'rec2': return '🟠 Recuperação (2º Semestre)';
        case 'rec1+rec2': return '🟠🟠 Recuperação (1º e 2º Semestre)';
        case 'nenhuma': return '⚪ Sem Recuperação';
        case 'semRecuperacao': return '⚪ Sem Recuperação';
        default: return '—';
      }
    }

    // Mantém a função legada para a tabela do Boletim Final (uma única string por linha)
    function labelSituacao(sit) {
      if (!sit || sit === 'indeterminado') return '—';
      const [aprov, rec] = sit.split('|');
      const aprStr = labelAprovacao(aprov);
      const recStr = rec && rec !== 'semRecuperacao' ? ' • ' + labelRecuperacao(rec) : '';
      return aprStr + recStr;
    }

    function corSituacao(sit) {
      if (!sit) return '';
      const [aprov] = sit.split('|');
      switch (aprov) {
        case 'aprovado': return 'status-aprovado';
        case 'reprovado': return 'status-reprovado';
        default: return '';
      }
    }

    function abrirEstatisticas() {
      perfilAtual = null;
      professorLogado = null;
      document.getElementById('tela-login').style.display = 'none';
      document.getElementById('sistema-principal').style.display = 'none';
      document.getElementById('tela-estatisticas').style.display = 'block';
      carregarStorage();
      renderEstatisticas('livre');
    }

    function sairParaLogin() {
      document.getElementById('tela-estatisticas').style.display = 'none';
      document.getElementById('tela-login').style.display = 'block';
      document.getElementById('sistema-principal').style.display = 'none';
    }

    // ====================== BOLETIM PÚBLICO (somente leitura) ======================
    function abrirBoletimPublico() {
      perfilAtual = 'publico';
      professorLogado = null;
      document.getElementById('tela-login').style.display = 'none';
      document.getElementById('sistema-principal').style.display = 'none';
      document.getElementById('tela-estatisticas').style.display = 'none';
      document.getElementById('tela-boletim-publico').style.display = 'block';
      carregarStorage();
      popularSelectTurmasBoletimPublico();
      renderBoletimPublico();
    }

    function sairBoletimPublico() {
      perfilAtual = null;
      professorLogado = null;
      document.getElementById('tela-boletim-publico').style.display = 'none';
      document.getElementById('tela-login').style.display = 'block';
    }

    function atualizarBoletimPublico() {
      if (!estado.appsUrl) {
        alert('Nuvem não configurada. Os dados mostram apenas o armazenamento local.');
        return;
      }
      const btn = event?.target?.closest('button');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Atualizando...'; }
      carregarDaNuvem().then(function (dados) {
        if (dados) {
          aplicarDadosNuvem(dados, false); // false = não preservar locais (recarrega tudo da nuvem)
        }
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar'; }
      }).catch(function (e) {
        console.error('Erro ao atualizar:', e);
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar'; }
        alert('Falha ao recarregar da nuvem: ' + e.message);
      });
    }

    function popularSelectTurmasBoletimPublico() {
      const select = document.getElementById('select-turma-boletim-publico');
      if (!select) return;
      const valorAtual = select.value;
      select.innerHTML = '<option value="">-- Selecione uma turma --</option>';
      Object.entries(estado.turmas || {}).forEach(([id, turma]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = turma.nome;
        select.appendChild(opt);
      });
      if (valorAtual) select.value = valorAtual;
    }

    function renderBoletimPublico() {
      const container = document.getElementById('tabela-boletim-publico-container');
      const turmaId = document.getElementById('select-turma-boletim-publico').value;
      const btnExportar = document.getElementById('btn-exportar-boletim-publico');
      if (btnExportar) btnExportar.disabled = !turmaId;
      const btnExportarPdf = document.getElementById('btn-exportar-boletim-publico-pdf');
      if (btnExportarPdf) btnExportarPdf.disabled = !turmaId;

      const tituloEl = document.getElementById('boletim-publico-titulo');
      const atualizadoEl = document.getElementById('boletim-publico-atualizado');

      if (!turmaId) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">📊</div><p>Selecione uma turma para visualizar o boletim final.</p></div>';
        if (tituloEl) tituloEl.textContent = 'Selecione uma turma';
        return;
      }

      const turma = getTurma(turmaId);
      if (!turma) { container.innerHTML = '<div class="error-box">Turma não encontrada.</div>'; return; }

      if (tituloEl) tituloEl.textContent = `Boletim Final — ${esc(turma.nome)}`;
      if (atualizadoEl) atualizadoEl.textContent = new Date().toLocaleString('pt-BR');

      // Reusa a lógica do boletim final, mas força modo somente leitura
      // O renderBoletimFinal já verifica perfilAtual para editar; como é 'publico', será só leitura
      // Vou chamar uma versão adaptada inline para evitar conflitos de IDs

      // Disciplinas visíveis = todas
      const disciplinasVisiveis = (turma.disciplinas || []);
      if (!turma.conceitosFinais) turma.conceitosFinais = {};

      // Médias da sala (5º conceito por disciplina)
      const mediaSalaPorDiscBoletim = disciplinasVisiveis.map(disc => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const n1 = turma.notas?.[1]?.[disc.id]?.[aluno.id];
          const n2 = turma.notas?.[2]?.[disc.id]?.[aluno.id];
          const n3 = turma.notas?.[3]?.[disc.id]?.[aluno.id];
          const n4 = turma.notas?.[4]?.[disc.id]?.[aluno.id];
          const a1 = (n1 === undefined || n1 === null) ? 0 : Number(n1);
          const a2 = (n2 === undefined || n2 === null) ? 0 : Number(n2);
          const a3 = (n3 === undefined || n3 === null) ? 0 : Number(n3);
          const a4 = (n4 === undefined || n4 === null) ? 0 : Number(n4);
          const temNota = [n1, n2, n3, n4].some(n => n !== undefined && n !== null);
          if (!temNota) return;
          const editado = turma.conceitosFinais?.[aluno.id]?.[disc.id];
          const med = editado !== undefined && editado !== null ? Number(editado) : (a1 + a2 + a3 + a4) / 4;
          soma += med; count++;
        });
        return count ? Number((soma / count).toFixed(1)) : null;
      });

      // Média da sala por bimestre por disciplina
      const mediaSalaBimestreBoletim = [1, 2, 3, 4].map(b => disciplinasVisiveis.map(disc => {
        let soma = 0, count = 0;
        turma.alunos.forEach(aluno => {
          const n = turma.notas?.[b]?.[disc.id]?.[aluno.id];
          if (n !== undefined && n !== null) { soma += Number(n); count++; }
        });
        return count ? Number((soma / count).toFixed(1)) : null;
      }));

      container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="aluno-hdr" rowspan="2" style="background:#1b2740; color:#e6ebf5;">Aluno</th>
            ${disciplinasVisiveis.map(d => `
              <th class="disc-col" colspan="8" style="text-align:center; background:#1b2740;">
                <div class="disc-header-info">
                  <strong style="color:#e6ebf5;">${esc(d.nome)}</strong>
                  <small style="color:#8fa0bd;">Prof: ${esc(d.professor)}</small>
                </div>
              </th>
            `).join('')}
            <th rowspan="2" style="background:#1a237e; color:#e6ebf5; min-width:100px;">Média Geral</th>
          </tr>
          <tr>
            ${disciplinasVisiveis.map(() => `
              <th style="background:#1b2740; color:#e6ebf5; font-size:10px; padding:5px;">1ºB</th>
              <th style="background:#1b2740; color:#e6ebf5; font-size:10px; padding:5px;">2ºB</th>
              <th style="background:#1b2740; color:#e6ebf5; font-size:10px; padding:5px;">3ºB</th>
              <th style="background:#1b2740; color:#e6ebf5; font-size:10px; padding:5px;">4ºB</th>
              <th style="background:#143d2e; color:#e6ebf5; font-size:10px; padding:5px;">5º Conceito</th>
              <th style="background:#3d2a0e; color:#e6ebf5; font-size:10px; padding:5px;">Recuperação</th>
              <th style="background:#0e2d4d; color:#e6ebf5; font-size:10px; padding:5px;">Freq. (%)</th>
              <th style="background:#2a1040; color:#e6ebf5; font-size:10px; padding:5px;">Situação Final</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${turma.alunos.map(aluno => {
        const mediasAluno = [];
        const linhaDisciplinas = disciplinasVisiveis.map(disc => {
          const n1 = turma.notas?.[1]?.[disc.id]?.[aluno.id];
          const n2 = turma.notas?.[2]?.[disc.id]?.[aluno.id];
          const n3 = turma.notas?.[3]?.[disc.id]?.[aluno.id];
          const n4 = turma.notas?.[4]?.[disc.id]?.[aluno.id];
          // 5º Conceito: nota ausente = 0, denominador fixo 4
          const v1 = (n1 === undefined || n1 === null) ? 0 : Number(n1);
          const v2 = (n2 === undefined || n2 === null) ? 0 : Number(n2);
          const v3 = (n3 === undefined || n3 === null) ? 0 : Number(n3);
          const v4 = (n4 === undefined || n4 === null) ? 0 : Number(n4);
          const mediaCalc = (v1 + v2 + v3 + v4) / 4;
          const notasLancadas = [n1, n2, n3, n4].filter(n => n !== undefined && n !== null);
          const conceitoFinalSalvo = turma.conceitosFinais?.[aluno.id]?.[disc.id];
          const conceitoFinalNum = conceitoFinalSalvo !== undefined
            ? Number(conceitoFinalSalvo)
            : Number(mediaCalc.toFixed(1));
          mediasAluno.push(mediaCalc);
          // Médias de semestre: nota ausente = 0, denominador fixo 2
          const mediaSem1 = (v1 + v2) / 2;
          const mediaSem2 = (v3 + v4) / 2;
          const aprovDisc = classificarAprovacao(conceitoFinalNum);
          const recDisc = classificarRecuperacao(mediaSem1, mediaSem2);
          const aprCor = aprovDisc === 'aprovado' ? 'status-aprovado' : (aprovDisc === 'reprovado' ? 'status-reprovado' : '');
          const recCor = (recDisc === 'rec1' || recDisc === 'rec2' || recDisc === 'rec1+rec2') ? 'status-recuperacao' : '';
          // Somente leitura: sem inputs editáveis
          return `
                <td>${n1 !== undefined ? Number(n1).toFixed(1) : '—'}</td>
                <td>${n2 !== undefined ? Number(n2).toFixed(1) : '—'}</td>
                <td>${n3 !== undefined ? Number(n3).toFixed(1) : '—'}</td>
                <td>${n4 !== undefined ? Number(n4).toFixed(1) : '—'}</td>
                <td style="background:#143d2e;">
                  <span title="5º Conceito — média automática dos 4 bimestres"
                    style="font-weight:700; color:#6ee7b7;">${conceitoFinalNum !== null ? Number(conceitoFinalNum).toFixed(1) : '—'}</span>
                </td>
                <td class="${recCor}" style="font-size:11px; padding:4px;">${labelRecuperacao(recDisc)}</td>
                <td style="font-size:11px; padding:4px; text-align:center;">${getFrequenciaMedia(turma, aluno.id)}</td>
                <td>
                  ${(() => {
            const sit = getSituacaoFinal(turma, aluno.id, disc.id);
            if (sit) {
              return `<span style="color:${corSituacaoFinal(sit)}; font-weight:700;">${labelSituacaoFinal(sit)}</span>`;
            }
            return '<span style="color:#8fa0bd;">—</span>';
          })()}
                </td>
              `;
        }).join('');
        const mediaGeral = mediasAluno.length ? (mediasAluno.reduce((a, b) => a + b, 0) / mediasAluno.length).toFixed(1) : '—';
        return `
              <tr style="background:#131c31;">
                <td class="aluno-cell">${esc(aluno.nome)}</td>
                ${linhaDisciplinas}
                <td style="background:#1b2740; font-weight:700; color:#e6ebf5;">${mediaGeral}</td>
              </tr>
            `;
      }).join('')}
          <tr style="background:#1a233e; font-weight:700;">
            <td class="aluno-cell" style="background:#162038;">🏫 Média da Sala</td>
            ${disciplinasVisiveis.map((disc, di) => {
        const m = mediaSalaPorDiscBoletim[di];
        const c1 = mediaSalaBimestreBoletim[0][di];
        const c2 = mediaSalaBimestreBoletim[1][di];
        const c3 = mediaSalaBimestreBoletim[2][di];
        const c4 = mediaSalaBimestreBoletim[3][di];
        const freqMedia = getFrequenciaMediaSalaNum(turma);
        const sitSala = m !== null ? classificarAprovacao(m) : null;
        const sitCor = sitSala === 'aprovado' ? 'status-aprovado' : (sitSala === 'reprovado' ? 'status-reprovado' : '');
        return `
                <td style="color:#b9c9ff;">${c1 !== null ? c1.toFixed(1) : '—'}</td>
                <td style="color:#b9c9ff;">${c2 !== null ? c2.toFixed(1) : '—'}</td>
                <td style="color:#b9c9ff;">${c3 !== null ? c3.toFixed(1) : '—'}</td>
                <td style="color:#b9c9ff;">${c4 !== null ? c4.toFixed(1) : '—'}</td>
                <td style="background:#143d2e;"><span style="font-weight:700; color:#6ee7b7;">${m !== null ? m.toFixed(1) : '—'}</span></td>
                <td class="${sitCor}" style="font-size:11px; padding:4px;">${sitSala ? labelSituacao(sitSala) : '—'}</td>
                <td style="font-size:11px; padding:4px; text-align:center;">${freqMedia !== null ? freqMedia.toFixed(1) : '—'}</td>
                <td style="color:${corSituacaoFinal(sitSala ? (sitSala === 'aprovado' ? 'aprovado_nota_freq' : 'reprovado_nota') : null)}; font-weight:700;">${sitSala ? labelSituacaoFinal(sitSala === 'aprovado' ? 'aprovado_nota_freq' : 'reprovado_nota') : '—'}</td>
              `;
      }).join('')}
            <td style="background:#1b2740; color:#e6ebf5; font-weight:700;">${disciplinasVisiveis.length ? (mediaSalaPorDiscBoletim.filter(x => x !== null).reduce((a, b) => a + b, 0) / mediaSalaPorDiscBoletim.filter(x => x !== null).length).toFixed(1) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
    ${disciplinasVisiveis.length > 1 ? `
    <div style="margin-top:24px;">
      <h4 style="color:#b9c9ff; border-bottom:2px solid #5b7cfa; padding-bottom:6px;">🏫 Média da Sala por Bimestre</h4>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style="background:#1b2740; color:#e6ebf5;">Disciplina</th>
              <th style="background:#1b2740; color:#e6ebf5;">1º Bimestre</th>
              <th style="background:#1b2740; color:#e6ebf5;">2º Bimestre</th>
              <th style="background:#1b2740; color:#e6ebf5;">3º Bimestre</th>
              <th style="background:#1b2740; color:#e6ebf5;">4º Bimestre</th>
            </tr>
          </thead>
          <tbody>
            ${disciplinasVisiveis.map((disc, di) => `
              <tr style="background:#131c31;">
                <td style="font-weight:600; color:#e6ebf5;">${esc(disc.nome)}</td>
                <td style="color:#b9c9ff;">${mediaSalaBimestreBoletim[0][di] !== null ? mediaSalaBimestreBoletim[0][di].toFixed(1) : '—'}</td>
                <td style="color:#b9c9ff;">${mediaSalaBimestreBoletim[1][di] !== null ? mediaSalaBimestreBoletim[1][di].toFixed(1) : '—'}</td>
                <td style="color:#b9c9ff;">${mediaSalaBimestreBoletim[2][di] !== null ? mediaSalaBimestreBoletim[2][di].toFixed(1) : '—'}</td>
                <td style="color:#b9c9ff;">${mediaSalaBimestreBoletim[3][di] !== null ? mediaSalaBimestreBoletim[3][di].toFixed(1) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}
      `;
    }

    // Exportar boletim público para Excel (reusa lógica existente)
    function exportarBoletimPublicoExcel() {
      const turmaId = document.getElementById('select-turma-boletim-publico').value;
      if (!turmaId) { alert('Selecione uma turma primeiro.'); return; }
      const turma = getTurma(turmaId);
      if (!turma) return;
      const disciplinasVisiveis = (turma.disciplinas || []);
      exportarBoletimExcelInterno(turma, disciplinasVisiveis, true);
    }

    function exportarBoletimPublicoPDF() {
      const turmaId = document.getElementById('select-turma-boletim-publico').value;
      if (!turmaId) { alert('Selecione uma turma primeiro.'); return; }
      const turma = getTurma(turmaId);
      if (!turma) return;
      const disciplinasVisiveis = (turma.disciplinas || []);
      exportarBoletimPDFInterno(turma, disciplinasVisiveis, true);
    }

    function destruirCharts(prefix) {
      Object.keys(statsCharts).forEach(k => {
        if (k.startsWith(prefix + ':') && statsCharts[k]) {
          statsCharts[k].destroy();
          delete statsCharts[k];
        }
      });
    }

    function getEscopoEstatisticas() {
      const escopo = {
        turmaId: '',
        disciplinaId: '',
        bimestre: '',
        alunoId: '',
        professorOnly: false,
        titulo: 'Visão Geral do Desempenho',
        badge: 'Acesso Livre'
      };
      if (perfilAtual === 'professor' && professorLogado) {
        escopo.professorOnly = true;
        escopo.titulo = `Minhas Estatísticas — ${professorLogado.nome}`;
        escopo.badge = 'Professor';
      } else if (perfilAtual === 'admin') {
        escopo.titulo = 'Visão Geral do Desempenho';
        escopo.badge = 'Administrador';
      }
      return escopo;
    }

    function getTurmasFiltradas(escopo) {
      let turmas = Object.entries(estado.turmas).map(([id, t]) => ({ id, ...t }));
      if (escopo.professorOnly) {
        const turmaIds = new Set(getDisciplinasProfessor().map(d => d.turmaId));
        turmas = turmas.filter(t => turmaIds.has(t.id));
      }
      return turmas;
    }

    function getDisciplinasFiltradas(turma, escopo) {
      if (escopo.professorOnly) {
        const discIds = new Set(
          getDisciplinasProfessor()
            .filter(d => d.turmaId === turma.id)
            .map(d => d.discId)
        );
        return turma.disciplinas.filter(d => discIds.has(d.id));
      }
      return turma.disciplinas;
    }

    function calcularMediaAluno(turma, alunoId, discIds, bimestreAlvo) {
      let soma = 0, qtd = 0;
      const bimestres = bimestreAlvo ? [Number(bimestreAlvo)] : [1, 2, 3, 4];
      bimestres.forEach(b => {
        discIds.forEach(discId => {
          const nota = turma.notas?.[b]?.[discId]?.[alunoId];
          if (nota !== undefined && nota !== null) { soma += nota; qtd++; }
        });
      });
      return qtd ? soma / qtd : null;
    }

    function mostrarAbaStats(suffix, aba) {
      const analises = document.getElementById('stats-analises' + suffix);
      const ajuda = document.getElementById('stats-ajuda' + suffix);
      if (!analises || !ajuda) return;
      const mostrarAnalises = (aba === 'analises');
      analises.style.display = mostrarAnalises ? '' : 'none';
      ajuda.style.display = mostrarAnalises ? 'none' : '';
      const tabs = document.querySelectorAll('.stats-tabs .stats-tab');
      tabs.forEach(t => {
        const alvo = t.getAttribute('data-tab');
        const pertence = t.closest('.stats-wrap');
        const contem = pertence && (pertence.querySelector('#stats-analises' + suffix) || pertence.querySelector('#stats-ajuda' + suffix));
        if (contem) t.classList.toggle('active', alvo === aba);
      });
    }

    function montarAjudaEstatisticas() {
      const m = (titulo, def, ex) =>
        `<div class="metrica">
       <h4>${titulo}</h4>
       <div class="def">${def}</div>
       ${ex ? `<div class="exemplo"><b>Exemplo:</b> ${ex}</div>` : ''}
     </div>`;

      return `<div class="ajuda-wrap">
    <h3>📖 Como as estatísticas são calculadas</h3>
    <p style="font-size:13px; color:#555; line-height:1.6;">
      Abaixo você encontra a explicação de cada número exibido nas estatísticas e como ele é calculado.
      Todos os exemplos usam uma turma com <b>4 bimestres</b> e um aluno chamado <b>Ana</b> na disciplina
      <b>Matemática</b> com as notas: <b>8,0 · 6,0 · 10,0 · 7,0</b>.
    </p>

    <h3>🧮 Conceitos básicos</h3>
    ${m('5º Conceito (Conceito Final de cada disciplina)',
        'É a média que define o resultado do aluno em uma disciplina. É calculado pela média aritmética das notas dos <b>4 bimestres</b>. Se algum bimestre ficou sem nota, ele vale <b>0</b> (não é ignorado). Se o professor <b>editou</b> o conceito final na tela de Boletim, o valor editado é usado em vez da média.',
        `Ana: (8,0 + 6,0 + 10,0 + 7,0) ÷ 4 = <b>7,75</b>. Arredondado a 1 casa = <b>7,8</b>.`)
        }
    ${m('Aprovação (Aprovado / Reprovado)',
          'Usa o <b>5º Conceito arredondado a 1 casa</b>. Conceito ≥ 5 = <b>Aprovado</b>; conceito < 5 = <b>Reprovado</b>. O valor obrigatoriamente é arredondado para a classificação.',
          `Ana com 7,8 → Aprovado. Um aluno com 4,9 → Reprovado.`)
        }
    ${m('Recuperação',
          'Usa a <b>média do semestre</b> (média da 1º+2º ou 3º+4º), <b>sem arredondar</b>. Aluno em recuperação quando a média de alguma metade do ano é <b>&lt; 5</b>. <b>1ª Recuperação</b> = 1º semestre < 5; <b>2ª Recuperação</b> = 2º semestre < 5.',
          `Se Ana tiver 8 + 6 no 1º semestre: (8+6)÷2 = <b>7,0</b> → sem recuperação no 1º semestre.`)
        }
    ${m('Importante: Aprovação e Recuperação são independentes',
          'Um aluno pode estar <b>Aprovado</b> e ainda assim estar em <b>Recuperação</b>, porque as duas regras são calculadas separadamente (uma pela média do ano, outra pela do semestre).',
          `Maria tem 5º Conceito 5,3 (Aprovado), mas apenas 4,8 no 1º semestre → aparece nos dois grupos.`)
        }

    <h3>📊 Métricas da sala</h3>
    ${m('Média Geral da Turma (KPI)',
          'É a média dos <b>5º Conceitos</b> de todos os alunos em todas as disciplinas analisadas — o mesmo valor base do Boletim Final. Como o 5º Conceito já trata bimestre sem nota como <b>0</b>, esse número considera tudo e divide pelo total.',
          `Se Ana tem 7,8, Bruno 4,5 e Carlos 6,2 → (7,8+4,5+6,2)÷3 = <b>6,17</b>.`)
        }
    ${m('Média Geral por Bimestre',
          'Para cada bimestre soma-se a nota de <b>todos</b> os alunos (aluno × disciplina) e divide pelo <b>total</b> de alunos×disciplinas. Bimestre sem nota ou com traço conta como <b>0</b>. Mostra a evolução da turma no ano.',
          `Turma com 4 alunos×disciplinas; bim. 1 tem notas 8, 7, 6 e um vazio (0) → (8+7+6+0)÷4 = <b>5,25</b>.`)
        }
    ${m('Média da Sala por Disciplina (Média do 5º Conceito)',
          'É a média dos <b>5º Conceitos</b> dos alunos naquela disciplina. Alunos sem <b>nenhuma</b> nota na disciplina não entram no cálculo; para quem tem nota, bimestre vazio vale 0.',
          `Na Matemática: Ana 7,8; Bruno 4,5; Carlos 6,2 → (7,8+4,5+6,2)÷3 = <b>6,17</b>.`)
        }
    ${m('Min / Média / Máx por Disciplina',
          '<b>Mínima</b> e <b>Máxima</b> = menor e maior nota individual lançada na disciplina (aluno × bimestre). <b>Média</b> = média dos 5º Conceitos (igual ao item acima).',
          `Notas de Ana 8, 6, 10, 7 e Bruno 5, 4, 6, 5 → mínima <b>4</b>, máxima <b>10</b>.`)
        }
    ${m('Média por Disciplina × Bimestre',
          'Para cada disciplina e cada bimestre, soma-se a nota de todos os alunos (vazio = 0) e divide pelo total de alunos da disciplina. Usado no gráfico de barras agrupadas e no radar.',
          `Matemática, bim. 1: Ana 8, Bruno 5, Carlos sem nota (0) → (8+5+0)÷3 = <b>4,33</b>.`)
        }
    ${m('Aprovação × Reprovação (total da turma)',
          'Conta quantos alunos ficaram <b>Aprovados</b> e quantos <b>Reprovados</b> usando a regra do 5º Conceito arredondado. O gráfico de pizza mostra essa proporção.',
          `De 20 alunos, 15 Aprovados e 5 Reprovados → 75% × 25%.`)
        }
    ${m('Distribuição Geral de Notas (donut)',
          'Classifica <b>cada nota individual lançada</b> em faixas (ex.: 0–4,9 · 5–6,9 · 7–10) e mostra o percentual de quantas notas caem em cada faixa.',
          `Se 8 de 40 notas estão entre 7 e 10 → <b>20%</b> na faixa verde.`)
        }
    ${m('Média por Turma',
          'Para cada turma, calcula a média dos <b>5º Conceitos</b> de todos os alunos em todas as disciplinas. Permite comparar o desempenho entre turmas.',
          `Turma A média 6,8 · Turma B média 7,4 → B tem melhor desempenho geral.`)
        }

    <h3>📚 Média do aluno por disciplina</h3>
    ${m('Média Geral do Aluno por Disciplina',
          'Para cada aluno, mostra a média de cada disciplina (seu 5º Conceito) e a <b>Média Geral</b>, que é a média dos 5º Conceitos de todas as suas disciplinas. Cores: <span style="color:#2e7d32;font-weight:700;">verde ≥ 7</span> · <span style="color:#ef6c00;font-weight:700;">laranja 5–6,9</span> · <span style="color:#c62828;font-weight:700;">vermelho &lt; 5</span>.',
          `Ana em Matemática 7,8 e Português 6,4 → Média Geral (7,8+6,4)÷2 = <b>7,1</b> (verde).`)
        }

    <h3>🏆 Rankings</h3>
    ${m('Melhores e Piores Alunos',
          'Todos os alunos são ordenados pela sua <b>Média Geral</b> (média dos 5º Conceitos de suas disciplinas). Os melhores têm as maiores médias; os piores, as menores.',
          `Ana 7,1 · Bruno 5,0 · Carlos 8,3 → Melhores: Carlos, Ana; Piores: Bruno.`)
        }
    ${m('⚠️ Alunos em Situação Crítica',
          'Alunos com <b>média geral &lt; 5</b> OU que estão em <b>recuperação</b>. Maior prioridade de atenção da turma.',
          `Aluno com média geral 4,8 ou com 1ª recuperação entra aqui.`)
        }
    ${m('📋 Alunos em Recuperação / Situação Crítica (detalhado)',
          'Tabela detalhada listando, por disciplina, os alunos em recuperação com suas médias de semestre e o 5º Conceito. Ajuda o professor a decidir quem precisa de reforço.',
          `Ana: Matemática 1ª Rec. média 7,0 / 2ª Rec. média 8,5.`)
        }

    <h3>📤 Exportação</h3>
    ${m('Exportar Boletim em Excel (aba Boletim Final)',
          'Gera um arquivo <code>.xlsx</code> com o boletim completo da turma, pronto para abrir no Excel. O nome do arquivo usa o nome da turma (ex.: <code>Boletim_1º_Ano_A.xlsx</code>).',
          `Clique no botão "Exportar Boletim em Excel" na aba Boletim Final.`)
        }
  </div>`;
    }

    function renderEstatisticas(origem) {
      const suffix = origem === 'sistema' ? '-sistema' : '';
      const escopo = getEscopoEstatisticas();
      // Usa o MESMO sufixo das chaves registradas em makeChart (':…' ou '-sistema:…');
      // passando 'origem' o prefixo nunca casava e nada era destruído.
      destruirCharts(suffix);

      // Cabeçalho
      const tituloEl = document.getElementById('stats-titulo' + suffix);
      const badgeEl = document.getElementById('stats-escopo-badge' + suffix);
      const atualEl = document.getElementById('stats-atualizado-em' + suffix);
      if (tituloEl) tituloEl.textContent = escopo.titulo;
      if (badgeEl) badgeEl.textContent = escopo.badge;
      if (atualEl) atualEl.textContent = new Date().toLocaleString('pt-BR');

      // Filtros
      const turmas = getTurmasFiltradas(escopo);
      const selTurma = document.getElementById('stats-filter-turma' + suffix);
      const selDisc = document.getElementById('stats-filter-disciplina' + suffix);
      const selBim = document.getElementById('stats-filter-bimestre' + suffix);
      const selAluno = document.getElementById('stats-filter-aluno' + suffix);
      const turmaIdEscolhida = selTurma ? selTurma.value : '';
      const discIdEscolhida = selDisc ? selDisc.value : '';
      const alunoIdEscolhido = selAluno ? selAluno.value : '';
      const bimestreEscolhido = selBim ? selBim.value : '';

      escopo.turmaId = turmaIdEscolhida;
      escopo.disciplinaId = discIdEscolhida;
      escopo.alunoId = alunoIdEscolhido;
      escopo.bimestre = bimestreEscolhido;

      // Popula select de turmas
      if (selTurma) {
        selTurma.innerHTML = '<option value="">Todas</option>' +
          turmas.map(t => `<option value="${t.id}" ${t.id === turmaIdEscolhida ? 'selected' : ''}>${esc(t.nome)}</option>`).join('');
      }

      // Evita filtro "fantasma": se a turma escolhida não existe mais (foi excluída
      // ou o professor perdeu o vínculo com ela), limpa — senão nada seria calculado.
      if (turmaIdEscolhida && !turmas.find(t => t.id === turmaIdEscolhida)) {
        escopo.turmaId = '';
        if (selTurma) selTurma.value = '';
      }

      // Disciplinas dependem da turma escolhida
      let turmasParaDisciplinas = turmas;
      if (escopo.turmaId) turmasParaDisciplinas = turmas.filter(t => t.id === escopo.turmaId);
      const todasDiscs = [];
      turmasParaDisciplinas.forEach(t => {
        getDisciplinasFiltradas(t, escopo).forEach(d => {
          if (!todasDiscs.find(x => x.id === d.id)) todasDiscs.push(d);
        });
      });
      if (selDisc) {
        selDisc.innerHTML = '<option value="">Todas</option>' +
          todasDiscs.map(d => `<option value="${d.id}" ${d.id === discIdEscolhida ? 'selected' : ''}>${esc(d.nome)}</option>`).join('');
      }

      // Alunos
      let alunosTodas = [];
      turmasParaDisciplinas.forEach(t => {
        t.alunos.forEach(a => {
          if (!alunosTodas.find(x => x.id === a.id)) alunosTodas.push(a);
        });
      });
      if (selAluno) {
        selAluno.innerHTML = '<option value="">Todos</option>' +
          alunosTodas.map(a => `<option value="${a.id}" ${a.id === alunoIdEscolhido ? 'selected' : ''}>${esc(a.nome)}</option>`).join('');
      }

      // Filtro "fantasma": disciplina/aluno que não existe mais na nova seleção
      // (ex.: trocou de turma) continuaria sendo aplicado ao cálculo e deixaria
      // TUDO vazio ("não puxando as disciplinas"). Limpa aqui, antes de calcular.
      if (discIdEscolhida && !todasDiscs.find(d => d.id === discIdEscolhida)) {
        escopo.disciplinaId = '';
        if (selDisc) selDisc.value = '';
      }
      if (alunoIdEscolhido && !alunosTodas.find(a => a.id === alunoIdEscolhido)) {
        escopo.alunoId = '';
        if (selAluno) selAluno.value = '';
      }

      // Bind change apenas uma vez (remover para re-bind)
      ['turma', 'disciplina', 'bimestre', 'aluno'].forEach(f => {
        const el = document.getElementById('stats-filter-' + f + suffix);
        if (el && !el.dataset.bound) {
          el.addEventListener('change', () => renderEstatisticas(origem));
          el.dataset.bound = '1';
        }
      });

      // Calcula agregados
      const dados = calcularDadosEstatisticas(escopo, turmas);

      // KPIs
      renderKPIs(dados, suffix);

      // Análise textual
      renderAnaliseTextual(dados, suffix);

      // Gráficos (cada um protegido para não interromper os seguintes)
      safeRender(suffix, 'chart-evolucao', () => renderChartEvolucao(dados, suffix));
      safeRender(suffix, 'chart-aprovados', () => renderChartAprovados(dados, suffix));
      safeRender(suffix, 'chart-notas-donut', () => renderChartNotasDonut(dados, suffix));
      safeRender(suffix, 'chart-turmas', () => renderChartTurmas(dados, suffix));
      safeRender(suffix, 'chart-disciplinas', () => renderChartDisciplinas(dados, suffix));
      safeRender(suffix, 'chart-minmax', () => renderChartMinMax(dados, suffix));
      safeRender(suffix, 'chart-disc-bim', () => renderChartDiscBim(dados, suffix));
      safeRender(suffix, 'chart-radar', () => renderChartRadar(dados, suffix));
      safeRender(suffix, 'chart-recuperacao', () => renderChartRecuperacao(dados, suffix));
      safeRender(suffix, 'chart-dist', () => renderChartDistribuicao(dados, suffix));
      safeRender(suffix, 'chart-frequencia', () => renderChartFrequencia(dados, suffix));

      // Tabelas e rankings (idem)
      safeRender(suffix, 'tabela-media-aluno', () => renderTabelaMediaAluno(dados, suffix));
      safeRender(suffix, 'ranking-melhores', () => renderRankingMelhores(dados, suffix));
      safeRender(suffix, 'ranking-risco', () => renderRankingCritico(dados, suffix));
      safeRender(suffix, 'ranking-piores', () => renderRankingPiores(dados, suffix));
      safeRender(suffix, 'tabela-situacao-aluno', () => renderTabelaSituacaoAluno(dados, suffix));
      safeRender(suffix, 'tabela-situacao', () => renderTabelaSituacao(dados, suffix));
      safeRender(suffix, 'tabela-por-turma', () => renderTabelaPorTurma(dados, suffix));
      safeRender(suffix, 'tabela-frequencia', () => renderTabelaFrequencia(dados, suffix));
    }

    // Executa um render protegido: se falhar, exibe o erro no card em vez de quebrar o restante
    function safeRender(suffix, id, fn) {
      try {
        fn();
      } catch (e) {
        const el = document.getElementById(id + suffix);
        if (el) {
          el.innerHTML = '<p style="color:#c62828; text-align:center; padding:20px;">⚠️ Erro ao gerar este gráfico/tabela: ' +
            e.message + '</p>';
        }
      }
    }

    function calcularDadosEstatisticas(escopo, turmas) {
      const turmasFiltradas = escopo.turmaId
        ? turmas.filter(t => t.id === escopo.turmaId)
        : turmas;

      let mediasBimestre = [0, 0, 0, 0];
      let countBimestre = [0, 0, 0, 0];
      let totalNotas = 0;
      let somaNotas = 0;
      // Contadores independentes: aprovação (pelo 5º Conc) e recuperação (pelos semestres)
      let aprovados = 0, reprovados = 0, indeterminados = 0;
      let recuperacao1 = 0, recuperacao2 = 0, semRecuperacao = 0, recIndeterminado = 0;
      let totalAlunosDisc = 0;
      const mediasPorDisciplina = {};
      const mediasPorTurma = {};
      const mediasPorBimDisc = {}; // {discId: [b1,b2,b3,b4]}
      const contPorBimDisc = {};
      const histograma = Array(11).fill(0); // 0..10
      const notasIndividuais = []; // todas as notas lançadas individualmente
      const mediasAlunos = []; // [{turmaId, alunoId, nome, media}]

      turmasFiltradas.forEach(turma => {
        let somaTurma = 0, contTurma = 0;
        const discs = getDisciplinasFiltradas(turma, escopo).filter(d =>
          !escopo.disciplinaId || d.id === escopo.disciplinaId
        );
        if (discs.length === 0) return;

        turma.alunos.forEach(aluno => {
          if (escopo.alunoId && aluno.id !== escopo.alunoId) return;
          const medias = [];
          discs.forEach(disc => {
            [1, 2, 3, 4].forEach(b => {
              if (escopo.bimestre && Number(escopo.bimestre) !== b) return;
              const nota = turma.notas?.[b]?.[disc.id]?.[aluno.id];
              if (nota === undefined || nota === null) return;
              somaNotas += nota; totalNotas++;
              somaTurma += nota; contTurma++;
              mediasBimestre[b - 1] += nota;
              countBimestre[b - 1]++;
              const notaInt = Math.round(nota);
              if (notaInt >= 0 && notaInt <= 10) histograma[notaInt]++;
              notasIndividuais.push(Number(nota));

              if (!mediasPorDisciplina[disc.id]) mediasPorDisciplina[disc.id] = { soma: 0, cont: 0, nome: disc.nome };
              mediasPorDisciplina[disc.id].soma += nota;
              mediasPorDisciplina[disc.id].cont++;

              if (!mediasPorBimDisc[disc.id]) {
                mediasPorBimDisc[disc.id] = [0, 0, 0, 0];
                contPorBimDisc[disc.id] = [0, 0, 0, 0];
              }
              mediasPorBimDisc[disc.id][b - 1] += nota;
              contPorBimDisc[disc.id][b - 1]++;
            });
            const notasDisc = [];
            [1, 2, 3, 4].forEach(b => {
              if (escopo.bimestre && Number(escopo.bimestre) !== b) return;
              const n = turma.notas?.[b]?.[disc.id]?.[aluno.id];
              if (n !== undefined && n !== null) notasDisc.push(n);
            });
            if (notasDisc.length) medias.push(notasDisc.reduce((a, b) => a + b, 0) / notasDisc.length);
          });
          if (medias.length) {
            const mediaAluno = medias.reduce((a, b) => a + b, 0) / medias.length;
            mediasAlunos.push({ turmaId: turma.id, turmaNome: turma.nome, alunoId: aluno.id, nome: aluno.nome, media: mediaAluno });
          }
        });

        if (contTurma > 0) {
          mediasPorTurma[turma.id] = { nome: turma.nome, media: somaTurma / contTurma };
        }
      });

      // Médias bimestrais: calculadas APÓS o detalhe (bloco abaixo).
      // Regra: nota ausente / traço vira 0 e a média divide pelo TOTAL de alunos×disciplinas da turma.
      let mediasBim = [0, 0, 0, 0];

      // Médias por disciplina e por turma são calculadas APÓS o detalhe (método do Boletim Final,
      // que usa a média dos 5º Conceitos dos alunos). Ver recomputação abaixo.
      let mediasDisc = [];
      let mediasTurmasArr = [];

      // Radar: preenchido após o detalhe (5º Conceitos e notas por bimestre, vazio = 0)
      let radarDiscs = [];

      // Situação por aluno/disciplina — duas classificações independentes:
      //   Aprovação: baseada APENAS no 5º Conceito (≥ 5 = aprovado)
      //   Recuperação: baseada nas médias de semestre (< 5 = recuperação)
      const detalheAlunoDisc = [];
      const situacaoPorAluno = {};
      turmasFiltradas.forEach(turma => {
        const discs = getDisciplinasFiltradas(turma, escopo).filter(d =>
          !escopo.disciplinaId || d.id === escopo.disciplinaId
        );
        turma.alunos.forEach(aluno => {
          if (escopo.alunoId && aluno.id !== escopo.alunoId) return;
          discs.forEach(disc => {
            const bimestresAlvo = escopo.bimestre ? [Number(escopo.bimestre)] : [1, 2, 3, 4];
            const nota = (b) => turma.notas?.[b]?.[disc.id]?.[aluno.id];

            const b1 = nota(1), b2 = nota(2), b3 = nota(3), b4 = nota(4);
            // Notas ausentes viram 0 para fins de média
            const v1 = (b1 === undefined || b1 === null) ? 0 : Number(b1);
            const v2 = (b2 === undefined || b2 === null) ? 0 : Number(b2);
            const v3 = (b3 === undefined || b3 === null) ? 0 : Number(b3);
            const v4 = (b4 === undefined || b4 === null) ? 0 : Number(b4);
            const algumaNotaLancada = [b1, b2, b3, b4].some(n => n !== undefined && n !== null);

            // 5º Conceito: prioriza valor editado pelo admin, senão média dos 4 bimestres
            // (nota ausente = 0, denominador fixo 4)
            // Igual ao Boletim Final: o valor EXIBIDO/classificado é arredondado a 1 casa.
            const conceitoEditado = turma.conceitosFinais?.[aluno.id]?.[disc.id];
            let quintoConceito = null;
            if (conceitoEditado !== undefined && conceitoEditado !== null) {
              quintoConceito = Number(conceitoEditado);
            } else if (algumaNotaLancada) {
              quintoConceito = (v1 + v2 + v3 + v4) / 4;
            }
            // Arredondado (mesmo critério do Boletim: conceitoEditado não é arredondado)
            const quintoConceitoArredondado = (conceitoEditado !== undefined && conceitoEditado !== null)
              ? Number(conceitoEditado)
              : Number(((v1 + v2 + v3 + v4) / 4).toFixed(1));

            // Médias de semestre: nota ausente = 0, denominador fixo 2
            let mediaSem1 = null, mediaSem2 = null;
            if (!escopo.bimestre && algumaNotaLancada) {
              mediaSem1 = (v1 + v2) / 2;
              mediaSem2 = (v3 + v4) / 2;
            }

            // Se não há nenhuma nota, ignora
            if (quintoConceito === null && mediaSem1 === null && mediaSem2 === null) return;
            totalAlunosDisc++;

            // Classificações independentes (aprovada pelo 5º Conceito ARREDONDADO, como no Boletim)
            const aprov = classificarAprovacao(quintoConceitoArredondado);
            const rec = classificarRecuperacao(mediaSem1, mediaSem2);

            if (aprov === 'aprovado') aprovados++;
            else if (aprov === 'reprovado') reprovados++;
            else indeterminados++;

            if (rec === 'rec1') recuperacao1++;
            else if (rec === 'rec2') recuperacao2++;
            else if (rec === 'rec1+rec2') {
              recuperacao1++;
              recuperacao2++;
            }
            else if (rec === 'nenhuma' || rec === 'semRecuperacao') semRecuperacao++;
            else recIndeterminado++;

            detalheAlunoDisc.push({
              turmaId: turma.id, turmaNome: turma.nome,
              alunoId: aluno.id, alunoNome: aluno.nome,
              discId: disc.id, discNome: disc.nome,
              b1, b2, b3, b4,
              mediaSem1, mediaSem2,
              quintoConceito,
              quintoConceitoArredondado,
              aprovacao: aprov,
              recuperacao: rec,
              situacao: aprov + '|' + rec
            });

            if (!situacaoPorAluno[aluno.id]) {
              situacaoPorAluno[aluno.id] = {
                turmaId: turma.id, turmaNome: turma.nome,
                alunoId: aluno.id, nome: aluno.nome,
                soma: 0, cont: 0, min: 999, max: -1,
                aprovados: 0, reprovados: 0,
                recuperacao1: 0, recuperacao2: 0, semRecuperacao: 0
              };
            }
            const sa = situacaoPorAluno[aluno.id];
            if (quintoConceito !== null) {
              sa.soma += quintoConceito;
              sa.cont++;
              if (quintoConceito < sa.min) sa.min = quintoConceito;
              if (quintoConceito > sa.max) sa.max = quintoConceito;
            }
            if (aprov === 'aprovado') sa.aprovados++;
            else if (aprov === 'reprovado') sa.reprovados++;
            if (rec === 'rec1') sa.recuperacao1++;
            else if (rec === 'rec2') sa.recuperacao2++;
            else if (rec === 'rec1+rec2') {
              sa.recuperacao1++;
              sa.recuperacao2++;
            }
            else if (rec === 'nenhuma' || rec === 'semRecuperacao') sa.semRecuperacao++;
          });
        });
      });

      // ----- Agregados adicionais para o dashboard completo -----
      // Desvio padrão das notas
      const vari = totalNotas > 1 ? (notasIndividuais.reduce((a, x) => a + (x - (somaNotas / totalNotas)) ** 2, 0) / (totalNotas - 1)) : 0;
      const desvioPadrao = Math.sqrt(vari);
      const menorNota = notasIndividuais.length ? Math.min(...notasIndividuais) : null;
      const maiorNota = notasIndividuais.length ? Math.max(...notasIndividuais) : null;

      // Média por turma × bimestre (heatmap) e por disciplina × bimestre.
      // Calculadas APÓS mediasDiscAgg (bloco abaixo). Regra: vazio = 0, divide pelo total da população.
      let heatmapPorTurma = [];
      let mediasDiscBim = [];

      // Min / Max / Média por disciplina (a partir do detalhe)
      const minMaxDisc = {};
      detalheAlunoDisc.forEach(r => {
        if (!minMaxDisc[r.discId]) minMaxDisc[r.discId] = { nome: r.discNome, notas: [] };
        [1, 2, 3, 4].forEach(b => {
          const val = r['b' + b];
          if (val !== undefined && val !== null) minMaxDisc[r.discId].notas.push(Number(val));
        });
      });
      // Média por disciplina (5º Conceito, mesmo método do Boletim) — computa ANTES do minMaxDiscArr
      const mediasDiscAgg = {};
      detalheAlunoDisc.forEach(r => {
        if (r.quintoConceito === null) return;
        if (!mediasDiscAgg[r.discId]) mediasDiscAgg[r.discId] = { id: r.discId, nome: r.discNome, soma: 0, cont: 0 };
        mediasDiscAgg[r.discId].soma += r.quintoConceito;
        mediasDiscAgg[r.discId].cont++;
      });
      // Inclui TODAS as disciplinas visíveis no escopo, mesmo as sem nenhuma nota
      // lançada (media: null). Sem isso, uma matéria ainda sem lançamentos
      // simplesmente "sumia" dos gráficos de barras do professor.
      turmasFiltradas.forEach(turma => {
        getDisciplinasFiltradas(turma, escopo)
          .filter(d => !escopo.disciplinaId || d.id === escopo.disciplinaId)
          .forEach(d => {
            if (!mediasDiscAgg[d.id]) mediasDiscAgg[d.id] = { id: d.id, nome: d.nome, soma: 0, cont: 0 };
          });
      });
      mediasDisc = Object.values(mediasDiscAgg).map(d => ({
        ...d,
        media: d.cont ? d.soma / d.cont : null,
        semNotas: !d.cont
      }));

      const minMaxDiscArr = Object.entries(minMaxDisc).map(([discId, o]) => {
        const arr = o.notas;
        const info = mediasDiscAgg[discId];
        return {
          nome: o.nome,
          media: info && info.cont ? info.soma / info.cont : null,
          min: arr.length ? Math.min(...arr) : null,
          max: arr.length ? Math.max(...arr) : null
        };
      });

      // Distribuição de aprovação percentual por disciplina
      const aprovPorDisc = {};
      detalheAlunoDisc.forEach(r => {
        if (!aprovPorDisc[r.discId]) aprovPorDisc[r.discId] = { nome: r.discNome, aprov: 0, reprov: 0, indet: 0 };
        if (r.aprovacao === 'aprovado') aprovPorDisc[r.discId].aprov++;
        else if (r.aprovacao === 'reprovado') aprovPorDisc[r.discId].reprov++;
        else aprovPorDisc[r.discId].indet++;
      });
      const aprovPorDiscArr = Object.values(aprovPorDisc);

      // Média por turma (média dos 5º Conceitos de todos os alunos da turma, mesmo método do Boletim)
      const mediasTurmaAgg = {};
      detalheAlunoDisc.forEach(r => {
        if (r.quintoConceito === null) return;
        if (!mediasTurmaAgg[r.turmaId]) mediasTurmaAgg[r.turmaId] = { id: r.turmaId, nome: r.turmaNome, soma: 0, cont: 0 };
        mediasTurmaAgg[r.turmaId].soma += r.quintoConceito;
        mediasTurmaAgg[r.turmaId].cont++;
      });
      mediasTurmasArr = Object.values(mediasTurmaAgg).map(t => ({ id: t.id, nome: t.nome, media: t.soma / t.cont }));

      // ===== Médias recalculadas com a regra padrão: TUDO conta, bimestre vazio/traço = 0, divide pelo TOTAL =====
      // População: alunos com ≥ 1 nota por disciplina (mesma base do Boletim Final).
      const baseRows = detalheAlunoDisc.filter(r => r.quintoConceito !== null);
      const denomPop = baseRows.length || 1;

      // Média Geral da Turma = média dos 5º Conceitos (mesmo método do Boletim)
      const mediaGeral5 = baseRows.reduce((s, r) => s + r.quintoConceito, 0) / denomPop;

      // ---------------------------------------------------------------------------
      // Média Geral por Bimestre (gráfico "📈 Média Geral por Bimestre")
      // NOTA SOBRE O MÉTODO (diferença com o Boletim Final):
      //   Neste gráfico, por escolha do usuário, o bimestre vazio/traço vale 0 e a
      //   divisão é feita pelo TOTAL de alunos × disciplinas.
      //   DIFERE da "Média da Sala por Bimestre" do Boletim Final, que usa APENAS os
      //   alunos que têm nota lançada naquele bimestre (não inclui 0 no divisor).
      //   Exemplo (Ana 10, Bruno sem nota no 3ºB): aqui = (10+0)÷2 = 5,0;
      //   no Boletim = 10÷1 = 10,0.
      // ---------------------------------------------------------------------------
      const bimAlvo = escopo.bimestre ? Number(escopo.bimestre) : null;
      mediasBim = [1, 2, 3, 4].map(b =>
        (bimAlvo && bimAlvo !== b) ? null
          : baseRows.reduce((s, r) => s + (r['b' + b] ?? 0), 0) / denomPop
      );

      // Média por disciplina × bimestre (vazio = 0, divide pela população da disciplina)
      // Disciplinas sem nenhuma nota ficam de fora daqui (radar/disc×bim não fazem
      // sentido sem dados; elas já aparecem no gráfico "Média por Disciplina").
      mediasDiscBim = Object.keys(mediasDiscAgg).map(discId => {
        const rowsR = baseRows.filter(r => r.discId === discId);
        const nome = mediasDiscAgg[discId].nome;
        const valores = [1, 2, 3, 4].map(b =>
          rowsR.length ? rowsR.reduce((s, r) => s + (r['b' + b] ?? 0), 0) / rowsR.length : null
        );
        return { id: discId, nome, valores };
      }).filter(x => x.valores.some(v => v !== null));

      // Radar (por disciplina, 4 eixos de bimestre)
      radarDiscs = mediasDiscBim.map(x => ({ id: x.id, nome: x.nome, vals: x.valores.map(v => v === null ? 0 : v) }));

      // Heatmap por turma × bimestre (vazio = 0, divide pela população da turma)
      heatmapPorTurma = turmasFiltradas.map(t => {
        const rowsR = baseRows.filter(r => r.turmaId === t.id);
        const valores = [1, 2, 3, 4].map(b =>
          rowsR.length ? rowsR.reduce((s, r) => s + (r['b' + b] ?? 0), 0) / rowsR.length : null
        );
        return { turmaId: t.id, turmaNome: t.nome, valores };
      });

      // Piores alunos (menores médias de 5º conceito)
      const rankingAlunosCalc = Object.values(situacaoPorAluno).map(s => ({
        ...s,
        media: s.cont ? s.soma / s.cont : 0,
        min: s.cont ? s.min : 0,
        max: s.cont ? s.max : 0
      })).sort((a, b) => b.media - a.media);

      // Resumo por turma: ranking + situação
      const relatorioPorTurma = heatmapPorTurma.map(h => {
        const t = turmasFiltradas.find(x => x.id === h.turmaId);
        const alunosDaTurma = rankingAlunosCalc.filter(a => a.turmaId === h.turmaId);
        const aggT = mediasTurmaAgg[h.turmaId];
        return {
          turmaId: h.turmaId,
          turmaNome: h.turmaNome,
          nAlunos: t ? t.alunos.length : 0,
          mediaGeral: aggT ? aggT.soma / aggT.cont : 0,
          aprovados: alunosDaTurma.reduce((a, x) => a + x.aprovados, 0),
          reprovados: alunosDaTurma.reduce((a, x) => a + x.reprovados, 0),
          recuperacao: alunosDaTurma.reduce((a, x) => a + x.recuperacao1 + x.recuperacao2, 0),
          melhores: alunosDaTurma.slice(0, 3).map(x => ({ nome: x.nome, media: x.media })),
          maisFracos: alunosDaTurma.slice(-3).map(x => ({ nome: x.nome, media: x.media }))
        };
      });

      // ===== Frequências por bimestre (lançadas pelo admin) =====
      const freqPorBim = [1, 2, 3, 4].map(() => ({ soma: 0, cont: 0 }));
      let freqSoma = 0, freqCont = 0;
      let freqOk = 0, freqLimite = 0, freqAtencao = 0;
      const freqAlunos = [];
      turmasFiltradas.forEach(turma => {
        turma.alunos.forEach(aluno => {
          if (escopo.alunoId && aluno.id !== escopo.alunoId) return;
          const vals = [];
          const porBim = {};
          [1, 2, 3, 4].forEach(b => {
            if (escopo.bimestre && Number(escopo.bimestre) !== b) return;
            const pct = turma.frequencias?.[b]?.[aluno.id];
            if (pct === undefined || pct === null || pct === '') return;
            const n = Number(pct);
            if (isNaN(n)) return;
            porBim[b] = n;
            vals.push(n);
            freqPorBim[b - 1].soma += n;
            freqPorBim[b - 1].cont++;
            freqSoma += n;
            freqCont++;
            const cls = classificarFrequencia(n);
            if (cls === 'ok') freqOk++;
            else if (cls === 'limite') freqLimite++;
            else freqAtencao++;
          });
          if (vals.length) {
            const media = vals.reduce((a, b) => a + b, 0) / vals.length;
            freqAlunos.push({
              turmaId: turma.id, turmaNome: turma.nome,
              alunoId: aluno.id, nome: aluno.nome,
              media, pior: Math.min(...vals), porBim,
              abaixo75: media < FREQUENCIA_MINIMA,
              classe: classificarFrequencia(media)
            });
          }
        });
      });
      const freqMediaGeral = freqCont ? freqSoma / freqCont : null;
      const freqMediaBim = freqPorBim.map(o => (o.cont ? o.soma / o.cont : null));
      const freqAbaixo = freqAlunos.filter(a => a.abaixo75).length;
      freqAlunos.sort((a, b) => a.media - b.media); // piores primeiro

      return {
        mediaGeral5,
        freqMediaGeral,
        freqMediaBim,
        freqOk, freqLimite, freqAtencao,
        freqCont,
        freqAbaixo,
        freqAlunos,
        desvioPadrao,
        menorNota,
        maiorNota,
        totalNotas,
        totalAlunosDisc,
        aprovados, reprovados, indeterminados,
        recuperacao1, recuperacao2, semRecuperacao, recIndeterminado,
        mediasBim,
        mediasDisc,
        mediasTurmasArr,
        radarDiscs,
        histograma,
        detalheAlunoDisc,
        heatmapPorTurma,
        mediasDiscBim,
        minMaxDiscArr,
        aprovPorDiscArr,
        relatorioPorTurma,
        rankingAlunos: rankingAlunosCalc
      };
    }

    function renderKPIs(d, suffix) {
      const totalAlunosCadastrados = new Set(
        estado.turmas && Object.values(estado.turmas).flatMap(t => t.alunos.map(a => a.id))
      ).size;
      const totalDisc = new Set(
        estado.turmas && Object.values(estado.turmas).flatMap(t => t.disciplinas.map(x => x.id))
      ).size;
      const totalTurmas = estado.turmas ? Object.keys(estado.turmas).length : 0;
      const taxaAprov = d.aprovados + d.reprovados > 0 ? ((d.aprovados / (d.aprovados + d.reprovados)) * 100).toFixed(1) + '%' : '—';
      const kpis = [
        { label: '📊 Média Geral da Turma', value: d.mediaGeral5 ? d.mediaGeral5.toFixed(2) : '—', sub: 'média dos 5º Conceitos (vazio = 0)', cls: '' },
        { label: '📉 Desvio Padrão', value: d.desvioPadrao ? d.desvioPadrao.toFixed(2) : '—', sub: 'dispersão das notas', cls: 'purple' },
        { label: '⬇️ Menor / ⬆️ Maior Nota', value: (d.menorNota ?? '—') + ' / ' + (d.maiorNota ?? '—'), sub: `${d.totalNotas} nota(s) lançada(s)`, cls: '' },
        { label: '✅ Taxa de Aprovação', value: taxaAprov, sub: `${d.aprovados} aprovados / ${d.reprovados} reprovados`, cls: 'green' },
        { label: '❌ Reprovados (5º Conc < 5)', value: d.reprovados, sub: 'regra: 5º Conceito < 5', cls: 'red' },
        { label: '🟠 Recuperação (1º Semestre)', value: d.recuperacao1, sub: 'regra: Sem1 < 5', cls: 'orange' },
        { label: '🟠 Recuperação (2º Semestre)', value: d.recuperacao2, sub: 'regra: Sem2 < 5', cls: 'orange' },
        { label: '⚪ Sem Recuperação', value: d.semRecuperacao, sub: 'ambos semestres ≥ 5', cls: 'teal' },
        { label: '🏫 Turmas', value: totalTurmas, sub: 'no sistema', cls: 'purple' },
        { label: '📚 Disciplinas', value: totalDisc, sub: 'no sistema', cls: 'purple' },
        { label: '👥 Alunos', value: totalAlunosCadastrados, sub: 'cadastrados', cls: 'teal' },
        { label: '📝 Avaliações Lançadas', value: d.totalNotas, sub: 'aluno × disciplina × bimestre', cls: '' },
        { label: '🗓️ Frequência Média', value: d.freqMediaGeral !== null && d.freqMediaGeral !== undefined ? d.freqMediaGeral.toFixed(1) + '%' : '—', sub: `${d.freqCont || 0} registro(s) de frequência`, cls: 'teal' },
        { label: '⚠️ Abaixo de 75%', value: d.freqAbaixo ?? 0, sub: 'aluno(s) com frequência média < 75%', cls: 'red' },
        { label: '✅ Frequência OK / Limite / Atenção', value: `${d.freqOk ?? 0} / ${d.freqLimite ?? 0} / ${d.freqAtencao ?? 0}`, sub: 'critério: >75 / =75 / <75', cls: 'green' }
      ];
      const el = document.getElementById('stats-kpis' + suffix);
      if (!el) return;
      el.innerHTML = kpis.map(k => `
    <div class="kpi-card ${k.cls}">
      <div class="label">${k.label}</div>
      <div class="value">${k.value}</div>
      <div class="sub">${k.sub}</div>
    </div>
  `).join('');
    }

    function makeChart(ctx, config, key) {
      if (Chart && !window.__chartDarkApplied) {
        Chart.defaults.color = '#cbd5e1';
        Chart.defaults.borderColor = 'rgba(148,163,184,0.18)';
        if (Chart.defaults.scale) {
          Chart.defaults.scale.grid.color = 'rgba(148,163,184,0.14)';
          Chart.defaults.scale.border.color = 'rgba(148,163,184,0.25)';
          Chart.defaults.scale.ticks.color = '#cbd5e1';
        }
        window.__chartDarkApplied = true;
      }
      // Chart.js v4 lança erro se o canvas já está em uso — destrói o gráfico
      // anterior da mesma chave antes de criar outro (evita gráfico "congelado"
      // quando os filtros de turma/disciplina mudam).
      if (statsCharts[key]) {
        try { statsCharts[key].destroy(); } catch (e) { /* já destruído */ }
        delete statsCharts[key];
      }
      statsCharts[key] = new Chart(ctx, config);
    }

    // Frequência por bimestre (dados lançados pelo admin) — gráfico de colunas + linha do mínimo (75%)
    function renderChartFrequencia(d, suffix) {
      const canvas = document.getElementById('chart-frequencia' + suffix);
      if (!canvas) return;
      if (!d.freqCont) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#999';
        ctx.textAlign = 'center';
        ctx.fillText('Sem dados de frequência lançados', (canvas.width || 400) / 2, (canvas.height || 200) / 2);
        return;
      }
      const cores = d.freqMediaBim.map(v => {
        const cls = classificarFrequencia(v);
        if (cls === 'ok') return '#2e7d32';
        if (cls === 'limite') return '#e65100';
        if (cls === 'atencao') return '#c62828';
        return '#90a4ae';
      });
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['1º Bim', '2º Bim', '3º Bim', '4º Bim'],
          datasets: [
            {
              label: 'Frequência Média (%)',
              data: d.freqMediaBim.map(v => v === null ? null : Number(v.toFixed(1))),
              backgroundColor: cores,
              borderRadius: 4
            },
            {
              label: 'Mínimo exigido (75%)',
              type: 'line',
              data: [75, 75, 75, 75],
              borderColor: '#e65100',
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
          plugins: { legend: { position: 'bottom' } }
        }
      }, suffix + ':frequencia');
    }

    // Tabela de frequência por aluno (com classificação OK / Limite / Atenção)
    function renderTabelaFrequencia(d, suffix) {
      const el = document.getElementById('tabela-frequencia' + suffix);
      if (!el) return;
      if (!d.freqAlunos || d.freqAlunos.length === 0) {
        el.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">Sem dados de frequência (o admin ainda não lançou).</p>';
        return;
      }
      const celula = (pct) => {
        const cls = classificarFrequencia(pct);
        if (cls === null) return '<td class="num">—</td>';
        return `<td class="num" style="background:${bgFrequencia(cls)}; color:${corFrequencia(cls)}; font-weight:700;">${Number(pct).toFixed(1)}%<br><small>${labelFrequencia(cls)}</small></td>`;
      };
      el.innerHTML = `
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:8px; font-size:12px;">
      <span class="badge-freq" style="background:rgba(52,211,153,0.16); color:#6ee7b7; font-weight:700; padding:4px 10px; border-radius:12px;">✅ OK (&gt;75%): ${d.freqOk}</span>
      <span class="badge-freq" style="background:rgba(251,191,36,0.18); color:#fde68a; font-weight:700; padding:4px 10px; border-radius:12px;">⚠️ Limite (=75%): ${d.freqLimite}</span>
      <span class="badge-freq" style="background:rgba(248,113,113,0.16); color:#fca5a5; font-weight:700; padding:4px 10px; border-radius:12px;">🚨 Atenção (&lt;75%): ${d.freqAtencao}</span>
      <span class="badge-freq" style="background:rgba(91,124,250,0.18); color:#a5b4fc; font-weight:700; padding:4px 10px; border-radius:12px;">🗓️ Média: ${d.freqMediaGeral !== null ? d.freqMediaGeral.toFixed(1) + '%' : '—'}</span>
    </div>
    <table class="ranking-table">
      <thead>
        <tr>
          <th>Aluno</th><th>Turma</th>
          <th class="num">1ºB</th><th class="num">2ºB</th><th class="num">3ºB</th><th class="num">4ºB</th>
          <th class="num">Média</th><th>Situação</th>
        </tr>
      </thead>
      <tbody>
        ${d.freqAlunos.map(a => `
          <tr>
            <td><b>${esc(a.nome)}</b></td>
            <td>${esc(a.turmaNome)}</td>
            ${[1, 2, 3, 4].map(b => celula(a.porBim[b])).join('')}
            <td class="num" style="background:${bgFrequencia(a.classe)}; color:${corFrequencia(a.classe)}; font-weight:700;">${a.media.toFixed(1)}%</td>
            <td style="color:${corFrequencia(a.classe)}; font-weight:700;">${labelFrequencia(a.classe)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="font-size:11px; color:#999; margin-top:6px;">Ordenado da menor para a maior média de frequência. Critério: &gt;75% OK · =75% Limite · &lt;75% Atenção.</p>
  `;
    }

    function renderChartEvolucao(d, suffix) {
      const canvas = document.getElementById('chart-evolucao' + suffix);
      if (!canvas) return;
      makeChart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: ['1º Bim', '2º Bim', '3º Bim', '4º Bim'],
          datasets: [{
            label: 'Média Geral',
            data: d.mediasBim,
            borderColor: '#5b7cfa', backgroundColor: 'rgba(91,124,250,0.18)',
            tension: 0.3, fill: true, pointRadius: 5, pointBackgroundColor: '#5b7cfa', pointBorderColor: '#a5b4fc', pointBorderWidth: 2
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 10 } },
          plugins: { legend: { display: false } }
        }
      }, suffix + ':evolucao');
    }

    function renderChartAprovados(d, suffix) {
      const canvas = document.getElementById('chart-aprovados' + suffix);
      if (!canvas) return;
      makeChart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['✅ Aprovados (5º Conc ≥ 5)', '❌ Reprovados (5º Conc < 5)'],
          datasets: [{
            data: [d.aprovados, d.reprovados],
            backgroundColor: ['#2e7d32', '#c62828'],
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
      }, suffix + ':aprovados');
    }

    function renderChartRecuperacao(d, suffix) {
      const canvas = document.getElementById('chart-recuperacao' + suffix);
      if (!canvas) return;
      // IMPORTANTE: contagem é por aluno×disciplina. Quando o aluno está nos 2 semestres
      // (rec1+rec2), conta-se uma vez em cada — então a soma das fatias pode ser maior
      // que o número de alunos×disciplinas. Exibimos também o total bruto no subtítulo.
      const data = [d.recuperacao1, d.recuperacao2, d.semRecuperacao];
      const labels = [
        '🟠 Rec 1º Semestre',
        '🟠 Rec 2º Semestre',
        '⚪ Sem Recuperação'
      ];
      const cores = ['#fb8c00', '#ef6c00', '#9e9e9e'];
      const total = data.reduce((a, b) => a + b, 0);
      if (total === 0) {
        const ctx = canvas.getContext('2d');
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#999';
        ctx.textAlign = 'center';
        ctx.fillText('Sem dados de recuperação', canvas.width / 2, canvas.height / 2);
        return;
      }
      // Calcula quantos alunos×disc estão nos DOIS semestres simultaneamente
      const dblCount = d.detalheAlunoDisc
        ? d.detalheAlunoDisc.filter(x => x.recuperacao === 'rec1+rec2').length
        : 0;
      const labelsFull = dblCount > 0
        ? [...labels, `🟠🟠 Rec 1º E 2º Semestre (${dblCount})`]
        : labels;
      const dataFull = dblCount > 0
        ? [...data, dblCount]
        : data;
      const coresFull = dblCount > 0
        ? [...cores, '#bf360c']
        : cores;
      makeChart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels: labelsFull, datasets: [{ data: dataFull, backgroundColor: coresFull, borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
      }, suffix + ':recuperacao');
    }

    function renderChartDisciplinas(d, suffix) {
      const canvas = document.getElementById('chart-disciplinas' + suffix);
      if (!canvas) return;
      // Disciplinas sem nenhuma nota aparecem na lista, mas sem barra ("s/ notas")
      const labels = d.mediasDisc.map(x => x.media === null ? x.nome + ' — s/ notas' : x.nome);
      const values = d.mediasDisc.map(x => x.media === null ? null : Number(x.media.toFixed(2)));
      const cores = ['#5b7cfa', '#34d399', '#fbbf24', '#c084fc', '#22d3ee', '#f87171', '#a3e635', '#8b5cf6', '#f472b6', '#38bdf8'];
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Média', data: values, backgroundColor: labels.map((_, i) => cores[i % cores.length]) }] },
        options: {
          responsive: true, maintainAspectRatio: false, indexAxis: 'y',
          scales: { x: { beginAtZero: true, max: 10 } },
          plugins: { legend: { display: false } }
        }
      }, suffix + ':disciplinas');
    }

    function renderChartTurmas(d, suffix) {
      const canvas = document.getElementById('chart-turmas' + suffix);
      if (!canvas) return;
      const labels = d.mediasTurmasArr.map(x => x.nome);
      const values = d.mediasTurmasArr.map(x => Number(x.media.toFixed(2)));
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Média da Turma', data: values, backgroundColor: '#7c9aff', borderColor: '#5b7cfa', borderWidth: 2 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 10 } },
          plugins: { legend: { display: false } }
        }
      }, suffix + ':turmas');
    }

    function renderChartRadar(d, suffix) {
      const canvas = document.getElementById('chart-radar' + suffix);
      if (!canvas) return;
      const cores = ['#5b7cfa', '#34d399', '#fbbf24', '#c084fc', '#22d3ee', '#f87171', '#a3e635', '#f472b6', '#38bdf8', '#a78bfa'];
      const datasets = d.radarDiscs.slice(0, 10).map((disc, i) => ({
        label: disc.nome,
        data: disc.vals.map(v => Number(v.toFixed(2))),
        borderColor: cores[i % cores.length],
        backgroundColor: cores[i % cores.length] + '33',
        borderWidth: 2
      }));
      makeChart(canvas.getContext('2d'), {
        type: 'radar',
        data: { labels: ['1º Bim', '2º Bim', '3º Bim', '4º Bim'], datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: { beginAtZero: true, max: 10 } },
          plugins: { legend: { position: 'bottom' } }
        }
      }, suffix + ':radar');
    }

    function renderChartDistribuicao(d, suffix) {
      const canvas = document.getElementById('chart-dist' + suffix);
      if (!canvas) return;
      const labels = d.histograma.map((_, i) => i.toString());
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Qtd. de Notas',
            data: d.histograma,
            backgroundColor: d.histograma.map((_, i) => {
              if (i < 5) return '#c62828';
              if (i < 7) return '#ef6c00';
              return '#2e7d32';
            }),
            borderWidth: 1
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
          plugins: { legend: { display: false } }
        }
      }, suffix + ':dist');
    }

    function renderChartNotasDonut(d, suffix) {
      const canvas = document.getElementById('chart-notas-donut' + suffix);
      if (!canvas) return;
      const total = d.histograma.reduce((a, b) => a + b, 0);
      if (total === 0) {
        const ctx = canvas.getContext('2d');
        ctx.font = '14px sans-serif'; ctx.fillStyle = '#999'; ctx.textAlign = 'center';
        ctx.fillText('Sem dados', canvas.width / 2, canvas.height / 2);
        return;
      }
      const faixas = [
        { label: '🚨 Insuficiente (0-4)', sum: 0, cor: '#c62828' },
        { label: '⚠️ Regular (5-6)', sum: 0, cor: '#ef6c00' },
        { label: '✅ Bom (7-8)', sum: 0, cor: '#2e7d32' },
        { label: '🏆 Excelente (9-10)', sum: 0, cor: '#7c9aff' }
      ];
      d.histograma.forEach((q, v) => {
        if (q === 0) return;
        if (v <= 4) faixas[0].sum += q;
        else if (v <= 6) faixas[1].sum += q;
        else if (v <= 8) faixas[2].sum += q;
        else faixas[3].sum += q;
      });
      makeChart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: faixas.map(f => `${f.label} (${f.sum})`),
          datasets: [{ data: faixas.map(f => f.sum), backgroundColor: faixas.map(f => f.cor), borderWidth: 2, borderColor: '#fff' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
      }, suffix + ':notasdonut');
    }

    function renderChartHeatmap(d, suffix) {
      const canvas = document.getElementById('chart-heatmap' + suffix);
      if (!canvas) return;
      const turmas = d.heatmapPorTurma.slice(0, 10);
      if (turmas.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.font = '14px sans-serif'; ctx.fillStyle = '#999'; ctx.textAlign = 'center';
        ctx.fillText('Sem dados', canvas.width / 2, canvas.height / 2);
        return;
      }
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['1º Bim', '2º Bim', '3º Bim', '4º Bim'],
          datasets: turmas.map((t, i) => ({
            label: t.turmaNome,
            data: t.valores.map(v => v !== null ? Number(v.toFixed(2)) : 0),
            backgroundColor: ['#5b7cfa', '#34d399', '#fbbf24', '#c084fc', '#22d3ee', '#f87171', '#a3e635', '#8b5cf6', '#f472b6', '#38bdf8'][i % 10],
            borderWidth: 1
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 10 } },
          plugins: { legend: { position: 'bottom' } }
        }
      }, suffix + ':heatmap');
    }

    function renderChartDiscBim(d, suffix) {
      const canvas = document.getElementById('chart-disc-bim' + suffix);
      if (!canvas) return;
      const discs = d.mediasDiscBim.slice(0, 8);
      if (discs.length === 0) return;
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: discs.map(x => x.nome),
          datasets: [1, 2, 3, 4].map((b, i) => ({
            label: `${b}º Bimestre`,
            data: discs.map(x => x.valores[b - 1] !== null && x.valores[b - 1] !== undefined ? Number(x.valores[b - 1].toFixed(2)) : 0),
            backgroundColor: ['#5b7cfa', '#34d399', '#fbbf24', '#c084fc'][i]
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 10 } },
          plugins: { legend: { position: 'bottom' } }
        }
      }, suffix + ':discbim');
    }

    function renderChartMinMax(d, suffix) {
      const canvas = document.getElementById('chart-minmax' + suffix);
      if (!canvas) return;
      const arr = d.minMaxDiscArr;
      if (arr.length === 0) return;
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: arr.map(x => x.nome),
          datasets: [
            { label: 'Mínima', data: arr.map(x => x.min !== null ? x.min : 0), backgroundColor: '#f87171' },
            { label: 'Média', data: arr.map(x => x.media !== null ? Number(x.media.toFixed(2)) : 0), backgroundColor: '#7c9aff' },
            { label: 'Máxima', data: arr.map(x => x.max !== null ? x.max : 0), backgroundColor: '#34d399' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: 'y',
          scales: { x: { beginAtZero: true, max: 10 } },
          plugins: { legend: { position: 'bottom' } }
        }
      }, suffix + ':minmax');
    }

    function renderAnaliseTextual(d, suffix) {
      const el = document.getElementById('analise-textual' + suffix);
      if (!el) return;
      // Disciplinas visíveis sem nenhuma nota lançada — aviso presente mesmo quando
      // ainda não há NENHUMA nota no escopo (matéria recém-cadastrada pelo admin).
      const semNotas = d.mediasDisc.filter(x => x.media === null).map(x => x.nome);
      if (d.totalNotas === 0) {
        el.innerHTML = semNotas.length
          ? `⚠️ <b>Sem notas lançadas:</b> ${semNotas.join(', ')}. As médias e os gráficos só aparecem depois que o professor lançar as notas.`
          : '';
        return;
      }
      let txt = '';
      txt += `<strong>🤖 Análise Automática:</strong> `;
      txt += `Desempenho geral de <b>${d.mediaGeral5.toFixed(2)}</b> (${d.mediaGeral5 >= 7 ? 'bom' : d.mediaGeral5 >= 5 ? 'regular' : 'preocupante'}) com base nos 5º Conceitos (${d.totalAlunosDisc} disciplina(s) analisada(s)). `;
      txt += `Aprovação de <b>${d.aprovados + d.reprovados > 0 ? ((d.aprovados / (d.aprovados + d.reprovados)) * 100).toFixed(0) : 0}%</b> (${d.aprovados} aprovados, ${d.reprovados} reprovados). `;
      txt += `Desvio padrão de <b>${d.desvioPadrao.toFixed(2)}</b> indica ${d.desvioPadrao > 2.5 ? 'alta variabilidade entre alunos' : d.desvioPadrao > 1 ? 'variabilidade moderada' : 'desempenho homogêneo'}. `;
      if (d.recuperacao1 + d.recuperacao2 > 0) {
        txt += `${d.recuperacao1 + d.recuperacao2} ocorrência(s) de recuperação (${d.recuperacao1} no 1º sem, ${d.recuperacao2} no 2º sem). `;
      }
      // Melhor/disciplina com maior dificuldade (apenas as que têm nota lançada)
      const comNota = d.mediasDisc.filter(x => x.media !== null);
      if (comNota.length) {
        const melhor = comNota.reduce((a, b) => (b.media > a.media ? b : a));
        const pior = comNota.reduce((a, b) => (b.media < a.media ? b : a));
        txt += `Destaque: <b>${esc(melhor.nome)}</b> (${melhor.media.toFixed(1)}) e dificuldade: <b>${esc(pior.nome)}</b> (${pior.media.toFixed(1)}). `;
      }
      if (semNotas.length) {
        txt += `⚠️ <b>Sem notas lançadas:</b> ${semNotas.join(', ')} — elas aparecem no gráfico "Média por Disciplina" sem barra até que o professor lance as notas. `;
      }
      // Melhor aluno
      if (d.rankingAlunos.length) {
        txt += `Destaque individual: <b>${esc(d.rankingAlunos[0].nome)}</b> (${d.rankingAlunos[0].media.toFixed(2)}).`;
      }
      // Frequência (dados lançados pelo admin)
      if (d.freqCont > 0) {
        txt += ` Frequência média de <b>${d.freqMediaGeral.toFixed(1)}%</b> — ` +
          `${d.freqOk} registro(s) acima de 75%, ${d.freqLimite} no limite (75%) e ${d.freqAtencao} abaixo de 75%` +
          (d.freqAbaixo > 0 ? `, sendo <b>${d.freqAbaixo} aluno(s)</b> com média de frequência abaixo do mínimo.` : '.');
      }
      el.innerHTML = txt;
    }

    function renderRankingPiores(d, suffix) {
      const el = document.getElementById('ranking-piores' + suffix);
      if (!el) return;
      const piores = d.rankingAlunos.filter(a => a.media < 5).slice(0, 10).sort((a, b) => a.media - b.media);
      if (piores.length === 0) { el.innerHTML = '<p style="color:#2e7d32; text-align:center; padding:20px;">✅ Nenhum aluno com média &lt; 5.</p>'; return; }
      el.innerHTML = `
    <table class="ranking-table">
      <thead><tr><th>Aluno</th><th class="num">Média</th><th class="num">Menor</th><th class="num">Maior</th></tr></thead>
      <tbody>
        ${piores.map(a => `
          <tr>
            <td>${esc(a.nome)}<br><small style="color:#999;">${esc(a.turmaNome)}</small></td>
            <td class="num status-reprovado">${a.media.toFixed(2)}</td>
            <td class="num">${a.min.toFixed(2)}</td>
            <td class="num">${a.max.toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
    }

    function renderTabelaSituacaoAluno(d, suffix) {
      const el = document.getElementById('tabela-situacao-aluno' + suffix);
      if (!el) return;
      const cont = {};
      d.rankingAlunos.forEach(a => {
        const sit = a.aprovados > 0 && a.reprovados === 0 ? 'aprovado' : (a.reprovados > 0 && a.aprovados === 0 ? 'reprovado' : 'misto');
        const key = sit + '|' + (a.recuperacao1 + a.recuperacao2 > 0 ? 'rec' : 'ok');
        if (!cont[key]) cont[key] = { sit, rec: key.endsWith('rec'), qtd: 0 };
        cont[key].qtd++;
      });
      const partes = Object.values(cont);
      if (partes.length === 0) { el.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">Sem dados.</p>'; return; }
      const labelSit = { aprovado: '✅ Aprovado', reprovado: '❌ Reprovado', misto: '🟡 Misto' };
      el.innerHTML = `
    <table class="ranking-table">
      <thead><tr><th>Situação</th><th class="num">Alunos</th></tr></thead>
      <tbody>
        ${partes.map(p => `<tr>
          <td>${labelSit[p.sit]} ${p.rec ? '• 🟠 com recuperação' : ''}</td>
          <td class="num"><b>${p.qtd}</b></td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
    }

    function renderTabelaPorTurma(d, suffix) {
      const el = document.getElementById('tabela-por-turma' + suffix);
      if (!el) return;
      const rel = d.relatorioPorTurma;
      if (rel.length === 0) { el.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">Sem turmas.</p>'; return; }
      el.innerHTML = `
    <table class="ranking-table">
      <thead>
        <tr><th>Turma</th><th class="num">Alunos</th><th class="num">Média</th><th class="num">Aprov.</th><th class="num">Reprov.</th><th class="num">Recup.</th><th>Destaques</th></tr>
      </thead>
      <tbody>
        ${rel.map(t => `
          <tr>
            <td><b>${esc(t.turmaNome)}</b></td>
            <td class="num">${t.nAlunos}</td>
            <td class="num"><b>${t.mediaGeral.toFixed(2)}</b></td>
            <td class="num status-aprovado">${t.aprovados}</td>
            <td class="num status-reprovado">${t.reprovados}</td>
            <td class="num status-recuperacao">${t.recuperacao}</td>
            <td style="font-size:11px;">
              <small><b>Melhores:</b> ${t.melhores.map(m => `${esc(m.nome)} (${m.media.toFixed(2)})`).join(', ') || '—'}<br>
              <b>Preocupam:</b> ${t.maisFracos.map(m => `${esc(m.nome)} (${m.media.toFixed(2)})`).join(', ') || '—'}</small>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
    }

    function renderTabelaMediaAluno(d, suffix) {
      const el = document.getElementById('tabela-media-aluno' + suffix);
      if (!el) return;
      if (!d.detalheAlunoDisc || d.detalheAlunoDisc.length === 0) {
        el.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">Sem dados para exibir.</p>';
        return;
      }
      // Monta mapa aluno -> { discNome: 5ºConceito }
      const mapa = {};
      const disciplinas = [];
      d.detalheAlunoDisc.forEach(r => {
        if (!mapa[r.alunoId]) mapa[r.alunoId] = { nome: r.alunoNome, turma: r.turmaNome, disc: {} };
        mapa[r.alunoId].disc[r.discNome] = r.quintoConceitoArredondado;
        if (!disciplinas.includes(r.discNome)) disciplinas.push(r.discNome);
      });
      const cor = (v) => v === null || v === undefined ? '' : (v < 5 ? 'status-reprovado' : v < 7 ? 'status-recuperacao' : 'status-aprovado');
      const rows = Object.values(mapa).map(a => {
        const vals = disciplinas.map(dd => a.disc[dd] !== undefined ? Number(a.disc[dd]) : null);
        const validos = vals.filter(v => v !== null);
        const mediaGeral = validos.length ? (validos.reduce((x, y) => x + y, 0) / validos.length) : null;
        return { ...a, vals, mediaGeral };
      }).sort((a, b) => (b.mediaGeral ?? -1) - (a.mediaGeral ?? -1));
      el.innerHTML = `
    <table class="ranking-table">
      <thead>
        <tr>
          <th>Aluno / Turma</th>
          ${disciplinas.map(dd => `<th class="num">${dd}</th>`).join('')}
          <th class="num">Média Geral</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(a => `
          <tr>
            <td><b>${esc(a.nome)}</b><br><small style="color:#999;">${esc(a.turma)}</small></td>
            ${a.vals.map(v => `<td class="num ${cor(v)}">${v !== null ? v.toFixed(1) : '—'}</td>`).join('')}
            <td class="num ${cor(a.mediaGeral)}"><b>${a.mediaGeral !== null ? a.mediaGeral.toFixed(2) : '—'}</b></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="font-size:11px; color:#666; margin-top:8px;">
      <span class="status-aprovado">Verde ≥ 7</span> &nbsp; <span class="status-recuperacao">Laranja 5–6.9</span> &nbsp; <span class="status-reprovado">Vermelho &lt; 5</span>
    </p>
  `;
    }

    function renderRankingMelhores(d, suffix) {
      const el = document.getElementById('ranking-melhores' + suffix);
      if (!el) return;
      const top = d.rankingAlunos.slice(0, 10);
      if (top.length === 0) { el.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">Sem dados ainda.</p>'; return; }
      el.innerHTML = `
    <table class="ranking-table">
      <thead><tr><th>#</th><th>Aluno</th><th class="num">Média</th><th class="num">Notas</th></tr></thead>
      <tbody>
        ${top.map((a, i) => `
          <tr>
            <td><b>${i + 1}º</b></td>
            <td>${esc(a.nome)}<br><small style="color:#999;">${esc(a.turmaNome)}</small></td>
            <td class="num"><b>${a.media.toFixed(2)}</b></td>
            <td class="num">${a.cont}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
    }

    function renderRankingCritico(d, suffix) {
      const el = document.getElementById('ranking-risco' + suffix);
      if (!el) return;
      // Situação crítica: média < 5 (reprovado) OU em recuperação nos semestres
      const criticos = d.rankingAlunos
        .map(a => ({ ...a, emRec: (a.recuperacao1 + a.recuperacao2) > 0 }))
        .filter(a => a.media < 5 || a.emRec)
        .sort((a, b) => a.media - b.media)
        .slice(0, 20);
      if (criticos.length === 0) { el.innerHTML = '<p style="color:#2e7d32; text-align:center; padding:20px;">✅ Nenhum aluno em situação crítica.</p>'; return; }
      el.innerHTML = `
    <table class="ranking-table">
      <thead><tr><th>Aluno</th><th class="num">Média</th><th>Recuperação</th></tr></thead>
      <tbody>
        ${criticos.map(a => `
          <tr>
            <td>${esc(a.nome)}<br><small style="color:#999;">${esc(a.turmaNome)}</small></td>
            <td class="num ${a.media < 5 ? 'status-reprovado' : 'status-recuperacao'}"><b>${a.media.toFixed(2)}</b></td>
            <td class="${a.emRec ? 'status-recuperacao' : ''}" style="font-size:11px;">${a.emRec ? (a.recuperacao1 > 0 ? '🟠 1º Sem ' : '') + (a.recuperacao2 > 0 ? '🟠 2º Sem' : '') : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
    }

    function fmt(v) {
      return (v === null || v === undefined) ? '—' : Number(v).toFixed(1);
    }

    function renderTabelaSituacao(d, suffix) {
      const el = document.getElementById('tabela-situacao' + suffix);
      if (!el) return;
      if (!d.detalheAlunoDisc || d.detalheAlunoDisc.length === 0) {
        el.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">Sem dados para classificar.</p>';
        return;
      }
      const linhas = [...d.detalheAlunoDisc].sort((a, b) => {
        const cmp = a.alunoNome.localeCompare(b.alunoNome);
        return cmp !== 0 ? cmp : a.discNome.localeCompare(b.discNome);
      });
      el.innerHTML = `
    <table class="ranking-table">
      <thead>
        <tr>
          <th>Aluno / Disciplina</th>
          <th class="num">B1</th>
          <th class="num">B2</th>
          <th class="num">M. 1º Sem</th>
          <th class="num">B3</th>
          <th class="num">B4</th>
          <th class="num">M. 2º Sem</th>
          <th class="num">5º Conceito</th>
          <th>Aprovação</th>
          <th>Recuperação</th>
        </tr>
      </thead>
      <tbody>
        ${linhas.map(r => `
          <tr>
            <td>
              <b>${esc(r.alunoNome)}</b><br>
              <small style="color:#999;">${esc(r.turmaNome)} • ${esc(r.discNome)}</small>
            </td>
            <td class="num">${fmt(r.b1)}</td>
            <td class="num">${fmt(r.b2)}</td>
            <td class="num">${fmt(r.mediaSem1)}</td>
            <td class="num">${fmt(r.b3)}</td>
            <td class="num">${fmt(r.b4)}</td>
            <td class="num">${fmt(r.mediaSem2)}</td>
            <td class="num"><b>${fmt(r.quintoConceito)}</b></td>
            <td class="${r.aprovacao === 'aprovado' ? 'status-aprovado' : (r.aprovacao === 'reprovado' ? 'status-reprovado' : '')}">${labelAprovacao(r.aprovacao)}</td>
            <td class="${(r.recuperacao === 'rec1' || r.recuperacao === 'rec2' || r.recuperacao === 'rec1+rec2') ? 'status-recuperacao' : ''}">${labelRecuperacao(r.recuperacao)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="font-size:11px; color:#666; margin-top:8px;">
      <b>Regras:</b> Aprovação vem do <b>5º Conceito</b> (≥ 5 = ✅ Aprovado; &lt; 5 = ❌ Reprovado).
      Recuperação vem da média do semestre: <b>Sem1 &lt; 5</b> = 🟠 Rec 1º Sem; <b>Sem2 &lt; 5</b> = 🟠 Rec 2º Sem;
      <b>Ambos &lt; 5</b> = 🟠🟠 Rec 1º e 2º Sem; ambos ≥ 5 = ⚪ Sem Recuperação.
      As duas classificações são <b>independentes</b> — um aluno pode estar aprovado E em recuperação de um ou dois semestres.
    </p>
  `;
    }

    // ====================== INICIALIZAÇÃO ======================
    carregarStorage();

    window.addEventListener('storage', function (e) {
      if (e.key === 'sistemaNotasVersao' && e.newValue) {
        // Outra aba deste navegador salvou na nuvem: adota a versão nova para
        // não gerar "conflito" quando você editar por aqui.
        const v = Number(e.newValue);
        if (Number.isFinite(v)) estadoVersao = v;
        return;
      }
      if (e.key === 'sistemaNotasTurmas' && e.newValue) {
        try {
          const dadosNovos = JSON.parse(e.newValue);
          const modoAdmin = estado.modoAdmin;
          const senhaAdmin = estado.senhaAdmin;
          const appsUrl = estado.appsUrl;
          estado = dadosNovos;
          estado.modoAdmin = modoAdmin;
          if (typeof estado.senhaAdmin !== 'string') estado.senhaAdmin = senhaAdmin || 'admin123';
          if (typeof estado.appsUrl !== 'string' || !estado.appsUrl) estado.appsUrl = appsUrl || APPS_URL_PADRAO;
          if (!estado.turmas) estado.turmas = {};
          if (perfilAtual) {
            renderAbaAtiva();
          }
        } catch (err) { }
      }
    });

    (function inicializarAjudaEstatisticas() {
      const ajudaHtml = montarAjudaEstatisticas();
      const elLivre = document.getElementById('stats-ajuda');
      const elSistema = document.getElementById('stats-ajuda-sistema');
      if (elLivre) elLivre.innerHTML = ajudaHtml;
      if (elSistema) elSistema.innerHTML = ajudaHtml;
    })();

