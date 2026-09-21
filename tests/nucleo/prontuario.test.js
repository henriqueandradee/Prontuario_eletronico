import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { aplicacaoDeTeste, pacienteDeTeste } from '../apoio.js';
import { calcularIdade, avaliarSinais } from '../../src/nucleo/prontuario.service.js';
import { cpfValido } from '../../src/lib/validate.js';

let app;
beforeEach(() => { app = aplicacaoDeTeste(); });

describe('Cadastro de paciente', () => {
  test('cadastra paciente valido e calcula a idade', () => {
    const p = pacienteDeTeste(app);
    assert.equal(p.nome, 'Paciente de Teste');
    assert.equal(p.cpf, '52998224725');
    assert.equal(p.idade, calcularIdade('1980-05-10'));
  });

  test('rejeita CPF com digitos verificadores invalidos', () => {
    assert.throws(() => pacienteDeTeste(app, { cpf: '11111111111' }), /CPF invalido/);
    assert.throws(() => pacienteDeTeste(app, { cpf: '12345678900' }), /CPF invalido/);
  });

  test('valida os digitos verificadores corretamente', () => {
    assert.equal(cpfValido('529.982.247-25'), true);
    assert.equal(cpfValido('00000000000'), false);
    assert.equal(cpfValido('123'), false);
  });

  test('rejeita CPF duplicado', () => {
    pacienteDeTeste(app);
    assert.throws(() => pacienteDeTeste(app), /ja cadastrado/);
  });

  test('rejeita data de nascimento no futuro', () => {
    assert.throws(() => pacienteDeTeste(app, { data_nascimento: '2099-01-01' }), /futuro/);
  });

  test('exige os campos obrigatorios', () => {
    assert.throws(() => app.prontuario.cadastrarPaciente({ nome: 'X' }, app.equipe.recepcao),
      /Dados invalidos/);
  });
});

describe('Atendimento', () => {
  test('abre atendimento e impede duplicidade para o mesmo paciente', () => {
    const p = pacienteDeTeste(app);
    const at = app.prontuario.abrirAtendimento({
      paciente_id: p.id, tipo: 'emergencia', origem: 'balcao',
      queixa_principal: 'Dor abdominal intensa ha 6 horas.',
    }, app.equipe.recepcao, app.ip);

    assert.equal(at.status, 'aberto');
    assert.throws(() => app.prontuario.abrirAtendimento({
      paciente_id: p.id, tipo: 'ambulatorial', origem: 'balcao',
      queixa_principal: 'Outra queixa qualquer.',
    }, app.equipe.recepcao, app.ip), /ja possui o atendimento/);
  });

  test('encerrar conclui as prescricoes ativas e bloqueia novas alteracoes', () => {
    const p = pacienteDeTeste(app);
    const at = app.prontuario.abrirAtendimento({
      paciente_id: p.id, tipo: 'ambulatorial', origem: 'balcao',
      queixa_principal: 'Cefaleia ha dois dias.',
    }, app.equipe.recepcao, app.ip);

    app.prontuario.prescrever(at.id, {
      medicamento: 'Paracetamol 750mg', dose: '1 comprimido', via: 'oral', frequencia: '6/6h',
    }, app.equipe.medico, app.ip);

    const encerrado = app.prontuario.encerrarAtendimento(at.id,
      { status: 'alta', desfecho: 'Alta com analgesia e orientacoes.' }, app.equipe.medico, app.ip);

    assert.equal(encerrado.status, 'alta');
    assert.equal(encerrado.prescricoes[0].status, 'concluida');
    assert.throws(() => app.prontuario.encerrarAtendimento(at.id,
      { status: 'alta', desfecho: 'Tentativa de reencerrar.' }, app.equipe.medico, app.ip), /ja encerrado/);
    assert.throws(() => app.prontuario.prescrever(at.id, {
      medicamento: 'Dipirona', dose: '1', via: 'oral', frequencia: '6/6h',
    }, app.equipe.medico, app.ip), /encerrado/);
  });
});

