import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { aplicacaoDeTeste, pacienteDeTeste, PONTO } from '../apoio.js';
import { mascararCpf } from '../../src/app-paciente/paciente.service.js';
import { FLAGS_PADRAO } from '../../src/app-paciente/flags.js';

let app, paciente, ator, outro, atorOutro;

beforeEach(() => {
  app = aplicacaoDeTeste();
  paciente = pacienteDeTeste(app);
  outro = pacienteDeTeste(app, { nome: 'Outro Paciente', cpf: '15350946056' });
  ator = { sub: 90, nome: paciente.nome, papel: 'paciente', paciente_id: paciente.id };
  atorOutro = { sub: 91, nome: outro.nome, papel: 'paciente', paciente_id: outro.id };
  app.db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash, papel, paciente_id) VALUES (?,?,?,?,?,?)')
    .run(90, paciente.nome, 'p1@app.local', 'x', 'paciente', paciente.id);
  app.db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash, papel, paciente_id) VALUES (?,?,?,?,?,?)')
    .run(91, outro.nome, 'p2@app.local', 'x', 'paciente', outro.id);
});

describe('Isolamento dos dados do paciente', () => {
  test('mostra o proprio perfil com o CPF mascarado', () => {
    const p = app.paciente.meuPerfil(ator, app.ip);
    assert.equal(p.id, paciente.id);
    assert.equal(p.cpf, '529.***.***-25');
    assert.ok(!('senha_hash' in p));
  });

  test('mascara CPF preservando apenas inicio e fim', () => {
    assert.equal(mascararCpf('52998224725'), '529.***.***-25');
    assert.equal(mascararCpf(null), '');
  });

  test('um paciente nunca ve o atendimento de outro', () => {
    const at = app.prontuario.abrirAtendimento({
      paciente_id: outro.id, tipo: 'emergencia', origem: 'balcao',
      queixa_principal: 'Queixa do outro paciente.',
    }, app.equipe.recepcao, app.ip);

    assert.throws(() => app.paciente.meuAtendimento(at.id, ator, app.ip), /nao encontrado/);
    assert.equal(app.paciente.meuAtendimento(at.id, atorOutro, app.ip).id, at.id);
  });

  test('profissional do nucleo nao usa as rotas do app', () => {
    assert.throws(() => app.paciente.meuPerfil(app.equipe.medico, app.ip), /exclusiva do app/);
    assert.throws(() => app.paciente.meusAtendimentos(app.equipe.admin, app.ip), /exclusiva do app/);
  });

  test('a visao do atendimento nunca traz o prontuario integral', () => {
    const at = app.prontuario.abrirAtendimento({
      paciente_id: paciente.id, tipo: 'emergencia', origem: 'balcao',
      queixa_principal: 'Queixa propria do paciente.',
    }, app.equipe.recepcao, app.ip);
    app.prontuario.registrarSinaisVitais(at.id, { fc: 80 }, app.equipe.enfermeiro, app.ip);

    const visao = app.paciente.meuAtendimento(at.id, ator, app.ip);
    assert.ok(!('sinais_vitais' in visao), 'sinais vitais nao vao para o app');
    assert.ok(!('responsavel_id' in visao));
    assert.ok(!('paciente_cpf' in visao));
  });

  test('o acesso pelo app tambem entra na trilha de auditoria', () => {
    app.paciente.meuPerfil(ator, app.ip);
    const r = app.db.prepare(
      "SELECT * FROM auditoria WHERE entidade = 'perfil_paciente'").all();
    assert.equal(r.length, 1);
    assert.equal(r[0].papel, 'paciente');
  });
});

