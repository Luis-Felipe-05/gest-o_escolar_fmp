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