describe('Registro clinico (append-only)', () => {
  const abrir = () => {
    const p = pacienteDeTeste(app);
    return app.prontuario.abrirAtendimento({
      paciente_id: p.id, tipo: 'emergencia', origem: 'balcao',
      queixa_principal: 'Queixa clinica para registro.',
    }, app.equipe.recepcao, app.ip);
  };

  test('assina eletronicamente cada registro', () => {
    const at = abrir();
    const e = app.prontuario.registrarEvolucao(at.id, {
      tipo: 'evolucao', texto: 'Paciente em bom estado geral, mantida conduta expectante.',
    }, app.equipe.medico, app.ip);
    assert.match(e.assinatura, /^[a-f0-9]{64}$/);
  });

  test('enfermeiro nao assina evolucao medica', () => {
    const at = abrir();
    assert.throws(() => app.prontuario.registrarEvolucao(at.id, {
      tipo: 'evolucao', texto: 'Tentativa de registro medico por enfermagem.',
    }, app.equipe.enfermeiro, app.ip), /papel 'medico'/);

    // ... mas registra a evolucao de enfermagem normalmente.
    const ok = app.prontuario.registrarEvolucao(at.id, {
      tipo: 'enfermagem', texto: 'Acesso venoso puncionado em MSD, paciente sem queixas.',
    }, app.equipe.enfermeiro, app.ip);
    assert.equal(ok.tipo, 'enfermagem');
  });

  test('retificacao exige apontar o registro corrigido e nao apaga o original', () => {
    const at = abrir();
    const original = app.prontuario.registrarEvolucao(at.id, {
      tipo: 'evolucao', texto: 'Registro original com informacao equivocada sobre a dose.',
    }, app.equipe.medico, app.ip);

    assert.throws(() => app.prontuario.registrarEvolucao(at.id, {
      tipo: 'retificacao', texto: 'Retificacao sem apontar o registro alvo.',
    }, app.equipe.medico, app.ip), /retifica_id/);

    app.prontuario.registrarEvolucao(at.id, {
      tipo: 'retificacao', retifica_id: original.id,
      texto: 'Retificacao: a dose correta administrada foi de 500mg e nao 1000mg.',
    }, app.equipe.medico, app.ip);

    const completo = app.prontuario.obterAtendimento(at.id, app.equipe.medico, app.ip);
    assert.equal(completo.evolucoes.length, 2, 'o registro original permanece no prontuario');
    assert.ok(completo.evolucoes.some((e) => e.id === original.id));
  });

  test('atendimento encerrado aceita somente retificacao', () => {
    const at = abrir();
    const original = app.prontuario.registrarEvolucao(at.id, {
      tipo: 'evolucao', texto: 'Evolucao registrada antes da alta do paciente.',
    }, app.equipe.medico, app.ip);
    app.prontuario.encerrarAtendimento(at.id,
      { status: 'alta', desfecho: 'Alta hospitalar.' }, app.equipe.medico, app.ip);

    assert.throws(() => app.prontuario.registrarEvolucao(at.id, {
      tipo: 'evolucao', texto: 'Tentativa de nova evolucao apos o encerramento.',
    }, app.equipe.medico, app.ip), /retificacao/);

    const r = app.prontuario.registrarEvolucao(at.id, {
      tipo: 'retificacao', retifica_id: original.id,
      texto: 'Retificacao pos-alta corrigindo o horario da ultima medicacao.',
    }, app.equipe.medico, app.ip);
    assert.equal(r.tipo, 'retificacao');
  });
});

describe('Seguranca do paciente', () => {
  test('bloqueia prescricao de medicamento com alergia registrada', () => {
    const p = pacienteDeTeste(app);
    app.prontuario.registrarAlergia(p.id,
      { substancia: 'Dipirona', gravidade: 'grave' }, app.equipe.medico, app.ip);
    const at = app.prontuario.abrirAtendimento({
      paciente_id: p.id, tipo: 'emergencia', origem: 'balcao',
      queixa_principal: 'Febre e dor de cabeca.',
    }, app.equipe.recepcao, app.ip);

    assert.throws(() => app.prontuario.prescrever(at.id, {
      medicamento: 'Dipirona Sodica 500mg', dose: '1 comprimido', via: 'oral', frequencia: '6/6h',
    }, app.equipe.medico, app.ip), /alergia grave a 'Dipirona'/);

    // O bloqueio fica registrado na auditoria.
    const bloqueios = app.db.prepare("SELECT * FROM auditoria WHERE acao = 'BLOQUEAR'").all();
    assert.equal(bloqueios.length, 1);

    // Medicamento sem conflito passa normalmente.
    const ok = app.prontuario.prescrever(at.id, {
      medicamento: 'Paracetamol 750mg', dose: '1 comprimido', via: 'oral', frequencia: '6/6h',
    }, app.equipe.medico, app.ip);
    assert.equal(ok.status, 'ativa');
  });

  test('sinais vitais fora da faixa geram alertas', () => {
    assert.deepEqual(avaliarSinais({ fc: 80, saturacao: 98, temperatura: 36.5 }), []);
    const criticos = avaliarSinais({ saturacao: 85, pa_sistolica: 70, fc: 140 });
    assert.equal(criticos.filter((a) => a.nivel === 'critico').length, 2);
    assert.ok(criticos.some((a) => a.texto.includes('Saturacao baixa')));
  });

  test('recusa sinais vitais fisiologicamente impossiveis', () => {
    const p = pacienteDeTeste(app);
    const at = app.prontuario.abrirAtendimento({
      paciente_id: p.id, tipo: 'emergencia', origem: 'balcao', queixa_principal: 'Avaliacao clinica.',
    }, app.equipe.recepcao, app.ip);
    assert.throws(() => app.prontuario.registrarSinaisVitais(at.id,
      { temperatura: 60 }, app.equipe.enfermeiro, app.ip), /Dados invalidos/);
    assert.throws(() => app.prontuario.registrarSinaisVitais(at.id,
      {}, app.equipe.enfermeiro, app.ip), /ao menos um sinal vital/);
  });
});
