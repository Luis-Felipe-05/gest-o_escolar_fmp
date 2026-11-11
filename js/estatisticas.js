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
        if (contem) {
          t.classList.toggle('active', alvo === aba);
          t.setAttribute('aria-selected', alvo === aba ? 'true' : 'false');
        }
      });
    }

    // ---------- MONTAGEM DAS TELAS DE ESTATÍSTICAS ----------
    // O conteúdo das estatísticas existe UMA única vez no HTML (dentro de
    // <template id="tpl-estatisticas">) e é clonado para as duas telas:
    // sufixo '' (tela livre) e '-sistema' (aba do sistema). Elimina a
    // duplicação de ~160 linhas no index.html.
    function aplicarSufixoEstatisticas(raiz, sufixo) {
      if (!sufixo) return;
      raiz.querySelectorAll('[id]').forEach(function (el) { el.id = el.id + sufixo; });
      raiz.querySelectorAll('[data-fn]').forEach(function (el) {
        if (el.getAttribute('data-fn') === 'mostrarAbaStats') {
          const args = interpretarArgs(el.getAttribute('data-args'));
          args[0] = sufixo;
          el.setAttribute('data-args', JSON.stringify(args));
        }
      });
    }

    function montarTelasEstatisticas() {
      const tpl = document.getElementById('tpl-estatisticas');
      if (!tpl || !tpl.content) return;
      [['stats-wrap-livre', ''], ['stats-wrap-sistema', '-sistema']].forEach(function (par) {
        const alvo = document.getElementById(par[0]);
        if (!alvo) return;
        const clone = tpl.content.cloneNode(true);
        aplicarSufixoEstatisticas(clone, par[1]);
        alvo.innerHTML = '';
        while (clone.firstChild) alvo.appendChild(clone.firstChild);
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
          turmas.map(t => `<option value="${esc(t.id)}" ${t.id === turmaIdEscolhida ? 'selected' : ''}>${esc(t.nome)}</option>`).join('');
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
          todasDiscs.map(d => `<option value="${esc(d.id)}" ${d.id === discIdEscolhida ? 'selected' : ''}>${esc(d.nome)}</option>`).join('');
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
          alunosTodas.map(a => `<option value="${esc(a.id)}" ${a.id === alunoIdEscolhido ? 'selected' : ''}>${esc(a.nome)}</option>`).join('');
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
          // Debounce: mudanças rápidas de filtro re-renderizam uma única vez
          // (recriar ~15 gráficos a cada clique é caro).
          el.addEventListener('change', () => agendarRender('stats' + suffix, () => renderEstatisticas(origem), 250));
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
      if (typeof Chart === 'undefined') {
        // CDN indisponível (offline): avisa no próprio canvas em vez de lançar erro.
        try {
          const canvas = ctx && ctx.canvas;
          const c = canvas && canvas.getContext('2d');
          if (c) {
            c.clearRect(0, 0, canvas.width, canvas.height);
            c.font = '13px sans-serif';
            c.fillStyle = '#999';
            c.textAlign = 'center';
            c.fillText('Gráfico indisponível (Chart.js não carregou).', (canvas.width || 400) / 2, (canvas.height || 200) / 2);
          }
        } catch (e) { console.warn('Sem gráfico disponível:', e); }
        return;
      }
      if (!window.__chartDarkApplied) {
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
