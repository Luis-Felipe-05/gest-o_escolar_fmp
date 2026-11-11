    // ====================== MODO ADMIN DE NOTAS ======================
    function salvarSenhaAdmin() {
      const campo = document.getElementById('input-senha-admin');
      const novaSenha = campo.value.trim();
      if (!novaSenha) {
        // Campo em branco = mantém a senha atual (a senha salva nunca é exibida).
        notificar('Nenhuma senha nova digitada — a senha atual foi mantida.', 'info');
        return;
      }
      estado.senhaAdmin = hashSenha(novaSenha);
      campo.value = '';
      salvarStorage();
      notificar('Senha do administrador atualizada com sucesso!', 'sucesso');
    }

    async function removerTurma(turmaId) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      if (!(await confirmar(`Remover a turma "${turma.nome}" e todo seu conteúdo?`))) return;
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
        <button class="btn-success btn-sm" data-fn="salvarTurmaEdit" data-args='["${turmaId}"]'>Salvar</button>
        <button class="btn-danger btn-sm" data-fn="renderAdmin">Cancelar</button>
      </div>
    `;
        document.getElementById(`ed-turma-${turmaId}`).focus();
      }
    }

    function salvarTurmaEdit(turmaId) {
      const turma = getTurma(turmaId);
      if (!turma) return;
      const nome = document.getElementById(`ed-turma-${turmaId}`).value.trim();
      if (!nome) { notificar('Digite o nome da turma!'); return; }
      if (Object.entries(estado.turmas).some(([id, t]) => id !== turmaId && t.nome.toLowerCase() === nome.toLowerCase())) {
        notificar('Já existe uma turma com esse nome!');
        return;
      }
      turma.nome = nome;
      salvarStorage();
      renderAdmin();
      notificar('Turma atualizada com sucesso!', 'sucesso');
    }

    // ====================== DISCIPLINAS ======================
    function adicionarDisciplina(turmaId) {
      const turma = getTurma(turmaId);
      const profInput = document.getElementById(`prof-${turmaId}`);
      const senhaInput = document.getElementById(`senha-${turmaId}`);

      const prof = profInput.value.trim();
      const senha = senhaInput.value.trim();

      if (!prof) { notificar('Digite o nome do professor!'); return; }
      if (!senha) { notificar('Digite a senha do professor!'); return; }

      const discInputs = document.querySelectorAll(`#lista-disc-inputs-${turmaId} .disc-input`);
      const nomesDisc = [];
      discInputs.forEach(input => {
        const v = input.value.trim();
        if (v) nomesDisc.push(v);
      });

      if (nomesDisc.length === 0) { notificar('Adicione pelo menos uma disciplina!'); return; }

      let adicionadas = 0;
      let duplicadas = [];
      nomesDisc.forEach(nome => {
        if (turma.disciplinas.some(d => d.nome.toLowerCase() === nome.toLowerCase())) {
          duplicadas.push(nome);
          return;
        }
        turma.disciplinas.push({ id: genId(), nome, professor: prof, senha: hashSenha(senha) });
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
        <button type="button" class="btn-danger btn-sm" data-fn="removerDiscInput" data-args='["@el"]'>−</button>
      </div>
    `;
        salvarStorage();
        renderAdmin();
      }

      let msg = '';
      if (adicionadas > 0) msg += `✅ ${adicionadas} disciplina(s) cadastrada(s) para o professor "${prof}".\n`;
      if (duplicadas.length > 0) msg += `⚠️ Já existiam: ${duplicadas.join(', ')}`;
      if (msg) notificar(msg, adicionadas > 0 ? 'sucesso' : 'info');
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
    <button type="button" class="btn-danger btn-sm" data-fn="removerDiscInput" data-args='["@el"]'>−</button>
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

    async function removerDisciplina(turmaId, discId) {
      const turma = getTurma(turmaId);
      if (!(await confirmar('Remover disciplina e suas notas?'))) return;
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

      // Identifica o professor pelo PRÓPRIO grupo (mesma regra do agrupamento:
      // grupoId = 'g-' + nome sem caracteres especiais). Antes o código lia o
      // nome da linha anterior no DOM — frágil: qualquer mudança no layout
      // quebraria a edição ou apontasse para o professor errado.
      const chaveGrupo = String(grupoId).replace(/^g-/, '').toLowerCase();
      const primeiro = (turma.disciplinas || []).find(d =>
        String(d.professor || '').replace(/[^a-z0-9]/gi, '').toLowerCase() === chaveGrupo
      );
      if (!primeiro) return;
      const profAntigo = primeiro.professor;

      // Filtrar disciplinas deste professor (case-insensitive, como no agrupamento)
      const discsDoProf = turma.disciplinas.filter(d => String(d.professor || '').toLowerCase() === String(profAntigo).toLowerCase());
      if (discsDoProf.length === 0) return;
      const idsDiscs = discsDoProf.map(d => d.id);

      box.innerHTML = `
    <div style="background:#fff3cd; padding:15px; border-radius:6px; margin:5px 0;">
      <div class="form-row">
        <div class="form-field" style="flex:1; min-width:200px;">
          <label>Nome do Professor</label>
          <input type="text" id="ed-prof-nome-${grupoId}" value="${esc(profAntigo)}">
        </div>
        <div class="form-field" style="flex:1; min-width:200px;">
          <label>Senha do Professor</label>
          <div class="senha-vis">
            <input type="password" id="ed-prof-senha-${grupoId}" autocomplete="new-password"
              placeholder="Deixe em branco para manter a senha atual">
            <button type="button" class="toggle-senha" data-fn="toggleSenhaVis"
              data-args='["ed-prof-senha-${grupoId}", "@el"]'
              aria-label="Mostrar ou ocultar senha">👁</button>
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
              <button type="button" class="btn-danger btn-sm" data-fn="removerDiscEdit" data-args='["@el"]'>−</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="btn-primary btn-sm" style="margin-top:8px;" data-fn="adicionarDiscEdit" data-args='["${grupoId}"]'>+ Adicionar outra disciplina</button>
      </div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn-success btn-sm" data-fn="salvarProfessorEdit" data-args='["${turmaId}", "${grupoId}", "${idsDiscs.join(',')}"]'>Salvar Tudo</button>
        <button class="btn-danger btn-sm" data-fn="renderAdmin">Cancelar</button>
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
    <button type="button" class="btn-danger btn-sm" data-fn="removerDiscEdit" data-args='["@el"]'>−</button>
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
        notificar('O professor precisa ter pelo menos 1 disciplina! Se quiser remover todas, remova o professor (excluindo cada disciplina).');
        return;
      }
      if (lista.querySelectorAll('.disc-edit-row').length <= 1) {
        notificar('O professor precisa ter pelo menos 1 disciplina!');
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
      // Em branco = mantém a senha atual (a senha salva nunca é exibida).
      const novaSenha = document.getElementById(`ed-prof-senha-${grupoId}`).value.trim();

      if (!novoNome) { notificar('Digite o nome do professor!'); return; }
      const senhaExistente = (turma.disciplinas.find(x => idsDiscs.includes(x.id)) || {}).senha || '';
      const senhaFinal = novaSenha ? hashSenha(novaSenha) : senhaExistente;
      if (!senhaFinal) { notificar('Digite a senha do professor!'); return; }

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
        notificar('O professor precisa ter pelo menos 1 disciplina ativa!');
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
        notificar(`Já existem estas disciplinas na turma: ${duplicatas.join(', ')}`);
        return;
      }

      // Atualizar nome e senha em todas as disciplinas do professor
      idsDiscs.forEach(id => {
        const d = turma.disciplinas.find(x => x.id === id);
        if (d) {
          d.professor = novoNome;
          d.senha = senhaFinal;
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
          turma.disciplinas.push({ id: genId(), nome: v, professor: novoNome, senha: senhaFinal });
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
      notificar('Professor atualizado com sucesso!', 'sucesso');
    }

    // ====================== ALUNOS ======================
    function adicionarAluno(turmaId) {
      const turma = getTurma(turmaId);
      const input = document.getElementById(`aluno-${turmaId}`);
      const nome = input.value.trim();
      if (!nome) { notificar('Digite o nome do aluno!'); return; }
      if (turma.alunos.some(a => a.nome.toLowerCase() === nome.toLowerCase())) {
        notificar('Aluno já cadastrado nesta turma!');
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
        <button class="btn-success btn-sm" data-fn="salvarAlunoEdit" data-args='["${turmaId}", "${alunoId}"]'>Salvar</button>
        <button class="btn-danger btn-sm" data-fn="renderAdmin">Cancelar</button>
      </div>
    `;
      }
    }

    function salvarAlunoEdit(turmaId, alunoId) {
      const turma = getTurma(turmaId);
      const aluno = turma.alunos.find(a => a.id === alunoId);
      if (!aluno) return;
      const nome = document.getElementById(`ed-aluno-${alunoId}`).value.trim();
      if (!nome) { notificar('Digite o nome do aluno!'); return; }
      if (turma.alunos.some(a => a.id !== alunoId && a.nome.toLowerCase() === nome.toLowerCase())) {
        notificar('Já existe um aluno com esse nome nesta turma!');
        return;
      }
      aluno.nome = nome;
      salvarStorage();
      renderAdmin();
      notificar('Aluno atualizado com sucesso!', 'sucesso');
    }

    function importarPlanilha(turmaId, event) {
      const file = event.target.files[0];
      if (!file) return;
      if (typeof XLSX === 'undefined') {
        notificar('A biblioteca para ler planilhas não pôde ser carregada. Verifique sua conexão.');
        event.target.value = '';
        return;
      }
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
          notificar(`Importação concluída!\n✅ ${add} aluno(s) adicionado(s)\n⚠️ ${skip} ignorado(s) (já cadastrados)`, 'sucesso');
          event.target.value = '';
        } catch (err) {
          notificar('Erro ao ler planilha: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function baixarTemplateAlunos() {
      if (typeof XLSX === 'undefined') {
        notificar('A biblioteca para gerar planilhas não pôde ser carregada. Verifique sua conexão.');
        return;
      }
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
          <button class="btn-primary btn-sm" data-fn="editarTurmaForm" data-args='["${turmaId}"]'>Editar Turma</button>
          <button class="btn-danger btn-sm" data-fn="removerTurma" data-args='["${turmaId}"]'>Excluir Turma</button>
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
              <button type="button" class="toggle-senha" data-fn="toggleSenhaVis" data-args='["senha-${turmaId}", "@el"]'
                aria-label="Mostrar ou ocultar senha">👁</button>
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
              <button type="button" class="btn-danger btn-sm" data-fn="removerDiscInput" data-args='["@el"]'>−</button>
            </div>
          </div>
          <button type="button" class="btn-primary btn-sm" style="margin-top:8px;" data-fn="adicionarDiscInput" data-args='["${turmaId}"]'>+ Adicionar outra disciplina</button>
        </div>
        <button class="btn-success" style="margin-top:12px;" data-fn="adicionarDisciplina" data-args='["${turmaId}"]'>Cadastrar Professor + Disciplinas</button>
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
                        ${g.discs.map(d => `<div style="padding:2px 0;">• <strong>${esc(d.nome)}</strong> <button class="btn-danger btn-sm" style="font-size:9px; padding:1px 6px; margin-left:5px;" data-fn="removerDisciplina" data-args='["${turmaId}", "${d.id}"]' title="Remover esta disciplina">×</button></div>`).join('')}
                      </td>
                      <td><strong>${esc(g.professor)}</strong></td>
                      <td>
                        <button class="btn-primary btn-sm" data-fn="editarProfessorForm" data-args='["${turmaId}", "${grupoId}"]'>Editar Professor</button>
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
            data-fn="adicionarAluno" data-ev="keydown" data-key="Enter" data-args='["${turmaId}"]'>
        </div>
        <button class="btn-success" data-fn="adicionarAluno" data-args='["${turmaId}"]'>Adicionar</button>
        <div class="form-field">
          <label>Ou importar planilha (CSV/XLSX)</label>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn-secondary btn-sm" data-fn="baixarTemplateAlunos" title="Baixar modelo de planilha">📄 Baixar Template</button>
            <input type="file" accept=".csv,.xlsx,.xls" data-fn="importarPlanilha" data-ev="change" data-args='["${turmaId}", "@event"]'>
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
                      <button class="btn-primary btn-sm" data-fn="editarAlunoForm" data-args='["${turmaId}", "${a.id}"]'>Editar</button>
                      <button class="btn-danger btn-sm" data-fn="removerAluno" data-args='["${turmaId}", "${a.id}"]'>Remover</button>
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
