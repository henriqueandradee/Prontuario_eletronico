/** Erro de negocio com status HTTP associado. */
export class ErroHttp extends Error {
  constructor(status, mensagem, detalhes = null) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

export const erroRequisicao = (m, d) => new ErroHttp(400, m, d);
export const erroNaoAutenticado = (m = 'Credenciais ausentes ou invalidas.') => new ErroHttp(401, m);
export const erroSemPermissao = (m = 'Seu papel nao autoriza esta operacao.') => new ErroHttp(403, m);
export const erroNaoEncontrado = (m = 'Recurso nao encontrado.') => new ErroHttp(404, m);
export const erroConflito = (m, d) => new ErroHttp(409, m, d);
