import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { aplicacaoDeTeste, pacienteDeTeste, chamadoBase, PONTO } from '../apoio.js';
import { triar, escolherAmbulancia, CORES } from '../../src/nucleo/despacho.service.js';
import { distanciaKm, etaMinutos } from '../../src/lib/geo.js';

let app;
beforeEach(() => { app = aplicacaoDeTeste(); });

describe('Protocolo de triagem', () => {
  test('respeita a prioridade informada quando nada a agrava', () => {
    const t = triar({ natureza: 'clinico', descricao: 'Mal estar leve.', prioridadeInformada: 4 });
    assert.equal(t.prioridade, 4);
    assert.equal(t.cor, 'verde');
  });

  test('sinal critico no relato eleva para prioridade maxima', () => {
    const t = triar({ natureza: 'clinico', descricao: 'Paciente inconsciente no chao.', prioridadeInformada: 5 });
    assert.equal(t.prioridade, 1);
    assert.equal(t.cor, 'vermelho');
    assert.ok(t.motivos.some((m) => m.includes('inconsciente')));
  });

  test('a natureza estabelece um piso de prioridade', () => {
    const t = triar({ natureza: 'cardiaco', descricao: 'Dor no peito.', prioridadeInformada: 5 });
    assert.equal(t.prioridade, 2);
    assert.ok(t.motivos.some((m) => m.includes('cardiaco')));
  });

  test('nunca rebaixa uma prioridade ja grave - protecao contra subtriagem', () => {
    const t = triar({ natureza: 'transferencia', descricao: 'Transporte simples.', prioridadeInformada: 1 });
    assert.equal(t.prioridade, 1, 'a triagem so agrava, nunca alivia');
  });

  test('toda prioridade tem cor, rotulo e tempo alvo definidos', () => {
    for (const p of [1, 2, 3, 4, 5]) {
      assert.ok(CORES[p].cor && CORES[p].rotulo);
      assert.equal(typeof CORES[p].tempoAlvoMin, 'number');
    }
    assert.ok(CORES[1].exigeUSA && CORES[2].exigeUSA, 'P1 e P2 exigem suporte avancado');
    assert.ok(!CORES[4].exigeUSA);
  });
});

describe('Selecao de ambulancia', () => {
  const frota = [
    { id: 1, prefixo: 'USB-A', tipo: 'USB', lat: -26.3045, lng: -48.8487 }, // a ~0 km
    { id: 2, prefixo: 'USA-A', tipo: 'USA', lat: -26.3300, lng: -48.8700 }, // ~3,5 km
  ];

  test('prioridade baixa escolhe a unidade mais proxima', () => {
    const { escolhida } = escolherAmbulancia(frota, { ...PONTO, prioridade: 4 });
    assert.equal(escolhida.prefixo, 'USB-A');
  });

  test('prioridade alta escolhe a USA mesmo estando mais distante', () => {
    const { escolhida } = escolherAmbulancia(frota, { ...PONTO, prioridade: 1 });
    assert.equal(escolhida.prefixo, 'USA-A');
    assert.equal(escolhida.adequada, true);
  });

  test('sem USA disponivel, cai para USB e sinaliza o recurso inadequado', () => {
    const soBasica = [frota[0]];
    const { escolhida } = escolherAmbulancia(soBasica, { ...PONTO, prioridade: 1 });
    assert.equal(escolhida.prefixo, 'USB-A');
    assert.equal(escolhida.adequada, false, 'a interface precisa alertar o operador');
  });

  test('sem frota disponivel nao ha escolha', () => {
    assert.equal(escolherAmbulancia([], { ...PONTO, prioridade: 3 }).escolhida, null);
  });
});

describe('Calculo geografico', () => {
  test('distancia zero para o mesmo ponto', () => {
    assert.equal(distanciaKm(PONTO.lat, PONTO.lng, PONTO.lat, PONTO.lng), 0);
  });

  test('distancia coerente entre pontos conhecidos (Joinville - Florianopolis)', () => {
    const km = distanciaKm(-26.3045, -48.8487, -27.5954, -48.5480);
    assert.ok(km > 140 && km < 150, `esperado ~145 km, obtido ${km.toFixed(1)}`);
  });

  test('ETA cresce com a distancia e nunca e zero', () => {
    assert.ok(etaMinutos(0) >= 1);
    assert.ok(etaMinutos(10) > etaMinutos(1));
  });
});