describe('Feature flags (rollback sem deploy)', () => {
  test('todas as flags padrao sao criadas na inicializacao', () => {
    const chaves = app.flags.listar().map((f) => f.chave).sort();
    assert.deepEqual(chaves, FLAGS_PADRAO.map((f) => f.chave).sort());
  });

  test('desligar a flag remove a funcionalidade imediatamente', () => {
    assert.ok(app.flags.ativa('app.solicitar_ambulancia'));
    app.flags.definir('app.solicitar_ambulancia', false);

    assert.throws(() => app.paciente.solicitarAmbulancia({
      ...PONTO, natureza: 'clinico', descricao: 'Mal estar geral.', endereco: 'Rua do App, 10',
    }, ator, app.ip), /indisponivel/);

    app.flags.definir('app.solicitar_ambulancia', true);
    const c = app.paciente.solicitarAmbulancia({
      ...PONTO, natureza: 'clinico', descricao: 'Mal estar apos o religamento da flag.',
      endereco: 'Rua do App, 10',
    }, ator, app.ip);
    assert.equal(c.canal, 'app_paciente');
  });

  test('a flag de prescricoes controla o que o app expoe', () => {
    const at = app.prontuario.abrirAtendimento({
      paciente_id: paciente.id, tipo: 'ambulatorial', origem: 'balcao',
      queixa_principal: 'Consulta de rotina.',
    }, app.equipe.recepcao, app.ip);
    app.prontuario.prescrever(at.id, {
      medicamento: 'Paracetamol 750mg', dose: '1 comp', via: 'oral', frequencia: '6/6h',
    }, app.equipe.medico, app.ip);

    assert.equal(app.paciente.meuAtendimento(at.id, ator, app.ip).prescricoes.length, 1);
    app.flags.definir('app.ver_prescricoes', false);
    assert.equal(app.paciente.meuAtendimento(at.id, ator, app.ip).prescricoes, undefined);
  });

  test('o historico reduzido limita a lista a 5 atendimentos', () => {
    for (let i = 0; i < 7; i++) {
      const at = app.prontuario.abrirAtendimento({
        paciente_id: paciente.id, tipo: 'ambulatorial', origem: 'balcao',
        queixa_principal: `Atendimento numero ${i + 1} do historico.`,
      }, app.equipe.recepcao, app.ip);
      app.prontuario.encerrarAtendimento(at.id,
        { status: 'alta', desfecho: 'Alta administrativa de teste.' }, app.equipe.medico, app.ip);
    }
    assert.equal(app.paciente.meusAtendimentos(ator, app.ip).length, 7);
    app.flags.definir('app.historico_completo', false);
    assert.equal(app.paciente.meusAtendimentos(ator, app.ip).length, 5);
  });

  test('definir uma flag inexistente nao altera nada', () => {
    assert.equal(app.flags.definir('app.flag.que.nao.existe', true), false);
  });
});

describe('Solicitacao de ambulancia pelo app', () => {
  test('o chamado do app entra na mesma fila da central, ja triado', () => {
    const c = app.paciente.solicitarAmbulancia({
      ...PONTO, natureza: 'cardiaco', descricao: 'Dor no peito forte.',
      endereco: 'Rua do App, 10', prioridade: 5,
    }, ator, app.ip);

    assert.equal(c.canal, 'app_paciente');
    assert.equal(c.paciente_id, paciente.id);
    assert.equal(c.prioridade, 2, 'natureza cardiaca eleva a prioridade mesmo vindo do app');

    const fila = app.despacho.listarChamados({ status: 'ativos' });
    assert.ok(fila.some((x) => x.id === c.id), 'o operador ve o chamado do app no mesmo painel');
  });

  test('impede o mesmo paciente de abrir dois chamados', () => {
    const dados = { ...PONTO, natureza: 'clinico', descricao: 'Primeiro pedido do paciente.',
                    endereco: 'Rua do App, 10' };
    app.paciente.solicitarAmbulancia(dados, ator, app.ip);
    assert.throws(() => app.paciente.solicitarAmbulancia(dados, ator, app.ip), /ja possui o chamado/);
  });

  test('o acompanhamento mostra o ETA sem expor dados da central', () => {
    const c = app.paciente.solicitarAmbulancia({
      ...PONTO, natureza: 'clinico', descricao: 'Mal estar geral com tontura.',
      endereco: 'Rua do App, 10',
    }, ator, app.ip);
    app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);

    const visao = app.paciente.meuChamadoAtivo(ator, app.ip);
    assert.equal(visao.protocolo, c.protocolo);
    assert.ok(visao.ambulancia.prefixo);
    assert.equal(typeof visao.eta_min, 'number');
    assert.ok(visao.linha_do_tempo.length >= 2);
    assert.ok(!('aberto_por' in visao), 'o app nao expoe o operador da central');
    assert.ok(!('solicitante_telefone' in visao));
  });

  test('sem chamado ativo o acompanhamento devolve vazio', () => {
    assert.equal(app.paciente.meuChamadoAtivo(ator, app.ip), null);
  });
});
