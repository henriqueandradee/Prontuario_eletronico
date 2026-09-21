import { criarRoteador } from './http/router.js';
import { ok, criado } from './http/respond.js';
import { exigirPermissao, permissoesDoPapel, PERMISSOES } from './nucleo/rbac.js';
import { senhaConfere, emitirToken } from './lib/auth.js';
import { erroNaoAutenticado, erroSemPermissao, erroRequisicao, erroNaoEncontrado } from './lib/errors.js';
import { CORES } from './nucleo/despacho.service.js';
import { config } from './config.js';

/**
 * Definicao das rotas HTTP.
 *
 * Prefixos refletem a separacao de trilhas do documento de contexto:
 *   /api/nucleo/*   -> nucleo regulado (Cascata, mudanca so com aprovacao formal)
 *   /api/app/*      -> app do paciente (DevOps, evolui com deploys frequentes)
 */
export function montarRotas({ prontuario, despacho, paciente, flags, auditoria, db }) {
  const r = criarRoteador();
  const publico = { publica: true };

  // ------------------------------ sistema ----------------------------
  r.get('/api/saude', (ctx) => ok(ctx.res, {
    status: 'ok', versao: config.versao, baseline: config.baseline,
    ambiente: config.ambiente, horario: new Date().toISOString(),
  }), publico);

  r.get('/api/info', (ctx) => ok(ctx.res, {
    sistema: 'Prontuario Eletronico Hospitalar e Despacho de Ambulancias',
    trilhas: {
      nucleo_regulado: { processo: 'Cascata', prefixo: '/api/nucleo', mudanca: 'aprovacao formal do P.M.' },
      app_paciente: { processo: 'DevOps', prefixo: '/api/app', mudanca: 'deploy continuo com feature flags' },
    },
    papeis: Object.keys(PERMISSOES),
    classificacao_risco: CORES,
  }), publico);

  // --------------------------- autenticacao --------------------------
  r.post('/api/login', (ctx) => {
    const { email, senha } = ctx.corpo ?? {};
    if (!email || !senha) throw erroRequisicao('Informe email e senha.');

    const u = db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(String(email).toLowerCase());
    if (!u || !senhaConfere(senha, u.senha_hash)) {
      auditoria.registrar({ ator: { nome: String(email), papel: 'desconhecido' },
                            acao: 'LOGIN_FALHOU', entidade: 'sessao', ip: ctx.ip });
      throw erroNaoAutenticado('Email ou senha incorretos.');
    }

    const token = emitirToken(u);
    auditoria.registrar({ ator: { sub: u.id, nome: u.nome, papel: u.papel },
                          acao: 'LOGIN', entidade: 'sessao', entidadeId: u.id, ip: ctx.ip });
    return ok(ctx.res, {
      token,
      usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel,
                 registro_prof: u.registro_prof, paciente_id: u.paciente_id },
      permissoes: permissoesDoPapel(u.papel),
    });
  }, publico);

  r.get('/api/eu', (ctx) => ok(ctx.res, {
    usuario: ctx.ator, permissoes: permissoesDoPapel(ctx.ator.papel),
  }));

  // ======================= NUCLEO REGULADO: PRONTUARIO ================
  r.get('/api/nucleo/pacientes', (ctx) => {
    exigirPermissao(ctx.ator, 'paciente:ler');
    return ok(ctx.res, prontuario.listarPacientes({ busca: ctx.query.get('busca') ?? '' }));
  });

  r.post('/api/nucleo/pacientes', (ctx) => {
    exigirPermissao(ctx.ator, 'paciente:criar');
    return criado(ctx.res, prontuario.cadastrarPaciente(ctx.corpo, ctx.ator, ctx.ip));
  });

  r.get('/api/nucleo/pacientes/:id', (ctx) => {
    exigirPermissao(ctx.ator, 'paciente:ler');
    return ok(ctx.res, prontuario.obterPaciente(Number(ctx.params.id)));
  });

  r.post('/api/nucleo/pacientes/:id/alergias', (ctx) => {
    exigirPermissao(ctx.ator, 'alergia:registrar');
    return criado(ctx.res, prontuario.registrarAlergia(Number(ctx.params.id), ctx.corpo, ctx.ator, ctx.ip));
  });

  r.get('/api/nucleo/atendimentos', (ctx) => {
    exigirPermissao(ctx.ator, 'atendimento:ler');
    return ok(ctx.res, prontuario.listarAtendimentos({
      status: ctx.query.get('status') ?? 'abertos',
      paciente_id: ctx.query.get('paciente_id'),
    }));
  });

  r.post('/api/nucleo/atendimentos', (ctx) => {
    exigirPermissao(ctx.ator, 'atendimento:abrir');
    return criado(ctx.res, prontuario.abrirAtendimento(ctx.corpo, ctx.ator, ctx.ip));
  });

  r.get('/api/nucleo/atendimentos/:id', (ctx) => {
    exigirPermissao(ctx.ator, 'atendimento:ler');
    return ok(ctx.res, prontuario.obterAtendimento(Number(ctx.params.id), ctx.ator, ctx.ip));
  });

  r.patch('/api/nucleo/atendimentos/:id', (ctx) => {
    exigirPermissao(ctx.ator, 'atendimento:atualizar');
    return ok(ctx.res, prontuario.atualizarAtendimento(Number(ctx.params.id), ctx.corpo, ctx.ator, ctx.ip));
  });

  r.post('/api/nucleo/atendimentos/:id/encerrar', (ctx) => {
    exigirPermissao(ctx.ator, 'atendimento:encerrar');
    return ok(ctx.res, prontuario.encerrarAtendimento(Number(ctx.params.id), ctx.corpo, ctx.ator, ctx.ip));
  });

  r.post('/api/nucleo/atendimentos/:id/evolucoes', (ctx) => {
    exigirPermissao(ctx.ator, 'evolucao:registrar');
    return criado(ctx.res, prontuario.registrarEvolucao(Number(ctx.params.id), ctx.corpo, ctx.ator, ctx.ip));
  });

  r.post('/api/nucleo/atendimentos/:id/sinais-vitais', (ctx) => {
    exigirPermissao(ctx.ator, 'sinais:registrar');
    return criado(ctx.res, prontuario.registrarSinaisVitais(Number(ctx.params.id), ctx.corpo, ctx.ator, ctx.ip));
  });

  r.post('/api/nucleo/atendimentos/:id/prescricoes', (ctx) => {
    exigirPermissao(ctx.ator, 'prescricao:criar');
    return criado(ctx.res, prontuario.prescrever(Number(ctx.params.id), ctx.corpo, ctx.ator, ctx.ip));
  });

  r.patch('/api/nucleo/prescricoes/:id', (ctx) => {
    exigirPermissao(ctx.ator, 'prescricao:atualizar');
    return ok(ctx.res, prontuario.alterarStatusPrescricao(Number(ctx.params.id), ctx.corpo?.status, ctx.ator, ctx.ip));
  });

  // ======================= NUCLEO REGULADO: DESPACHO ==================
  r.get('/api/nucleo/chamados', (ctx) => {
    exigirPermissao(ctx.ator, 'chamado:ler');
    return ok(ctx.res, despacho.listarChamados({ status: ctx.query.get('status') ?? 'ativos' }));
  });

  r.post('/api/nucleo/chamados', (ctx) => {
    exigirPermissao(ctx.ator, 'chamado:abrir');
    return criado(ctx.res, despacho.abrirChamado(ctx.corpo, ctx.ator, ctx.ip, 'central'));
  });

  r.get('/api/nucleo/chamados/:id', (ctx) => {
    exigirPermissao(ctx.ator, 'chamado:ler');
    return ok(ctx.res, despacho.obterChamado(Number(ctx.params.id)));
  });

  r.get('/api/nucleo/chamados/:id/sugestao', (ctx) => {
    exigirPermissao(ctx.ator, 'chamado:despachar');
    return ok(ctx.res, despacho.sugerirDespacho(Number(ctx.params.id)));
  });

  r.post('/api/nucleo/chamados/:id/despachar', (ctx) => {
    exigirPermissao(ctx.ator, 'chamado:despachar');
    return ok(ctx.res, despacho.despachar(Number(ctx.params.id), ctx.corpo ?? {}, ctx.ator, ctx.ip));
  });

  r.post('/api/nucleo/chamados/:id/avancar', (ctx) => {
    exigirPermissao(ctx.ator, 'chamado:atualizar');
    return ok(ctx.res, despacho.avancarChamado(Number(ctx.params.id), ctx.ator, ctx.ip));
  });

  r.post('/api/nucleo/chamados/:id/cancelar', (ctx) => {
    exigirPermissao(ctx.ator, 'chamado:cancelar');
    return ok(ctx.res, despacho.cancelarChamado(Number(ctx.params.id), ctx.corpo?.motivo, ctx.ator, ctx.ip));
  });

  // Integracao entre os dois modulos do nucleo (risco 3 do documento).
  r.post('/api/nucleo/chamados/:id/admitir', (ctx) => {
    exigirPermissao(ctx.ator, 'atendimento:abrir');
    return criado(ctx.res, despacho.admitirNoHospital(
      Number(ctx.params.id), ctx.corpo ?? {}, prontuario, ctx.ator, ctx.ip));
  });

  r.get('/api/nucleo/ambulancias', (ctx) => {
    exigirPermissao(ctx.ator, 'ambulancia:ler');
    return ok(ctx.res, despacho.listarAmbulancias());
  });

  r.patch('/api/nucleo/ambulancias/:id', (ctx) => {
    exigirPermissao(ctx.ator, 'ambulancia:atualizar_status');
    return ok(ctx.res, despacho.atualizarAmbulancia(Number(ctx.params.id), ctx.corpo, ctx.ator, ctx.ip));
  });

  r.get('/api/nucleo/indicadores', (ctx) => {
    exigirPermissao(ctx.ator, 'chamado:ler');
    return ok(ctx.res, despacho.indicadores());
  });

  // ======================= NUCLEO REGULADO: AUDITORIA =================
  r.get('/api/nucleo/auditoria', (ctx) => {
    exigirPermissao(ctx.ator, 'auditoria:ler');
    const entidade = ctx.query.get('entidade');
    const limite = Math.min(Number(ctx.query.get('limite')) || 100, 500);
    const linhas = entidade
      ? db.prepare('SELECT * FROM auditoria WHERE entidade = ? ORDER BY id DESC LIMIT ?').all(entidade, limite)
      : db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT ?').all(limite);
    return ok(ctx.res, linhas);
  });

  r.get('/api/nucleo/auditoria/integridade', (ctx) => {
    exigirPermissao(ctx.ator, 'auditoria:ler');
    return ok(ctx.res, auditoria.verificarCadeia());
  });

  // ========================= APP DO PACIENTE (DevOps) =================
  r.get('/api/app/flags', (ctx) => ok(ctx.res, flags.mapa()), publico);

  r.patch('/api/app/flags/:chave', (ctx) => {
    if (ctx.ator.papel !== 'admin') throw erroSemPermissao('Somente administradores alteram feature flags.');
    const alterou = flags.definir(ctx.params.chave, ctx.corpo?.ativo);
    if (!alterou) throw erroNaoEncontrado(`Flag '${ctx.params.chave}' nao existe.`);
    auditoria.registrar({ ator: ctx.ator, acao: 'ATUALIZAR', entidade: 'feature_flag',
                          entidadeId: ctx.params.chave, detalhes: { ativo: Boolean(ctx.corpo?.ativo) }, ip: ctx.ip });
    return ok(ctx.res, flags.listar());
  });

  r.get('/api/app/perfil', (ctx) => ok(ctx.res, paciente.meuPerfil(ctx.ator, ctx.ip)));
  r.get('/api/app/atendimentos', (ctx) => ok(ctx.res, paciente.meusAtendimentos(ctx.ator, ctx.ip)));
  r.get('/api/app/atendimentos/:id', (ctx) => ok(ctx.res, paciente.meuAtendimento(ctx.params.id, ctx.ator, ctx.ip)));
  r.post('/api/app/ambulancia', (ctx) => criado(ctx.res, paciente.solicitarAmbulancia(ctx.corpo ?? {}, ctx.ator, ctx.ip)));
  r.get('/api/app/ambulancia', (ctx) => ok(ctx.res, paciente.meuChamadoAtivo(ctx.ator, ctx.ip)));

  return r;
}
