/* =====================================================================
 * TESTES DE CONTRATO entre o nucleo regulado e o app do paciente.
 *
 * Mitigacao direta do risco levantado na questao 3 do documento: as duas
 * partes evoluem em ritmos diferentes (Cascata x DevOps), entao uma mudanca
 * no nucleo pode quebrar o app silenciosamente.
 *
 * Estes testes fixam o que o app DEPENDE do nucleo. Rodam no pipeline das
 * duas trilhas: se o contrato quebrar, o deploy para antes de chegar ao
 * paciente.
 * ===================================================================== */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { aplicacaoDeTeste, pacienteDeTeste, PONTO } from '../apoio.js';
import { CORES } from '../../src/nucleo/despacho.service.js';

let app, paciente, ator;

beforeEach(() => {
  app = aplicacaoDeTeste();
  paciente = pacienteDeTeste(app, { endereco: 'Rua do Contrato, 1' });
  app.db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash, papel, paciente_id) VALUES (?,?,?,?,?,?)')
    .run(90, paciente.nome, 'contrato@app.local', 'x', 'paciente', paciente.id);
  ator = { sub: 90, nome: paciente.nome, papel: 'paciente', paciente_id: paciente.id };
});

describe('Contrato: abertura de chamado pelo app', () => {
  test('o nucleo aceita o canal app_paciente', () => {
    const c = app.paciente.solicitarAmbulancia({
      ...PONTO, natureza: 'clinico', descricao: 'Mal estar geral com tontura.',
    }, ator, app.ip);
    assert.equal(c.canal, 'app_paciente',
      'o nucleo precisa distinguir a origem do chamado para a central');
  });

  test('o chamado do app expoe os campos que a tela do paciente renderiza', () => {
    const c = app.paciente.solicitarAmbulancia({
      ...PONTO, natureza: 'clinico', descricao: 'Mal estar geral com tontura.',
    }, ator, app.ip);
    app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);

    const visao = app.paciente.meuChamadoAtivo(ator, app.ip);
    for (const campo of ['protocolo', 'status', 'cor_triagem', 'classificacao',
                         'endereco', 'aberto_em', 'ambulancia', 'linha_do_tempo']) {
      assert.ok(campo in visao, `o app renderiza '${campo}': remover quebra a tela do paciente`);
    }
    for (const campo of ['prefixo', 'tipo', 'lat', 'lng']) {
      assert.ok(campo in visao.ambulancia, `o rastreio depende de ambulancia.${campo}`);
    }
    assert.ok('rotulo' in visao.classificacao && 'tempoAlvoMin' in visao.classificacao);
  });

  test('a solicitacao usa o endereco cadastrado quando o app nao envia um', () => {
    const c = app.paciente.solicitarAmbulancia({
      ...PONTO, natureza: 'clinico', descricao: 'Mal estar sem endereco informado.',
    }, ator, app.ip);
    assert.equal(c.endereco, 'Rua do Contrato, 1');
  });
});

describe('Contrato: vocabulario compartilhado', () => {
  test('os status de chamado sao os mesmos nas duas trilhas', () => {
    const doBanco = app.db.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'chamados'").get().sql;
    for (const status of ['aguardando', 'despachado', 'no_local', 'transportando', 'concluido', 'cancelado']) {
      assert.ok(doBanco.includes(`'${status}'`), `status '${status}' sumiu do nucleo e o app o exibe`);
    }
  });

  test('as cores de triagem exibidas no app existem no nucleo', () => {
    const coresDoNucleo = Object.values(CORES).map((c) => c.cor);
    for (const cor of ['vermelho', 'laranja', 'amarelo', 'verde', 'azul']) {
      assert.ok(coresDoNucleo.includes(cor), `a cor '${cor}' e usada na interface do app`);
    }
  });

  test('toda prioridade devolve rotulo e tempo alvo para o app exibir', () => {
    for (const p of [1, 2, 3, 4, 5]) {
      assert.equal(typeof CORES[p].rotulo, 'string');
      assert.equal(typeof CORES[p].tempoAlvoMin, 'number');
    }
  });
});

describe('Contrato: visao do atendimento no app', () => {
  test('o app recebe os campos que exibe e nenhum dado clinico sensivel a mais', () => {
    const at = app.prontuario.abrirAtendimento({
      paciente_id: paciente.id, tipo: 'ambulatorial', origem: 'balcao',
      queixa_principal: 'Consulta de rotina para o teste de contrato.',
    }, app.equipe.recepcao, app.ip);
    app.prontuario.prescrever(at.id, {
      medicamento: 'Paracetamol 750mg', dose: '1 comp', via: 'oral', frequencia: '6/6h',
    }, app.equipe.medico, app.ip);

    const visao = app.paciente.meuAtendimento(at.id, ator, app.ip);
    for (const campo of ['id', 'tipo', 'status', 'queixa_principal', 'aberto_em']) {
      assert.ok(campo in visao, `o app renderiza '${campo}'`);
    }
    for (const campo of ['medicamento', 'dose', 'via', 'frequencia', 'status', 'prescritor']) {
      assert.ok(campo in visao.prescricoes[0], `a lista de medicamentos depende de '${campo}'`);
    }
    // Barreira de privacidade: o que nao pode vazar para o app.
    for (const proibido of ['sinais_vitais', 'responsavel_id', 'paciente_cpf', 'alergias']) {
      assert.ok(!(proibido in visao), `'${proibido}' nao pode chegar ao app do paciente`);
    }
  });
});

describe('Contrato: as flags nunca quebram a leitura da tela', () => {
  test('com todas as flags desligadas o app ainda obtem perfil e historico', () => {
    for (const f of app.flags.listar()) app.flags.definir(f.chave, false);

    assert.ok(app.paciente.meuPerfil(ator, app.ip).nome, 'o perfil nao depende de flag');
    assert.ok(Array.isArray(app.paciente.meusAtendimentos(ator, app.ip)),
      'o historico nao pode quebrar, apenas encurtar');

    // As funcionalidades desligadas falham de forma previsivel, com mensagem.
    assert.throws(() => app.paciente.solicitarAmbulancia({
      ...PONTO, natureza: 'clinico', descricao: 'Chamado com a flag desligada.',
    }, ator, app.ip), /indisponivel/);
    assert.throws(() => app.paciente.meuChamadoAtivo(ator, app.ip), /indisponivel/);
  });
});
