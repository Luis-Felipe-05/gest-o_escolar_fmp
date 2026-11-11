    // ====================== ACESSO RESTRITO (somente desenvolvedor) ======================
    // Senha do Acesso Restrito guardada APENAS como hash — o texto original não
    // existe mais no código-fonte. Comparação via senhaCorreta() (formato v1:).
    const SENHA_ACESSO_RESTRITO_HASH = 'v1:dedab90e73881229da94738eece0bc8a4e5530503fe421d64e57ac8e24757b2c';

    const travaAcessoRestrito = criarTravaTentativas();

    function abrirAcessoRestrito() {
      document.getElementById('tela-login').style.display = 'none';
      document.getElementById('sistema-principal').style.display = 'none';
      document.getElementById('tela-estatisticas').style.display = 'none';
      document.getElementById('tela-boletim-publico').style.display = 'none';
      document.getElementById('tela-acesso-restrito').style.display = 'block';
      // Reset form
      document.getElementById('restrito-login-form').style.display = 'block';
      document.getElementById('restrito-content').style.display = 'none';
      document.getElementById('input-senha-restrito').value = '';
      mostrarErroLogin('erro-restrito', '');
      document.getElementById('input-senha-restrito').focus();
    }

    function validarAcessoRestrito() {
      const campo = document.getElementById('input-senha-restrito');
      const senha = campo ? campo.value : '';
      if (!travaAcessoRestrito.podeTentar()) {
        mostrarErroLogin('erro-restrito', 'Aguarde ' + Math.ceil(travaAcessoRestrito.restanteMs() / 1000) + 's antes de tentar novamente.');
        return;
      }
      // Mesma senha de sempre; a trava limita tentativas (evita força bruta).
      if (senhaCorreta(senha, SENHA_ACESSO_RESTRITO_HASH)) {
        travaAcessoRestrito.zerar();
        mostrarErroLogin('erro-restrito', '');
        document.getElementById('restrito-login-form').style.display = 'none';
        document.getElementById('restrito-content').style.display = 'block';
        // Carregar URL atual da nuvem no input
        const campoUrl = document.getElementById('input-apps-url');
        if (campoUrl) campoUrl.value = estado.appsUrl || '';
      } else {
        const bloqueou = travaAcessoRestrito.registrarFalha(5, 60000);
        mostrarErroLogin('erro-restrito', bloqueou
          ? 'Senha incorreta. Acesso negado — aguarde 60 segundos.'
          : 'Senha incorreta. Acesso negado.');
        if (campo) { campo.value = ''; campo.focus(); }
      }
    }

    function sairAcessoRestrito() {
      document.getElementById('tela-acesso-restrito').style.display = 'none';
      document.getElementById('tela-login').style.display = 'block';
      esconderFormsLogin();
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
      esconderFormsLogin();
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
      esconderFormsLogin();
    }

    function atualizarBoletimPublico(btn) {
      if (!estado.appsUrl) {
        notificar('Nuvem não configurada. Os dados mostram apenas o armazenamento local.', 'aviso');
        return;
      }
      const alvo = (btn && btn.tagName === 'BUTTON') ? btn : null;
      if (alvo) { alvo.disabled = true; alvo.textContent = '⏳ Atualizando...'; }
      carregarDaNuvem().then(function (dados) {
        if (dados) {
          aplicarDadosNuvem(dados, false); // false = não preservar locais (recarrega tudo da nuvem)
        }
        if (alvo) { alvo.disabled = false; alvo.textContent = '🔄 Atualizar'; }
      }).catch(function (e) {
        console.error('Erro ao atualizar:', e);
        if (alvo) { alvo.disabled = false; alvo.textContent = '🔄 Atualizar'; }
        notificar('Falha ao recarregar da nuvem: ' + e.message);
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
      if (!turmaId) { notificar('Selecione uma turma primeiro.'); return; }
      const turma = getTurma(turmaId);
      if (!turma) return;
      const disciplinasVisiveis = (turma.disciplinas || []);
      exportarBoletimExcelInterno(turma, disciplinasVisiveis, true);
    }

    function exportarBoletimPublicoPDF() {
      const turmaId = document.getElementById('select-turma-boletim-publico').value;
      if (!turmaId) { notificar('Selecione uma turma primeiro.'); return; }
      const turma = getTurma(turmaId);
      if (!turma) return;
      const disciplinasVisiveis = (turma.disciplinas || []);
      exportarBoletimPDFInterno(turma, disciplinasVisiveis, true);
    }
