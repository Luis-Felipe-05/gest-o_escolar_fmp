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
      if (!nome) { notificar('Digite o nome da turma!'); return; }
      if (Object.values(estado.turmas).some(t => t.nome.toLowerCase() === nome.toLowerCase())) {
        notificar('Já existe uma turma com esse nome!');
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
        notificar('A turma demo já existe! Remova-a antes de popular novamente.');
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
      notificar('Turma demo criada com sucesso!\n\n• 20 alunos\n• 4 disciplinas\n• 4 bimestres com notas variadas\n\nAcesse "Estatísticas" ou "Boletim Final" para visualizar.', 'sucesso');
    }

    // ===== Popular dados completos de exemplo (2 turmas) =====
    // Cria 2 turmas com professores, disciplinas, alunos, notas dos 4 bimestres,
    // frequências, 5º Conceito editado à mão e Situação Final — para visualizar as
    // Estatísticas, o Boletim e a aba Frequências de ponta a ponta.
    // NÃO substitui dados existentes: as turmas de exemplo levam o sufixo "(Exemplo)".
    function popularCompleto() {
      const jaExiste = Object.values(estado.turmas).some(t => /\(Exemplo\)$/.test(t.nome || ''));
      if (jaExiste) {
        notificar('As turmas de exemplo já foram criadas!\n\nApague as turmas com o sufixo "(Exemplo)" na lista de turmas antes de popular de novo.');
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
      notificar('✅ Turmas de exemplo criadas!\n\n' +
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