describe('Ciclo de vida do chamado', () => {
  test('percorre a sequencia completa ate a conclusao', () => {
    const c = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    assert.equal(c.status, 'aguardando');
    assert.match(c.protocolo, /^\d{4}-\d{6}$/);

    const despachado = app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);
    assert.equal(despachado.status, 'despachado');
    assert.ok(despachado.despachado_em);
    assert.equal(
      app.db.prepare('SELECT status FROM ambulancias WHERE id = ?').get(despachado.ambulancia_id).status,
      'a_caminho');

    assert.equal(app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip).status, 'no_local');
    assert.equal(app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip).status, 'transportando');
    const fim = app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);
    assert.equal(fim.status, 'concluido');
    assert.ok(fim.encerrado_em);
  });

  test('nao despacha duas vezes o mesmo chamado', () => {
    const c = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);
    assert.throws(() => app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip), /ja esta/);
  });

  test('nao despacha ambulancia ja empenhada', () => {
    const c1 = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    const d = app.despacho.despachar(c1.id, {}, app.equipe.operador, app.ip);
    const c2 = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    assert.throws(() => app.despacho.despachar(c2.id, { ambulancia_id: d.ambulancia_id },
      app.equipe.operador, app.ip), /esta 'a_caminho'/);
  });

  test('cancelamento exige motivo e libera a ambulancia', () => {
    const c = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    const d = app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);

    assert.throws(() => app.despacho.cancelarChamado(c.id, 'x', app.equipe.operador, app.ip), /motivo/);

    const cancelado = app.despacho.cancelarChamado(c.id, 'Trote confirmado pela central.',
      app.equipe.operador, app.ip);
    assert.equal(cancelado.status, 'cancelado');
    assert.equal(
      app.db.prepare('SELECT status FROM ambulancias WHERE id = ?').get(d.ambulancia_id).status,
      'disponivel');
  });

  test('registra a linha do tempo completa da ocorrencia', () => {
    const c = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);
    app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);
    const eventos = app.despacho.obterChamado(c.id).eventos.map((e) => e.tipo);
    assert.deepEqual(eventos, ['abertura', 'despacho', 'no_local']);
  });

  test('sem ambulancia livre o despacho falha com mensagem clara', () => {
    app.db.exec("UPDATE ambulancias SET status = 'indisponivel'");
    const c = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    assert.throws(() => app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip),
      /Nenhuma ambulancia disponivel/);
  });
});

describe('Integracao despacho -> prontuario', () => {
  test('a admissao abre o atendimento com a triagem feita em campo', () => {
    const p = pacienteDeTeste(app);
    const c = app.despacho.abrirChamado(chamadoBase({
      natureza: 'cardiaco', descricao: 'Dor no peito com sudorese.', paciente_id: p.id,
    }), app.equipe.operador, app.ip);

    app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);
    app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);
    app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);

    const { chamado, atendimento } = app.despacho.admitirNoHospital(c.id,
      { queixa_principal: 'Sindrome coronariana aguda suspeita.' },
      app.prontuario, app.equipe.operador, app.ip);

    assert.equal(atendimento.origem, 'ambulancia');
    assert.equal(atendimento.chamado_id, c.id);
    assert.equal(atendimento.classificacao_risco, chamado.cor_triagem,
      'a classificacao de campo nao pode se perder na admissao');
    assert.equal(chamado.atendimento_id, atendimento.id);
  });

  test('nao admite antes do transporte nem admite duas vezes', () => {
    const p = pacienteDeTeste(app);
    const c = app.despacho.abrirChamado(chamadoBase({ paciente_id: p.id }), app.equipe.operador, app.ip);

    assert.throws(() => app.despacho.admitirNoHospital(c.id, {}, app.prontuario,
      app.equipe.operador, app.ip), /transportando/);

    app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);
    app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);
    app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);
    app.despacho.admitirNoHospital(c.id, {}, app.prontuario, app.equipe.operador, app.ip);

    assert.throws(() => app.despacho.admitirNoHospital(c.id, {}, app.prontuario,
      app.equipe.operador, app.ip), /ja gerou o atendimento/);
  });

  test('admissao sem paciente identificado e recusada', () => {
    const c = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);
    app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);
    app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);
    assert.throws(() => app.despacho.admitirNoHospital(c.id, {}, app.prontuario,
      app.equipe.operador, app.ip), /paciente identificado/);
  });
});

describe('Indicadores da central', () => {
  test('contabiliza chamados ativos e tempos de resposta', () => {
    const c = app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);
    app.despacho.despachar(c.id, {}, app.equipe.operador, app.ip);
    app.despacho.avancarChamado(c.id, app.equipe.operador, app.ip);
    app.despacho.abrirChamado(chamadoBase(), app.equipe.operador, app.ip);

    const i = app.despacho.indicadores();
    assert.equal(i.chamados_ativos, 2);
    assert.equal(i.por_status.aguardando, 1);
    assert.equal(i.chamados_atendidos, 1);
    assert.equal(typeof i.prioridade_alta_fora_do_alvo, 'number');
  });
});
