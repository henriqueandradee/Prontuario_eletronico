import { validar, cpfValido, soDigitos } from '../lib/validate.js';
import { assinarRegistro } from '../lib/auth.js';
import { erroRequisicao, erroConflito, erroNaoEncontrado } from '../lib/errors.js';
import { emTransacao } from '../db/index.js';

const STATUS_FINAIS = ['alta', 'obito', 'transferido'];

export function criarServicoProntuario(db, auditoria) {
  // ----------------------------- pacientes ---------------------------
  function cadastrarPaciente(dados, ator, ip) {
    const p = validar(dados, {
      nome: { obrigatorio: true, min: 3, max: 120 },
      cpf: { obrigatorio: true },
      data_nascimento: { obrigatorio: true, tipo: 'data' },
      sexo: { obrigatorio: true, opcoes: ['M', 'F', 'O'] },
      cartao_sus: {}, telefone: {}, endereco: {},
      tipo_sanguineo: { opcoes: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    });

    p.cpf = soDigitos(p.cpf);
    if (!cpfValido(p.cpf)) throw erroRequisicao('CPF invalido.', ['digitos verificadores nao conferem']);
    if (new Date(p.data_nascimento) > new Date()) throw erroRequisicao('Data de nascimento no futuro.');

    const existente = db.prepare('SELECT id, nome FROM pacientes WHERE cpf = ?').get(p.cpf);
    if (existente) throw erroConflito(`CPF ja cadastrado para o paciente #${existente.id}.`, existente);

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO pacientes (nome, cpf, data_nascimento, sexo, cartao_sus, telefone,
                             endereco, tipo_sanguineo, criado_por)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      p.nome, p.cpf, p.data_nascimento, p.sexo, p.cartao_sus ?? null,
      p.telefone ?? null, p.endereco ?? null, p.tipo_sanguineo ?? null, ator.sub);

    const id = Number(lastInsertRowid);
    auditoria.registrar({ ator, acao: 'CRIAR', entidade: 'paciente', entidadeId: id,
                          detalhes: { nome: p.nome }, ip });
    return obterPaciente(id);
  }

  function obterPaciente(id) {
    const paciente = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id);
    if (!paciente) throw erroNaoEncontrado(`Paciente #${id} nao encontrado.`);
    paciente.alergias = db.prepare(
      'SELECT * FROM alergias WHERE paciente_id = ? ORDER BY gravidade DESC, id').all(id);
    paciente.idade = calcularIdade(paciente.data_nascimento);
    return paciente;
  }

  function listarPacientes({ busca = '', limite = 50 } = {}) {
    const termo = `%${String(busca).trim()}%`;
    return db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM atendimentos a
                   WHERE a.paciente_id = p.id AND a.status NOT IN ('alta','obito','transferido')
                  ) AS atendimentos_abertos
      FROM pacientes p
      WHERE p.nome LIKE ? OR p.cpf LIKE ?
      ORDER BY p.nome LIMIT ?`).all(termo, termo, Math.min(Number(limite) || 50, 200));
  }

  function registrarAlergia(pacienteId, dados, ator, ip) {
    obterPaciente(pacienteId);
    const a = validar(dados, {
      substancia: { obrigatorio: true, min: 2, max: 120 },
      gravidade: { obrigatorio: true, opcoes: ['leve', 'moderada', 'grave'] },
      observacao: { max: 500 },
    });
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO alergias (paciente_id, substancia, gravidade, observacao, registrado_por)
      VALUES (?,?,?,?,?)`).run(pacienteId, a.substancia, a.gravidade, a.observacao ?? null, ator.sub);

    auditoria.registrar({ ator, acao: 'CRIAR', entidade: 'alergia',
                          entidadeId: Number(lastInsertRowid),
                          detalhes: { paciente_id: pacienteId, substancia: a.substancia }, ip });
    return db.prepare('SELECT * FROM alergias WHERE id = ?').get(Number(lastInsertRowid));
  }

  // --------------------------- atendimentos --------------------------
  function abrirAtendimento(dados, ator, ip) {
    const a = validar(dados, {
      paciente_id: { obrigatorio: true, tipo: 'numero' },
      tipo: { obrigatorio: true, opcoes: ['emergencia', 'ambulatorial', 'internacao'] },
      origem: { obrigatorio: true, opcoes: ['balcao', 'ambulancia', 'transferencia'] },
      queixa_principal: { obrigatorio: true, min: 3, max: 500 },
      classificacao_risco: { opcoes: ['vermelho', 'laranja', 'amarelo', 'verde', 'azul'] },
      leito: { max: 20 },
      chamado_id: { tipo: 'numero' },
    });
    obterPaciente(a.paciente_id);

    const aberto = db.prepare(`
      SELECT id FROM atendimentos
      WHERE paciente_id = ? AND status NOT IN ('alta','obito','transferido')`).get(a.paciente_id);
    if (aberto) throw erroConflito(`Paciente ja possui o atendimento #${aberto.id} em aberto.`, aberto);

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO atendimentos (paciente_id, tipo, origem, chamado_id, classificacao_risco,
                                queixa_principal, leito, responsavel_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      a.paciente_id, a.tipo, a.origem, a.chamado_id ?? null, a.classificacao_risco ?? null,
      a.queixa_principal, a.leito ?? null, ator.sub);

    const id = Number(lastInsertRowid);
    auditoria.registrar({ ator, acao: 'ABRIR', entidade: 'atendimento', entidadeId: id,
                          detalhes: { paciente_id: a.paciente_id, tipo: a.tipo, origem: a.origem }, ip });
    return obterAtendimento(id, ator, ip, { auditarLeitura: false });
  }

  function obterAtendimento(id, ator, ip, { auditarLeitura = true } = {}) {
    const at = db.prepare(`
      SELECT a.*, p.nome AS paciente_nome, p.cpf AS paciente_cpf,
             p.data_nascimento, p.tipo_sanguineo, u.nome AS responsavel_nome
      FROM atendimentos a
      JOIN pacientes p ON p.id = a.paciente_id
      LEFT JOIN usuarios u ON u.id = a.responsavel_id
      WHERE a.id = ?`).get(id);
    if (!at) throw erroNaoEncontrado(`Atendimento #${id} nao encontrado.`);

    at.idade = calcularIdade(at.data_nascimento);
    at.alergias = db.prepare('SELECT * FROM alergias WHERE paciente_id = ?').all(at.paciente_id);
    at.evolucoes = db.prepare(`
      SELECT e.*, u.nome AS autor_nome, u.papel AS autor_papel, u.registro_prof
      FROM evolucoes e JOIN usuarios u ON u.id = e.autor_id
      WHERE e.atendimento_id = ? ORDER BY e.id DESC`).all(id);
    at.sinais_vitais = db.prepare(`
      SELECT s.*, u.nome AS registrado_por_nome FROM sinais_vitais s
      JOIN usuarios u ON u.id = s.registrado_por
      WHERE s.atendimento_id = ? ORDER BY s.id DESC`).all(id);
    at.prescricoes = db.prepare(`
      SELECT pr.*, u.nome AS prescritor_nome, u.registro_prof FROM prescricoes pr
      JOIN usuarios u ON u.id = pr.prescritor_id
      WHERE pr.atendimento_id = ? ORDER BY pr.id DESC`).all(id);

    // LGPD: o acesso ao registro clinico tambem e uma operacao auditavel.
    if (auditarLeitura) {
      auditoria.registrar({ ator, acao: 'LER', entidade: 'atendimento', entidadeId: id,
                            detalhes: { paciente_id: at.paciente_id }, ip });
    }
    return at;
  }

  function listarAtendimentos({ status, paciente_id } = {}) {
    const condicoes = [];
    const args = [];
    if (status === 'abertos') condicoes.push("a.status NOT IN ('alta','obito','transferido')");
    else if (status) { condicoes.push('a.status = ?'); args.push(status); }
    if (paciente_id) { condicoes.push('a.paciente_id = ?'); args.push(Number(paciente_id)); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    return db.prepare(`
      SELECT a.id, a.tipo, a.origem, a.status, a.classificacao_risco, a.queixa_principal,
             a.leito, a.aberto_em, a.fechado_em, a.chamado_id,
             p.id AS paciente_id, p.nome AS paciente_nome, p.cpf AS paciente_cpf
      FROM atendimentos a JOIN pacientes p ON p.id = a.paciente_id
      ${where}
      ORDER BY CASE a.classificacao_risco
                 WHEN 'vermelho' THEN 1 WHEN 'laranja' THEN 2 WHEN 'amarelo' THEN 3
                 WHEN 'verde' THEN 4 WHEN 'azul' THEN 5 ELSE 6 END,
               a.aberto_em DESC`).all(...args);
  }

  function encerrarAtendimento(id, dados, ator, ip) {
    const at = db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(id);
    if (!at) throw erroNaoEncontrado(`Atendimento #${id} nao encontrado.`);
    if (STATUS_FINAIS.includes(at.status)) throw erroConflito(`Atendimento ja encerrado como '${at.status}'.`);

    const d = validar(dados, {
      status: { obrigatorio: true, opcoes: STATUS_FINAIS },
      desfecho: { obrigatorio: true, min: 5, max: 1000 },
    });

    return emTransacao(db, () => {
      db.prepare(`UPDATE atendimentos SET status = ?, desfecho = ?, fechado_em = datetime('now')
                  WHERE id = ?`).run(d.status, d.desfecho, id);
      db.prepare(`UPDATE prescricoes SET status = 'concluida'
                  WHERE atendimento_id = ? AND status = 'ativa'`).run(id);
      auditoria.registrar({ ator, acao: 'ENCERRAR', entidade: 'atendimento', entidadeId: id,
                            detalhes: { status: d.status }, ip });
      return obterAtendimento(id, ator, ip, { auditarLeitura: false });
    });
  }

  function atualizarAtendimento(id, dados, ator, ip) {
    const at = db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(id);
    if (!at) throw erroNaoEncontrado(`Atendimento #${id} nao encontrado.`);
    if (STATUS_FINAIS.includes(at.status)) throw erroConflito('Atendimento encerrado nao pode ser alterado.');

    const d = validar(dados, {
      status: { opcoes: ['aberto', 'em_atendimento', 'observacao'] },
      classificacao_risco: { opcoes: ['vermelho', 'laranja', 'amarelo', 'verde', 'azul'] },
      leito: { max: 20 },
    });
    const campos = Object.keys(d).filter((k) => d[k] !== undefined);
    if (!campos.length) throw erroRequisicao('Nenhum campo para atualizar.');

    db.prepare(`UPDATE atendimentos SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...campos.map((c) => d[c]), id);
    auditoria.registrar({ ator, acao: 'ATUALIZAR', entidade: 'atendimento', entidadeId: id,
                          detalhes: { antes: campos.reduce((o, c) => ({ ...o, [c]: at[c] }), {}), depois: d }, ip });
    return obterAtendimento(id, ator, ip, { auditarLeitura: false });
  }

  // ---------------------- registro clinico (append-only) --------------
  function registrarEvolucao(atendimentoId, dados, ator, ip) {
    const at = db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(atendimentoId);
    if (!at) throw erroNaoEncontrado(`Atendimento #${atendimentoId} nao encontrado.`);
    if (STATUS_FINAIS.includes(at.status) && dados?.tipo !== 'retificacao') {
      throw erroConflito('Atendimento encerrado aceita apenas registros do tipo retificacao.');
    }

    const e = validar(dados, {
      tipo: { obrigatorio: true, opcoes: ['anamnese', 'evolucao', 'enfermagem', 'exame', 'retificacao'] },
      texto: { obrigatorio: true, min: 10, max: 10000 },
      retifica_id: { tipo: 'numero' },
    });

    // Enfermagem nao assina evolucao medica, e vice-versa: segregacao de funcoes.
    if (e.tipo === 'evolucao' && !['medico', 'admin'].includes(ator.papel)) {
      throw erroConflito("Evolucao medica so pode ser assinada por profissional com papel 'medico'.");
    }
    if (e.tipo === 'retificacao') {
      if (!e.retifica_id) throw erroRequisicao("Retificacao exige 'retifica_id' do registro corrigido.");
      const alvo = db.prepare('SELECT * FROM evolucoes WHERE id = ? AND atendimento_id = ?')
                     .get(e.retifica_id, atendimentoId);
      if (!alvo) throw erroNaoEncontrado('Registro a retificar nao pertence a este atendimento.');
    }

    const criadoEm = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const assinatura = assinarRegistro({ autorId: ator.sub, texto: e.texto, criadoEm });

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO evolucoes (atendimento_id, autor_id, tipo, texto, retifica_id, assinatura, criado_em)
      VALUES (?,?,?,?,?,?,?)`).run(
      atendimentoId, ator.sub, e.tipo, e.texto, e.retifica_id ?? null, assinatura, criadoEm);

    auditoria.registrar({ ator, acao: 'REGISTRAR', entidade: 'evolucao',
                          entidadeId: Number(lastInsertRowid),
                          detalhes: { atendimento_id: atendimentoId, tipo: e.tipo, assinatura }, ip });
    return db.prepare('SELECT * FROM evolucoes WHERE id = ?').get(Number(lastInsertRowid));
  }

  function registrarSinaisVitais(atendimentoId, dados, ator, ip) {
    const at = db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(atendimentoId);
    if (!at) throw erroNaoEncontrado(`Atendimento #${atendimentoId} nao encontrado.`);

    const s = validar(dados, {
      pa_sistolica: { tipo: 'numero', min: 40, max: 300 },
      pa_diastolica: { tipo: 'numero', min: 20, max: 200 },
      fc: { tipo: 'numero', min: 20, max: 250 },
      fr: { tipo: 'numero', min: 4, max: 80 },
      temperatura: { tipo: 'numero', min: 30, max: 45 },
      saturacao: { tipo: 'numero', min: 40, max: 100 },
      glicemia: { tipo: 'numero', min: 10, max: 900 },
      dor: { tipo: 'numero', min: 0, max: 10 },
    });
    if (!Object.keys(s).length) throw erroRequisicao('Informe ao menos um sinal vital.');

    const colunas = Object.keys(s);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO sinais_vitais (${colunas.join(',')}, atendimento_id, registrado_por)
      VALUES (${colunas.map(() => '?').join(',')},?,?)`)
      .run(...colunas.map((c) => s[c]), atendimentoId, ator.sub);

    const registro = db.prepare('SELECT * FROM sinais_vitais WHERE id = ?').get(Number(lastInsertRowid));
    registro.alertas = avaliarSinais(s);

    auditoria.registrar({ ator, acao: 'REGISTRAR', entidade: 'sinais_vitais',
                          entidadeId: Number(lastInsertRowid),
                          detalhes: { atendimento_id: atendimentoId, alertas: registro.alertas }, ip });
    return registro;
  }

  function prescrever(atendimentoId, dados, ator, ip) {
    const at = db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(atendimentoId);
    if (!at) throw erroNaoEncontrado(`Atendimento #${atendimentoId} nao encontrado.`);
    if (STATUS_FINAIS.includes(at.status)) throw erroConflito('Nao e possivel prescrever em atendimento encerrado.');

    const p = validar(dados, {
      medicamento: { obrigatorio: true, min: 2, max: 200 },
      dose: { obrigatorio: true, max: 100 },
      via: { obrigatorio: true, opcoes: ['oral', 'ev', 'im', 'sc', 'inalatoria', 'topica', 'retal'] },
      frequencia: { obrigatorio: true, max: 100 },
      duracao: { max: 100 },
      observacao: { max: 500 },
    });

    // Barreira de seguranca do paciente: bloqueia prescricao com alergia registrada.
    const alergias = db.prepare('SELECT * FROM alergias WHERE paciente_id = ?').all(at.paciente_id);
    const conflito = alergias.find((a) =>
      p.medicamento.toLowerCase().includes(a.substancia.toLowerCase()) ||
      a.substancia.toLowerCase().includes(p.medicamento.toLowerCase()));
    if (conflito) {
      auditoria.registrar({ ator, acao: 'BLOQUEAR', entidade: 'prescricao', entidadeId: null,
                            detalhes: { atendimento_id: atendimentoId, medicamento: p.medicamento,
                                        alergia: conflito.substancia }, ip });
      throw erroConflito(
        `Paciente possui alergia ${conflito.gravidade} a '${conflito.substancia}'. Prescricao bloqueada.`,
        conflito);
    }

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO prescricoes (atendimento_id, medicamento, dose, via, frequencia,
                               duracao, observacao, prescritor_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      atendimentoId, p.medicamento, p.dose, p.via, p.frequencia,
      p.duracao ?? null, p.observacao ?? null, ator.sub);

    auditoria.registrar({ ator, acao: 'PRESCREVER', entidade: 'prescricao',
                          entidadeId: Number(lastInsertRowid),
                          detalhes: { atendimento_id: atendimentoId, medicamento: p.medicamento, dose: p.dose }, ip });
    return db.prepare('SELECT * FROM prescricoes WHERE id = ?').get(Number(lastInsertRowid));
  }

  function alterarStatusPrescricao(id, status, ator, ip) {
    const pr = db.prepare('SELECT * FROM prescricoes WHERE id = ?').get(id);
    if (!pr) throw erroNaoEncontrado(`Prescricao #${id} nao encontrada.`);
    if (!['ativa', 'suspensa', 'concluida'].includes(status)) throw erroRequisicao('Status invalido.');

    db.prepare('UPDATE prescricoes SET status = ? WHERE id = ?').run(status, id);
    auditoria.registrar({ ator, acao: 'ATUALIZAR', entidade: 'prescricao', entidadeId: id,
                          detalhes: { de: pr.status, para: status }, ip });
    return db.prepare('SELECT * FROM prescricoes WHERE id = ?').get(id);
  }

  return {
    cadastrarPaciente, obterPaciente, listarPacientes, registrarAlergia,
    abrirAtendimento, obterAtendimento, listarAtendimentos, atualizarAtendimento, encerrarAtendimento,
    registrarEvolucao, registrarSinaisVitais, prescrever, alterarStatusPrescricao,
  };
}

// ------------------------------ apoio --------------------------------
export function calcularIdade(dataNascimento) {
  const nasc = new Date(dataNascimento);
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

/** Alertas de sinais vitais fora da faixa de referencia adulta. */
export function avaliarSinais(s) {
  const alertas = [];
  if (s.saturacao !== undefined && s.saturacao < 92) alertas.push({ nivel: 'critico', texto: `Saturacao baixa (${s.saturacao}%)` });
  if (s.fc !== undefined && (s.fc < 50 || s.fc > 120)) alertas.push({ nivel: 'atencao', texto: `Frequencia cardiaca alterada (${s.fc} bpm)` });
  if (s.fr !== undefined && (s.fr < 10 || s.fr > 24)) alertas.push({ nivel: 'atencao', texto: `Frequencia respiratoria alterada (${s.fr} irpm)` });
  if (s.pa_sistolica !== undefined && (s.pa_sistolica < 90 || s.pa_sistolica > 180)) alertas.push({ nivel: 'critico', texto: `Pressao sistolica alterada (${s.pa_sistolica} mmHg)` });
  if (s.temperatura !== undefined && (s.temperatura < 35 || s.temperatura >= 38)) alertas.push({ nivel: 'atencao', texto: `Temperatura alterada (${s.temperatura} C)` });
  if (s.glicemia !== undefined && (s.glicemia < 70 || s.glicemia > 250)) alertas.push({ nivel: 'atencao', texto: `Glicemia alterada (${s.glicemia} mg/dL)` });
  return alertas;
}
