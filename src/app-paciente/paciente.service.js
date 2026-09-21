import { erroSemPermissao, erroNaoEncontrado, erroConflito } from '../lib/errors.js';

/**
 * Servico do app do paciente (trilha DevOps).
 *
 * Regra de isolamento: o paciente le APENAS os proprios dados e nunca escreve
 * no registro clinico. Toda funcionalidade passa por feature flag, permitindo
 * desligar em producao sem redeploy.
 */
export function criarServicoPaciente(db, auditoria, flags, servicoDespacho) {
  const exigirFlag = (chave) => {
    if (!flags.ativa(chave)) throw erroConflito(`Funcionalidade '${chave}' indisponivel no momento.`);
  };

  const meuPacienteId = (ator) => {
    if (ator.papel !== 'paciente' || !ator.paciente_id) {
      throw erroSemPermissao('Rota exclusiva do app do paciente.');
    }
    return ator.paciente_id;
  };

  function meuPerfil(ator, ip) {
    const id = meuPacienteId(ator);
    const p = db.prepare(`SELECT id, nome, cpf, data_nascimento, sexo, telefone,
                                 endereco, tipo_sanguineo, cartao_sus
                          FROM pacientes WHERE id = ?`).get(id);
    if (!p) throw erroNaoEncontrado('Cadastro de paciente nao localizado.');
    p.cpf = mascararCpf(p.cpf);
    p.alergias = db.prepare('SELECT substancia, gravidade FROM alergias WHERE paciente_id = ?').all(id);
    auditoria.registrar({ ator, acao: 'LER', entidade: 'perfil_paciente', entidadeId: id, ip });
    return p;
  }

  function meusAtendimentos(ator, ip) {
    const id = meuPacienteId(ator);
    const limite = flags.ativa('app.historico_completo') ? 100 : 5;
    const lista = db.prepare(`
      SELECT id, tipo, origem, status, classificacao_risco, queixa_principal,
             leito, aberto_em, fechado_em, desfecho
      FROM atendimentos WHERE paciente_id = ?
      ORDER BY aberto_em DESC LIMIT ?`).all(id, limite);
    auditoria.registrar({ ator, acao: 'LER', entidade: 'meus_atendimentos', entidadeId: id, ip });
    return lista;
  }

  /** Visao reduzida do atendimento: nunca expoe o prontuario integral. */
  function meuAtendimento(atendimentoId, ator, ip) {
    const id = meuPacienteId(ator);
    const at = db.prepare('SELECT * FROM atendimentos WHERE id = ? AND paciente_id = ?')
                 .get(Number(atendimentoId), id);
    if (!at) throw erroNaoEncontrado('Atendimento nao encontrado no seu historico.');

    const visao = {
      id: at.id, tipo: at.tipo, origem: at.origem, status: at.status,
      classificacao_risco: at.classificacao_risco, queixa_principal: at.queixa_principal,
      leito: at.leito, aberto_em: at.aberto_em, fechado_em: at.fechado_em, desfecho: at.desfecho,
    };

    if (flags.ativa('app.ver_prescricoes')) {
      visao.prescricoes = db.prepare(`
        SELECT pr.medicamento, pr.dose, pr.via, pr.frequencia, pr.duracao, pr.status,
               u.nome AS prescritor, u.registro_prof
        FROM prescricoes pr JOIN usuarios u ON u.id = pr.prescritor_id
        WHERE pr.atendimento_id = ? ORDER BY pr.id DESC`).all(at.id);
    }
    if (flags.ativa('app.ver_evolucoes')) {
      visao.evolucoes = db.prepare(`
        SELECT e.tipo, e.texto, e.criado_em, u.nome AS autor
        FROM evolucoes e JOIN usuarios u ON u.id = e.autor_id
        WHERE e.atendimento_id = ? AND e.tipo <> 'retificacao'
        ORDER BY e.id DESC`).all(at.id);
    }

    auditoria.registrar({ ator, acao: 'LER', entidade: 'atendimento', entidadeId: at.id,
                          detalhes: { via: 'app_paciente' }, ip });
    return visao;
  }

  /**
   * Chamado aberto pelo app. Entra na MESMA fila da central (canal app_paciente)
   * e passa pela mesma triagem - o operador ve tudo em um unico painel.
   */
  function solicitarAmbulancia(dados, ator, ip) {
    exigirFlag('app.solicitar_ambulancia');
    const id = meuPacienteId(ator);
    const p = db.prepare('SELECT nome, telefone, endereco FROM pacientes WHERE id = ?').get(id);

    const aberto = db.prepare(`SELECT protocolo FROM chamados
      WHERE paciente_id = ? AND status NOT IN ('concluido','cancelado')`).get(id);
    if (aberto) throw erroConflito(`Voce ja possui o chamado ${aberto.protocolo} em andamento.`);

    return servicoDespacho.abrirChamado({
      solicitante_nome: p.nome,
      solicitante_telefone: dados.telefone ?? p.telefone,
      endereco: dados.endereco ?? p.endereco,
      lat: dados.lat, lng: dados.lng,
      natureza: dados.natureza, descricao: dados.descricao,
      prioridade: dados.prioridade, paciente_id: id,
    }, ator, ip, 'app_paciente');
  }

  function meuChamadoAtivo(ator, ip) {
    exigirFlag('app.acompanhar_chamado');
    const id = meuPacienteId(ator);
    const ch = db.prepare(`SELECT id FROM chamados
      WHERE paciente_id = ? AND status NOT IN ('concluido','cancelado')
      ORDER BY id DESC LIMIT 1`).get(id);
    if (!ch) return null;

    const completo = servicoDespacho.obterChamado(ch.id);
    return {
      protocolo: completo.protocolo,
      status: completo.status,
      cor_triagem: completo.cor_triagem,
      classificacao: completo.classificacao,
      endereco: completo.endereco,
      aberto_em: completo.aberto_em,
      ambulancia: completo.ambulancia_prefixo
        ? { prefixo: completo.ambulancia_prefixo, tipo: completo.ambulancia_tipo,
            lat: completo.ambulancia_lat, lng: completo.ambulancia_lng }
        : null,
      eta_min: completo.eta_min ?? null,
      distancia_km: completo.distancia_km ?? null,
      linha_do_tempo: completo.eventos.map((e) => ({ tipo: e.tipo, descricao: e.descricao, em: e.criado_em })),
    };
  }

  return { meuPerfil, meusAtendimentos, meuAtendimento, solicitarAmbulancia, meuChamadoAtivo };
}

/** Minimizacao de dado pessoal na tela do app (LGPD Art. 6, III). */
export const mascararCpf = (cpf) =>
  String(cpf ?? '').replace(/^(\d{3})\d{6}(\d{2})$/, '$1.***.***-$2');
