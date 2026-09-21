import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { aplicacaoDeTeste, pacienteDeTeste, chamadoBase } from '../apoio.js';

let app;
beforeEach(() => { app = aplicacaoDeTeste(); });

describe('Trilha de auditoria', () => {
  test('cadeia vazia e considerada integra', () => {
    const r = app.auditoria.verificarCadeia();
    assert.equal(r.integra, true);
    assert.equal(r.registros, 0);
  });

  test('registra automaticamente toda operacao do nucleo', () => {
    const p = pacienteDeTeste(app);
    const at = app.prontuario.abrirAtendimento({
      paciente_id: p.id, tipo: 'emergencia', origem: 'balcao', queixa_principal: 'Queixa de teste.',
    }, app.equipe.recepcao, app.ip);
    app.prontuario.registrarEvolucao(at.id, {
      tipo: 'evolucao', texto: 'Evolucao clinica registrada para fins de auditoria.',
    }, app.equipe.medico, app.ip);

    // node:sqlite devolve objetos sem prototipo, por isso a comparacao e feita por string.
    const acoes = app.db.prepare('SELECT acao, entidade FROM auditoria ORDER BY id').all()
      .map((r) => `${r.acao} ${r.entidade}`);
    assert.deepEqual(acoes, ['CRIAR paciente', 'ABRIR atendimento', 'REGISTRAR evolucao']);
    assert.equal(app.auditoria.verificarCadeia().integra, true);
  });

  test('a leitura do prontuario tambem e auditada (LGPD)', () => {
    const p = pacienteDeTeste(app);
    const at = app.prontuario.abrirAtendimento({
      paciente_id: p.id, tipo: 'ambulatorial', origem: 'balcao', queixa_principal: 'Consulta de rotina.',
    }, app.equipe.recepcao, app.ip);

    app.prontuario.obterAtendimento(at.id, app.equipe.medico, app.ip);
    const leituras = app.db.prepare(
      "SELECT * FROM auditoria WHERE acao = 'LER' AND entidade = 'atendimento'").all();
    assert.equal(leituras.length, 1);
    assert.equal(leituras[0].ator_nome, app.equipe.medico.nome);
  });

  test('cada registro guarda quem fez, o que fez e quando', () => {
    pacienteDeTeste(app);
    const r = app.db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 1').get();
    assert.equal(r.ator_id, app.equipe.recepcao.sub);
    assert.equal(r.papel, 'recepcao');
    assert.equal(r.ip, app.ip);
    assert.match(r.criado_em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.match(r.hash, /^[a-f0-9]{64}$/);
  });

  test('detecta adulteracao do conteudo de um registro', () => {
    pacienteDeTeste(app);
    app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    assert.equal(app.auditoria.verificarCadeia().integra, true);

    const alvo = app.db.prepare('SELECT id FROM auditoria ORDER BY id LIMIT 1').get();
    app.db.prepare("UPDATE auditoria SET acao = 'ACAO_FALSIFICADA' WHERE id = ?").run(alvo.id);

    const r = app.auditoria.verificarCadeia();
    assert.equal(r.integra, false);
    assert.equal(r.quebradoEm, alvo.id);
    assert.equal(r.motivo, 'conteudo adulterado');
  });

  test('detecta remocao de um registro do meio da cadeia', () => {
    pacienteDeTeste(app);
    app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);

    const meio = app.db.prepare('SELECT id FROM auditoria ORDER BY id LIMIT 1 OFFSET 1').get();
    app.db.prepare('DELETE FROM auditoria WHERE id = ?').run(meio.id);

    const r = app.auditoria.verificarCadeia();
    assert.equal(r.integra, false);
    assert.equal(r.motivo, 'encadeamento rompido');
  });

  test('cada registro encadeia o hash do anterior', () => {
    pacienteDeTeste(app);
    app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    const linhas = app.db.prepare('SELECT hash, hash_anterior FROM auditoria ORDER BY id').all();

    assert.equal(linhas[0].hash_anterior, '0'.repeat(64), 'o primeiro registro parte da genese');
    for (let i = 1; i < linhas.length; i++) {
      assert.equal(linhas[i].hash_anterior, linhas[i - 1].hash);
    }
  });
});
