    // ====================== CONTROLE DE ACESSO ======================
    let perfilAtual = null; // 'admin' ou 'professor'
    let professorLogado = null; // { nome, disciplinas: [discId, ...] }

    // ---------- LOGIN EM FORMULÁRIO (substitui prompt()/alert bloqueantes) ----------
    // Foca um campo (usado para pular do nome para a senha no login do professor).
    function focarCampo(idCampo) {
      const el = document.getElementById(idCampo);
      if (el) el.focus();
    }
    // As regras de acesso continuam as mesmas: admin usa a senha configurada;
    // professor usa o NOME cadastrado + senha de qualquer uma de suas disciplinas.
    const travaLoginAdmin = criarTravaTentativas();
    const travaLoginProfessor = criarTravaTentativas();

    function mostrarErroLogin(idEl, mensagem) {
      const el = document.getElementById(idEl);
      if (!el) return;
      el.textContent = mensagem || '';
      el.hidden = !mensagem;
    }
    function esconderFormsLogin() {
      ['form-login-admin', 'form-login-professor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      });
      mostrarErroLogin('erro-login-admin', '');
      mostrarErroLogin('erro-login-professor', '');
    }
    function abrirLoginAdmin() {
      esconderFormsLogin();
      const form = document.getElementById('form-login-admin');
      if (form) form.hidden = false;
      const campo = document.getElementById('input-senha-admin-login');
      if (campo) { campo.value = ''; campo.focus(); }
    }
    function abrirLoginProfessor() {
      esconderFormsLogin();
      const form = document.getElementById('form-login-professor');
      if (form) form.hidden = false;
      const campoNome = document.getElementById('input-nome-professor');
      if (campoNome) { campoNome.value = ''; campoNome.focus(); }
      const campoSenha = document.getElementById('input-senha-professor');
      if (campoSenha) campoSenha.value = '';
    }

    function enviarLoginAdmin() {
      recarregarDados();
      const campo = document.getElementById('input-senha-admin-login');
      const senha = campo ? campo.value : '';
      if (!travaLoginAdmin.podeTentar()) {
        mostrarErroLogin('erro-login-admin', 'Aguarde ' + Math.ceil(travaLoginAdmin.restanteMs() / 1000) + 's antes de tentar novamente.');
        return;
      }
      // Compara apenas com a senha configurada (o fallback fixo 'admin123'
      // era uma brecha: continuava funcionando mesmo após trocar a senha).
      if (!senhaCorreta(senha, estado.senhaAdmin)) {
        const bloqueou = travaLoginAdmin.registrarFalha(3, 5000);
        mostrarErroLogin('erro-login-admin', bloqueou
          ? 'Senha incorreta. Muitas tentativas: aguarde 5 segundos.'
          : 'Senha incorreta!');
        if (campo) campo.value = '';
        return;
      }
      travaLoginAdmin.zerar();
      if (campo) campo.value = '';
      esconderFormsLogin();
      perfilAtual = 'admin';
      mostrarSistema();
    }

    function enviarLoginProfessor() {
      recarregarDados();
      const campoNome = document.getElementById('input-nome-professor');
      const campoSenha = document.getElementById('input-senha-professor');
      const nome = campoNome ? campoNome.value.trim() : '';
      const senha = campoSenha ? campoSenha.value : '';
      if (!travaLoginProfessor.podeTentar()) {
        mostrarErroLogin('erro-login-professor', 'Aguarde ' + Math.ceil(travaLoginProfessor.restanteMs() / 1000) + 's antes de tentar novamente.');
        return;
      }
      if (!nome) { mostrarErroLogin('erro-login-professor', 'Digite seu nome de professor.'); return; }
      if (!senha) { mostrarErroLogin('erro-login-professor', 'Digite sua senha.'); return; }

      // Buscar todas as disciplinas do professor em todas as turmas
      const disciplinasProfessor = [];
      Object.entries(estado.turmas).forEach(([turmaId, turma]) => {
        if (!turma.disciplinas) return;
        turma.disciplinas.forEach(disc => {
          if (disc.professor && disc.professor.toLowerCase().trim() === nome.toLowerCase()) {
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
        const bloqueou = travaLoginProfessor.registrarFalha(3, 5000);
        mostrarErroLogin('erro-login-professor', (bloqueou ? 'Aguarde 5 segundos antes de tentar novamente.\n\n' : '') +
          'Nenhuma disciplina encontrada para esse nome de professor!\n\nVerifique se o nome está cadastrado corretamente nas turmas.');
        return;
      }

      // Listar disciplinas encontradas (mesma mensagem do fluxo antigo)
      const listaDisc = disciplinasProfessor.map(d => `- ${d.discNome} (${d.turmaNome})`).join('\n');

      // Verificar senha (mesma regra: vale a senha de QUALQUER disciplina dele)
      const senhaValida = disciplinasProfessor.some(d => senhaCorreta(senha, d.senha));
      if (!senhaValida) {
        // Por segurança, NÃO exibir as senhas na mensagem de erro.
        const bloqueou = travaLoginProfessor.registrarFalha(3, 5000);
        mostrarErroLogin('erro-login-professor', (bloqueou ? 'Senha incorreta. Muitas tentativas: aguarde 5 segundos.\n\n' : 'Senha incorreta!\n\n') +
          'Suas disciplinas encontradas:\n' + listaDisc + '\n\nSe esqueceu a senha, solicite ao administrador.');
        if (campoSenha) campoSenha.value = '';
        return;
      }

      travaLoginProfessor.zerar();
      if (campoSenha) campoSenha.value = '';
      esconderFormsLogin();
      perfilAtual = 'professor';
      professorLogado = {
        nome: nome.trim(),
        disciplinas: disciplinasProfessor
      };
      mostrarSistema();
    }

    // (substituído por enviarLoginProfessor — login em formulário, sem prompt)

    function sair() {
      perfilAtual = null;
      professorLogado = null;
      esconderFormsLogin();
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
        <button class="tab active" data-fn="mudarAba" data-args='["admin"]'>Turmas</button>
        <button class="tab" data-fn="mudarAba" data-args='["notas"]'>Lançar Notas</button>
        <button class="tab" data-fn="mudarAba" data-args='["frequencias"]'>Frequências</button>
        <button class="tab" data-fn="mudarAba" data-args='["boletim"]'>Boletim Final</button>
        <button class="tab" data-fn="mudarAba" data-args='["estatisticas"]'>📊 Estatísticas</button>
      </div>
    `;
        mudarAba('admin');
      } else {
        infoUsuario.innerHTML = `<span style="color:#2e7d32; font-weight:700;">📚 ${esc(professorLogado.nome)}</span>`;
        tabsContainer.innerHTML = `
      <div class="tabs">
        <button class="tab active" data-fn="mudarAba" data-args='["notas"]'>Lançar Notas</button>
        <button class="tab" data-fn="mudarAba" data-args='["frequencias"]'>Frequências</button>
        <button class="tab" data-fn="mudarAba" data-args='["boletim"]'>Boletim Final</button>
        <button class="tab" data-fn="mudarAba" data-args='["conceito"]'>5º Conceito</button>
        <button class="tab" data-fn="mudarAba" data-args='["estatisticas"]'>📊 Estatísticas</button>
      </div>
    `;
        mudarAba('notas');
      }
    }
