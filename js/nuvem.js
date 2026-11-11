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
      sanitizarEstado(estado);
      normalizarSegredos(estado);
      if (pendentes.length) aplicarOpsLocal(pendentes, estado); // reaplica o que o usuário já tinha editado
      const campoSenha = document.getElementById('input-senha-admin');
      if (campoSenha) { campoSenha.value = ''; campoSenha.placeholder = 'Deixe em branco para manter a senha atual'; }
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
      leitor.onload = async function (e) {
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
        if (!(await confirmar('Restaurar este backup?\n\nATENÇÃO: os dados atuais serão substituídos pelos do arquivo (e a nuvem será regravada com esses dados).\n\nTurmas no backup: ' + totalTurmasBackup))) {
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
    async function restaurarBackupNuvem() {
      if (!estado.appsUrl) {
        renderBackupStatus('❌ Configure a URL do Apps Script antes de restaurar da nuvem.', 'erro');
        return;
      }
      if (!(await confirmar('Recarregar os dados da nuvem (Google Sheets)?\n\nA versão mais recente da nuvem substituirá o estado exibido agora.'))) {
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
      sanitizarEstado(estado);
      normalizarSegredos(estado);
      const campoSenha = document.getElementById('input-senha-admin');
      if (campoSenha) { campoSenha.value = ''; campoSenha.placeholder = 'Deixe em branco para manter a senha atual'; }
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
