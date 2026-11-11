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
        notificar('Frequência deve ser um valor entre 0 e 100 (%).');
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
                      value="${esc(pct)}"
                      placeholder="%"
                      autocomplete="off"
                      title="Frequência do ${b}º bimestre (0 a 100)"
                      style="${estiloFrequencia(pct)}"
                      data-fn="salvarFrequencia" data-ev="change"
                      data-args='["${turmaId}", ${b}, "${aluno.id}", "@value"]'>
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
                          value="${conceitoFinalNum !== null ? esc(conceitoFinalNum) : ''}"
                          placeholder="0-10"
                          title="${titulo}"
                          style="background:#fff3cd; border-color:${corBorda};"
                          data-fn="salvarConceitoFinal" data-ev="change"
                          data-args='["${turmaId}", "${aluno.id}", "${disc.id}", "@value"]'>
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
                        <select class="nota-input" style="width:140px; font-size:11px;" data-fn="salvarSituacaoFinal" data-ev="change"
                          data-args='["${turmaId}", "${aluno.id}", "${disc.id}", "@value"]'>
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
        notificar('Selecione uma turma para exportar o boletim.');
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
          notificar('O professor ' + professorLogado.nome + ' não possui disciplinas nesta turma.');
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
        notificar('Selecione uma turma para exportar o boletim.');
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
        notificar('A biblioteca de PDF não pôde ser carregada. Verifique sua conexão.');
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
          notificar('O professor ' + professorLogado.nome + ' não possui disciplinas nesta turma.');
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
        notificar('A biblioteca para exportar Excel não pôde ser carregada. Verifique sua conexão.');
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
        notificar('A biblioteca de PDF não pôde ser carregada. Verifique sua conexão.');
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
