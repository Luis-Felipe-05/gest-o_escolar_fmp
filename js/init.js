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
        } catch (err) {
          console.warn('Erro ao sincronizar dados de outra aba:', err);
        }
      }
    });

    (function inicializarTelasEstatisticas() {
      // Monta as duas telas a partir do template ANTES de preencher a ajuda
      // (os ids stats-ajuda/stats-ajuda-sistema só existem após a montagem).
      montarTelasEstatisticas();
      const ajudaHtml = montarAjudaEstatisticas();
      const elLivre = document.getElementById('stats-ajuda');
      const elSistema = document.getElementById('stats-ajuda-sistema');
      if (elLivre) elLivre.innerHTML = ajudaHtml;
      if (elSistema) elSistema.innerHTML = ajudaHtml;
    })();

    // Delegação de eventos: todo o HTML usa data-fn/data-args (sem handlers
    // inline), o que permite manter a CSP sem 'unsafe-inline' em script-src.
    document.addEventListener('click', despacharEvento);
    document.addEventListener('change', despacharEvento);
    document.addEventListener('keydown', despacharEvento);
