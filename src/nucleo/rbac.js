import { erroSemPermissao } from '../lib/errors.js';

/**
 * Matriz de papeis e permissoes.
 *
 * Deriva diretamente da questao 2 do documento de contexto: o nucleo regulado
 * exige papeis formais e segregacao de funcoes, porque qualquer erro afeta
 * dados medicos e o atendimento. Alterar esta matriz e mudanca no nucleo e
 * exige aprovacao formal do P.M.
 */
export const PERMISSOES = {
  admin: ['*'],

  medico: [
    'paciente:ler', 'paciente:criar', 'paciente:editar', 'alergia:registrar',
    'atendimento:ler', 'atendimento:abrir', 'atendimento:atualizar', 'atendimento:encerrar',
    'evolucao:ler', 'evolucao:registrar', 'sinais:ler', 'sinais:registrar',
    'prescricao:ler', 'prescricao:criar', 'prescricao:atualizar',
    'chamado:ler', 'ambulancia:ler',
  ],

  enfermeiro: [
    'paciente:ler', 'alergia:registrar',
    'atendimento:ler', 'atendimento:abrir', 'atendimento:atualizar',
    'evolucao:ler', 'evolucao:registrar', 'sinais:ler', 'sinais:registrar',
    'prescricao:ler', 'chamado:ler', 'ambulancia:ler',
  ],

  recepcao: [
    'paciente:ler', 'paciente:criar', 'paciente:editar',
    'atendimento:ler', 'atendimento:abrir', 'chamado:ler',
  ],

  operador_despacho: [
    'paciente:ler', 'chamado:ler', 'chamado:abrir', 'chamado:despachar',
    'chamado:atualizar', 'chamado:cancelar',
    'ambulancia:ler', 'ambulancia:atualizar_status', 'atendimento:ler',
  ],

  socorrista: [
    'chamado:ler', 'chamado:atualizar', 'ambulancia:ler', 'ambulancia:atualizar_status',
    'paciente:ler', 'sinais:registrar', 'atendimento:ler',
  ],

  // Somente leitura. Separado de admin para garantir independencia da auditoria.
  auditor: [
    'auditoria:ler', 'paciente:ler', 'atendimento:ler', 'evolucao:ler',
    'sinais:ler', 'prescricao:ler', 'chamado:ler', 'ambulancia:ler',
  ],

  // O paciente nunca acessa o nucleo: apenas as rotas do app do paciente.
  paciente: [],
};

export function temPermissao(papel, permissao) {
  const lista = PERMISSOES[papel] ?? [];
  return lista.includes('*') || lista.includes(permissao);
}

/** Lanca 403 se o ator nao possuir a permissao exigida pela rota. */
export function exigirPermissao(ator, permissao) {
  if (!temPermissao(ator?.papel, permissao)) {
    throw erroSemPermissao(`O papel '${ator?.papel}' nao possui a permissao '${permissao}'.`);
  }
}

export const permissoesDoPapel = (papel) =>
  PERMISSOES[papel]?.includes('*')
    ? [...new Set(Object.values(PERMISSOES).flat())].filter((p) => p !== '*').sort()
    : [...(PERMISSOES[papel] ?? [])].sort();
