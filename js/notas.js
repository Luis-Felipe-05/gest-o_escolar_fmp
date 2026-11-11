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
        notificar('Nota inválida! Digite um número entre 0 e 10.');
        if (callbackRender) callbackRender();
        return { valido: false };
      }

      if (nota < 0 || nota > 10) {
        notificar('A nota deve ser entre 0 e 10!');
        if (callbackRender) callbackRender();
        return { valido: false };
      }

      if (!Number.isInteger(nota)) {
        const notaBaixo = Math.floor(nota);
        const notaCima = Math.ceil(nota);
        notificar(`⚠️ A nota deve ser um número INTEIRO entre 0 e 10.\n\nVocê digitou: ${nota}\n\nArredonde manualmente:\n  → Para baixo: ${notaBaixo}\n  → Para cima: ${notaCima}\n\nA nota NÃO foi salva. Digite um número inteiro.`);
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
                          value="${nota !== undefined ? esc(nota) : ''}"
                          placeholder="0-10"
                          data-fn="salvarNotaAdminMultiBim" data-ev="change"
                          data-args='["${turmaId}", "${d.id}", "${aluno.id}", ${b}, "@value"]'>
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
                            value="${nota !== undefined ? esc(nota) : ''}"
                            placeholder="0-10"
                            data-fn="salvarNota" data-ev="change"
                            data-args='["${turmaId}", "${d.id}", "${aluno.id}", "@value"]'>
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
