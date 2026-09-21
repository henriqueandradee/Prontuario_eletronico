/**
 * Roteador minimo com suporte a parametros (:id).
 * Mantido sem dependencias externas para simplificar a homologacao
 * do nucleo regulado (menos superficie de terceiros a auditar).
 */
export function criarRoteador() {
  const rotas = [];

  const registrar = (metodo, padrao, manipulador, opcoes = {}) => {
    const nomes = [];
    const regex = new RegExp('^' + padrao.replace(/:([A-Za-z_]+)/g, (_, n) => {
      nomes.push(n);
      return '([^/]+)';
    }) + '$');
    rotas.push({ metodo, regex, nomes, manipulador, ...opcoes });
  };

  return {
    get: (p, h, o) => registrar('GET', p, h, o),
    post: (p, h, o) => registrar('POST', p, h, o),
    patch: (p, h, o) => registrar('PATCH', p, h, o),
    put: (p, h, o) => registrar('PUT', p, h, o),
    delete: (p, h, o) => registrar('DELETE', p, h, o),

    resolver(metodo, caminho) {
      let caminhoExiste = false;
      for (const rota of rotas) {
        const m = rota.regex.exec(caminho);
        if (!m) continue;
        caminhoExiste = true;
        if (rota.metodo !== metodo) continue;
        const params = {};
        rota.nomes.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        return { rota, params };
      }
      return caminhoExiste ? { metodoInvalido: true } : null;
    },
  };
}
