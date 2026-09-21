import { validar } from '../lib/validate.js';
import { distanciaKm, etaMinutos } from '../lib/geo.js';
import { erroRequisicao, erroConflito, erroNaoEncontrado } from '../lib/errors.js';
import { emTransacao } from '../db/index.js';

/**
 * Protocolo de classificacao de risco (inspirado no Protocolo de Manchester).
 * Prioridade 1 e a mais alta. USA = Unidade de Suporte Avancado (medico a bordo).
 */
export const CORES = {
  1: { cor: 'vermelho', rotulo: 'Emergencia',    tempoAlvoMin: 0,   exigeUSA: true },
  2: { cor: 'laranja',  rotulo: 'Muito urgente', tempoAlvoMin: 10,  exigeUSA: true },
  3: { cor: 'amarelo',  rotulo: 'Urgente',       tempoAlvoMin: 60,  exigeUSA: false },
  4: { cor: 'verde',    rotulo: 'Pouco urgente', tempoAlvoMin: 120, exigeUSA: false },
  5: { cor: 'azul',     rotulo: 'Nao urgente',   tempoAlvoMin: 240, exigeUSA: false },
};

/** Naturezas que elevam a prioridade independentemente do relato. */
const PISO_POR_NATUREZA = { cardiaco: 2, respiratorio: 2, obstetrico: 2, trauma: 3, intoxicacao: 2 };

const SINAIS_CRITICOS = [
  'parada', 'inconsciente', 'nao respira', 'nao responde', 'sangramento intenso',
  'convuls', 'afogamento', 'choque eletrico', 'queimadura grave',
];

/**
 * Triagem: combina o relato, a natureza e a prioridade informada pelo operador.
 * Sempre prevalece a classificacao MAIS grave - protege contra subtriagem.
 */
export function triar({ natureza, descricao = '', prioridadeInformada }) {
  const texto = String(descricao).toLowerCase();
  const motivos = [];
  let prioridade = Number(prioridadeInformada) || 4;
  if (prioridadeInformada) motivos.push(`prioridade ${prioridade} informada na abertura`);

  const piso = PISO_POR_NATUREZA[natureza];
  if (piso && piso < prioridade) {
    prioridade = piso;
    motivos.push(`natureza '${natureza}' eleva para prioridade ${piso}`);
  }

  const gatilho = SINAIS_CRITICOS.find((s) => texto.includes(s));
  if (gatilho && prioridade > 1) {
    prioridade = 1;
    motivos.push(`sinal critico no relato: '${gatilho}'`);
  }

  return { prioridade, ...CORES[prioridade], motivos };
}

/**
 * Selecao da ambulancia. Ordena por: adequacao do recurso, depois distancia.
 * Prioridades 1 e 2 nao aceitam USB quando existe USA disponivel.
 */
export function escolherAmbulancia(disponiveis, chamado) {
  const exigeUSA = CORES[chamado.prioridade].exigeUSA;
  const candidatas = disponiveis.map((amb) => {
    const km = distanciaKm(amb.lat, amb.lng, chamado.lat, chamado.lng);
    const adequada = !exigeUSA || amb.tipo === 'USA';
    return { ...amb, distancia_km: Number(km.toFixed(2)), eta_min: etaMinutos(km), adequada };
  });

  const temUSA = candidatas.some((c) => c.tipo === 'USA');
  const elegiveis = exigeUSA && temUSA ? candidatas.filter((c) => c.tipo === 'USA') : candidatas;

  elegiveis.sort((a, b) => a.distancia_km - b.distancia_km);
  return { escolhida: elegiveis[0] ?? null, candidatas: candidatas.sort((a, b) => a.distancia_km - b.distancia_km) };
}

export function criarServicoDespacho(db, auditoria) {
  const proximoProtocolo = () => {
    const ano = new Date().getFullYear();
    const seq = db.prepare("SELECT COUNT(*) AS n FROM chamados WHERE protocolo LIKE ?").get(`${ano}-%`).n + 1;
    return `${ano}-${String(seq).padStart(6, '0')}`;
  };

  const registrarEvento = (chamadoId, tipo, descricao, autorId = null) =>
    db.prepare('INSERT INTO chamado_eventos (chamado_id, tipo, descricao, autor_id) VALUES (?,?,?,?)')
      .run(chamadoId, tipo, descricao, autorId);

  // ------------------------------ chamados ---------------------------
  function abrirChamado(dados, ator, ip, canal = 'central') {
    const c = validar(dados, {
      solicitante_nome: { obrigatorio: true, min: 3, max: 120 },
      solicitante_telefone: { max: 20 },
      endereco: { obrigatorio: true, min: 5, max: 300 },
      lat: { obrigatorio: true, tipo: 'numero', min: -90, max: 90 },
      lng: { obrigatorio: true, tipo: 'numero', min: -180, max: 180 },
      natureza: { obrigatorio: true, opcoes: Object.keys({
        clinico: 1, trauma: 1, cardiaco: 1, respiratorio: 1, obstetrico: 1,
        psiquiatrico: 1, intoxicacao: 1, transferencia: 1 }) },
      descricao: { max: 1000 },
      prioridade: { tipo: 'numero', min: 1, max: 5 },
      paciente_id: { tipo: 'numero' },
    });

    if (c.paciente_id && !db.prepare('SELECT 1 FROM pacientes WHERE id = ?').get(c.paciente_id)) {
      throw erroNaoEncontrado(`Paciente #${c.paciente_id} nao encontrado.`);
    }

    const triagem = triar({ natureza: c.natureza, descricao: c.descricao,
                            prioridadeInformada: c.prioridade });
    const protocolo = proximoProtocolo();

    return emTransacao(db, () => {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO chamados (protocolo, canal, solicitante_nome, solicitante_telefone, paciente_id,
                              endereco, lat, lng, natureza, descricao, prioridade, cor_triagem, aberto_por)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        protocolo, canal, c.solicitante_nome, c.solicitante_telefone ?? null, c.paciente_id ?? null,
        c.endereco, c.lat, c.lng, c.natureza, c.descricao ?? null,
        triagem.prioridade, triagem.cor, ator?.sub ?? null);

      const id = Number(lastInsertRowid);
      registrarEvento(id, 'abertura', `Chamado aberto via ${canal}. Triagem: ${triagem.cor} (P${triagem.prioridade}). ${triagem.motivos.join('; ')}`, ator?.sub);
      auditoria.registrar({ ator, acao: 'ABRIR', entidade: 'chamado', entidadeId: id,
                            detalhes: { protocolo, triagem, canal }, ip });
      return { ...obterChamado(id), triagem };
    });
  }

  function obterChamado(id) {
    const ch = db.prepare(`
      SELECT c.*, a.prefixo AS ambulancia_prefixo, a.tipo AS ambulancia_tipo,
             a.lat AS ambulancia_lat, a.lng AS ambulancia_lng, a.equipe AS ambulancia_equipe,
             p.nome AS paciente_nome
      FROM chamados c
      LEFT JOIN ambulancias a ON a.id = c.ambulancia_id
      LEFT JOIN pacientes p ON p.id = c.paciente_id
      WHERE c.id = ?`).get(id);
    if (!ch) throw erroNaoEncontrado(`Chamado #${id} nao encontrado.`);

    ch.eventos = db.prepare(`
      SELECT e.*, u.nome AS autor_nome FROM chamado_eventos e
      LEFT JOIN usuarios u ON u.id = e.autor_id
      WHERE e.chamado_id = ? ORDER BY e.id ASC`).all(id);
    ch.classificacao = CORES[ch.prioridade];

    if (ch.ambulancia_lat != null && ['despachado', 'a_caminho'].includes(ch.status)) {
      const km = distanciaKm(ch.ambulancia_lat, ch.ambulancia_lng, ch.lat, ch.lng);
      ch.distancia_km = Number(km.toFixed(2));
      ch.eta_min = etaMinutos(km);
    }
    return ch;
  }

  function listarChamados({ status = 'ativos' } = {}) {
    const filtro = status === 'ativos'
      ? "c.status NOT IN ('concluido','cancelado')"
      : status === 'todos' ? '1=1' : 'c.status = ?';
    const args = ['ativos', 'todos'].includes(status) ? [] : [status];

    return db.prepare(`
      SELECT c.id, c.protocolo, c.canal, c.solicitante_nome, c.endereco, c.lat, c.lng,
             c.natureza, c.prioridade, c.cor_triagem, c.status, c.aberto_em, c.despachado_em,
             c.paciente_id, a.prefixo AS ambulancia_prefixo, a.tipo AS ambulancia_tipo,
             CAST((julianday('now') - julianday(c.aberto_em)) * 1440 AS INTEGER) AS espera_min
      FROM chamados c LEFT JOIN ambulancias a ON a.id = c.ambulancia_id
      WHERE ${filtro}
      ORDER BY c.prioridade ASC, c.aberto_em ASC`).all(...args);
  }

  /** Sugestao de despacho sem efeito colateral - o operador confirma antes. */
  function sugerirDespacho(chamadoId) {
    const ch = obterChamado(chamadoId);
    if (ch.status !== 'aguardando') throw erroConflito(`Chamado ja esta '${ch.status}'.`);
    const disponiveis = db.prepare("SELECT * FROM ambulancias WHERE status = 'disponivel'").all();
    if (!disponiveis.length) throw erroConflito('Nenhuma ambulancia disponivel no momento.');
    return escolherAmbulancia(disponiveis, ch);
  }

  function despachar(chamadoId, { ambulancia_id } = {}, ator, ip) {
    const ch = obterChamado(chamadoId);
    if (ch.status !== 'aguardando') throw erroConflito(`Chamado ja esta '${ch.status}'.`);

    let escolhida;
    if (ambulancia_id) {
      escolhida = db.prepare('SELECT * FROM ambulancias WHERE id = ?').get(Number(ambulancia_id));
      if (!escolhida) throw erroNaoEncontrado(`Ambulancia #${ambulancia_id} nao encontrada.`);
      if (escolhida.status !== 'disponivel') throw erroConflito(`Ambulancia ${escolhida.prefixo} esta '${escolhida.status}'.`);
    } else {
      escolhida = sugerirDespacho(chamadoId).escolhida;
      if (!escolhida) throw erroConflito('Nenhuma ambulancia disponivel no momento.');
    }

    const km = distanciaKm(escolhida.lat, escolhida.lng, ch.lat, ch.lng);
    const eta = etaMinutos(km);

    return emTransacao(db, () => {
      db.prepare(`UPDATE chamados SET ambulancia_id = ?, status = 'despachado',
                  despachado_em = datetime('now') WHERE id = ?`).run(escolhida.id, chamadoId);
      db.prepare(`UPDATE ambulancias SET status = 'a_caminho', atualizado_em = datetime('now')
                  WHERE id = ?`).run(escolhida.id);
      registrarEvento(chamadoId, 'despacho',
        `Ambulancia ${escolhida.prefixo} (${escolhida.tipo}) despachada. Distancia ${km.toFixed(2)} km, ETA ${eta} min.`,
        ator?.sub);
      auditoria.registrar({ ator, acao: 'DESPACHAR', entidade: 'chamado', entidadeId: chamadoId,
                            detalhes: { ambulancia: escolhida.prefixo, distancia_km: Number(km.toFixed(2)),
                                        eta_min: eta, manual: Boolean(ambulancia_id) }, ip });
      return { ...obterChamado(chamadoId), distancia_km: Number(km.toFixed(2)), eta_min: eta };
    });
  }

  // Transicoes validas do ciclo de vida do chamado.
  const TRANSICOES = {
    despachado: { proximo: 'no_local', carimbo: 'no_local_em', ambulancia: 'no_local', evento: 'Equipe no local da ocorrencia.' },
    no_local: { proximo: 'transportando', carimbo: null, ambulancia: 'transportando', evento: 'Paciente embarcado, em transporte ao hospital.' },
    transportando: { proximo: 'concluido', carimbo: 'hospital_em', ambulancia: 'no_hospital', evento: 'Chegada ao hospital.' },
  };

  function avancarChamado(chamadoId, ator, ip) {
    const ch = obterChamado(chamadoId);
    const t = TRANSICOES[ch.status];
    if (!t) throw erroConflito(`Chamado em '${ch.status}' nao possui proxima etapa automatica.`);

    return emTransacao(db, () => {
      const carimbo = t.carimbo ? `, ${t.carimbo} = datetime('now')` : '';
      const encerra = t.proximo === 'concluido' ? ", encerrado_em = datetime('now')" : '';
      db.prepare(`UPDATE chamados SET status = ?${carimbo}${encerra} WHERE id = ?`).run(t.proximo, chamadoId);
      if (ch.ambulancia_id) {
        db.prepare("UPDATE ambulancias SET status = ?, atualizado_em = datetime('now') WHERE id = ?")
          .run(t.ambulancia, ch.ambulancia_id);
        // A ambulancia acompanha o chamado ate o local da ocorrencia.
        if (t.proximo === 'no_local') {
          db.prepare('UPDATE ambulancias SET lat = ?, lng = ? WHERE id = ?').run(ch.lat, ch.lng, ch.ambulancia_id);
        }
      }
      registrarEvento(chamadoId, t.proximo, t.evento, ator?.sub);
      auditoria.registrar({ ator, acao: 'ATUALIZAR', entidade: 'chamado', entidadeId: chamadoId,
                            detalhes: { de: ch.status, para: t.proximo }, ip });
      return obterChamado(chamadoId);
    });
  }

  function cancelarChamado(chamadoId, motivo, ator, ip) {
    const ch = obterChamado(chamadoId);
    if (['concluido', 'cancelado'].includes(ch.status)) throw erroConflito(`Chamado ja esta '${ch.status}'.`);
    if (!motivo || String(motivo).trim().length < 5) throw erroRequisicao('Informe o motivo do cancelamento (min. 5 caracteres).');

    return emTransacao(db, () => {
      db.prepare(`UPDATE chamados SET status = 'cancelado', motivo_cancelamento = ?,
                  encerrado_em = datetime('now') WHERE id = ?`).run(String(motivo).trim(), chamadoId);
      if (ch.ambulancia_id) liberar(ch.ambulancia_id);
      registrarEvento(chamadoId, 'cancelamento', `Chamado cancelado: ${motivo}`, ator?.sub);
      auditoria.registrar({ ator, acao: 'CANCELAR', entidade: 'chamado', entidadeId: chamadoId,
                            detalhes: { motivo }, ip });
      return obterChamado(chamadoId);
    });
  }

  /**
   * INTEGRACAO NUCLEO <-> NUCLEO: ponto critico apontado no risco 3 do documento.
   * A chegada da ambulancia abre o atendimento no prontuario com a triagem de campo,
   * evitando redigitacao e perda do historico pre-hospitalar.
   */
  function admitirNoHospital(chamadoId, { queixa_principal, paciente_id }, servicoProntuario, ator, ip) {
    const ch = obterChamado(chamadoId);
    if (ch.atendimento_id) throw erroConflito(`Chamado ja gerou o atendimento #${ch.atendimento_id}.`);
    if (!['transportando', 'concluido'].includes(ch.status)) {
      throw erroConflito("Admissao so e possivel apos o status 'transportando'.");
    }

    const pacienteId = Number(paciente_id ?? ch.paciente_id);
    if (!pacienteId) throw erroRequisicao('Informe o paciente identificado durante o transporte.');

    return emTransacao(db, () => {
      const atendimento = servicoProntuario.abrirAtendimento({
        paciente_id: pacienteId,
        tipo: 'emergencia',
        origem: 'ambulancia',
        chamado_id: chamadoId,
        classificacao_risco: ch.cor_triagem,
        queixa_principal: queixa_principal ?? `${ch.natureza}: ${ch.descricao ?? 'atendimento pre-hospitalar'}`,
      }, ator, ip);

      db.prepare('UPDATE chamados SET atendimento_id = ?, paciente_id = ? WHERE id = ?')
        .run(atendimento.id, pacienteId, chamadoId);
      registrarEvento(chamadoId, 'admissao',
        `Paciente admitido no pronto-socorro. Atendimento #${atendimento.id} aberto com classificacao ${ch.cor_triagem}.`,
        ator?.sub);
      auditoria.registrar({ ator, acao: 'ADMITIR', entidade: 'chamado', entidadeId: chamadoId,
                            detalhes: { atendimento_id: atendimento.id, paciente_id: pacienteId }, ip });
      return { chamado: obterChamado(chamadoId), atendimento };
    });
  }

  // ----------------------------- ambulancias -------------------------
  const liberar = (id) =>
    db.prepare("UPDATE ambulancias SET status = 'disponivel', atualizado_em = datetime('now') WHERE id = ?").run(id);

  function listarAmbulancias() {
    return db.prepare(`
      SELECT a.*, c.id AS chamado_id, c.protocolo AS chamado_protocolo, c.cor_triagem
      FROM ambulancias a
      LEFT JOIN chamados c ON c.ambulancia_id = a.id AND c.status NOT IN ('concluido','cancelado')
      ORDER BY a.prefixo`).all();
  }

  function atualizarAmbulancia(id, dados, ator, ip) {
    const amb = db.prepare('SELECT * FROM ambulancias WHERE id = ?').get(id);
    if (!amb) throw erroNaoEncontrado(`Ambulancia #${id} nao encontrada.`);

    const d = validar(dados, {
      status: { opcoes: ['disponivel', 'a_caminho', 'no_local', 'transportando', 'no_hospital', 'indisponivel'] },
      lat: { tipo: 'numero', min: -90, max: 90 },
      lng: { tipo: 'numero', min: -180, max: 180 },
      equipe: { max: 200 },
    });
    const campos = Object.keys(d);
    if (!campos.length) throw erroRequisicao('Nenhum campo para atualizar.');

    if (d.status === 'indisponivel') {
      const ativo = db.prepare(`SELECT protocolo FROM chamados
        WHERE ambulancia_id = ? AND status NOT IN ('concluido','cancelado')`).get(id);
      if (ativo) throw erroConflito(`Ambulancia vinculada ao chamado ${ativo.protocolo}. Conclua ou cancele antes.`);
    }

    db.prepare(`UPDATE ambulancias SET ${campos.map((c) => `${c} = ?`).join(', ')},
                atualizado_em = datetime('now') WHERE id = ?`).run(...campos.map((c) => d[c]), id);
    auditoria.registrar({ ator, acao: 'ATUALIZAR', entidade: 'ambulancia', entidadeId: id,
                          detalhes: { prefixo: amb.prefixo, mudancas: d }, ip });
    return db.prepare('SELECT * FROM ambulancias WHERE id = ?').get(id);
  }

  /** Indicadores operacionais da central (painel do operador). */
  function indicadores() {
    const porStatus = db.prepare(`
      SELECT status, COUNT(*) AS total FROM chamados
      WHERE status NOT IN ('concluido','cancelado') GROUP BY status`).all();
    const frota = db.prepare('SELECT status, COUNT(*) AS total FROM ambulancias GROUP BY status').all();
    const tempos = db.prepare(`
      SELECT ROUND(AVG((julianday(despachado_em) - julianday(aberto_em)) * 1440), 1) AS tempo_medio_despacho_min,
             ROUND(AVG((julianday(no_local_em)   - julianday(despachado_em)) * 1440), 1) AS tempo_medio_resposta_min,
             COUNT(*) AS chamados_atendidos
      FROM chamados WHERE no_local_em IS NOT NULL`).get();
    const forasDoAlvo = db.prepare(`
      SELECT COUNT(*) AS n FROM chamados c
      WHERE c.no_local_em IS NOT NULL AND c.prioridade <= 2
        AND (julianday(c.no_local_em) - julianday(c.aberto_em)) * 1440 > 10`).get().n;

    return {
      chamados_ativos: porStatus.reduce((s, r) => s + r.total, 0),
      por_status: Object.fromEntries(porStatus.map((r) => [r.status, r.total])),
      frota: Object.fromEntries(frota.map((r) => [r.status, r.total])),
      ...tempos,
      prioridade_alta_fora_do_alvo: forasDoAlvo,
    };
  }

  return {
    abrirChamado, obterChamado, listarChamados, sugerirDespacho, despachar,
    avancarChamado, cancelarChamado, admitirNoHospital,
    listarAmbulancias, atualizarAmbulancia, indicadores,
  };
}
