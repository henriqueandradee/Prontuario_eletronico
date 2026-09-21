import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSOES, temPermissao, exigirPermissao, permissoesDoPapel } from '../../src/nucleo/rbac.js';

describe('Matriz de papeis e permissoes', () => {
  test('admin tem acesso total', () => {
    assert.ok(temPermissao('admin', 'qualquer:coisa'));
    assert.ok(permissoesDoPapel('admin').length > 10);
  });

  test('papel desconhecido nao tem nenhuma permissao', () => {
    assert.equal(temPermissao('estagiario_curioso', 'paciente:ler'), false);
    assert.equal(temPermissao(undefined, 'paciente:ler'), false);
  });

  test('exigirPermissao lanca 403 com mensagem explicativa', () => {
    try {
      exigirPermissao({ papel: 'recepcao' }, 'prescricao:criar');
      assert.fail('deveria ter lancado');
    } catch (e) {
      assert.equal(e.status, 403);
      assert.match(e.message, /recepcao.*prescricao:criar/);
    }
  });

  describe('segregacao de funcoes', () => {
    test('somente medico e admin prescrevem', () => {
      assert.ok(temPermissao('medico', 'prescricao:criar'));
      for (const papel of ['enfermeiro', 'recepcao', 'operador_despacho', 'socorrista', 'auditor']) {
        assert.equal(temPermissao(papel, 'prescricao:criar'), false, `${papel} nao pode prescrever`);
      }
    });

    test('somente a central e o admin despacham ambulancias', () => {
      assert.ok(temPermissao('operador_despacho', 'chamado:despachar'));
      for (const papel of ['medico', 'enfermeiro', 'recepcao', 'socorrista', 'auditor']) {
        assert.equal(temPermissao(papel, 'chamado:despachar'), false, `${papel} nao pode despachar`);
      }
    });

    test('recepcao cadastra paciente mas nao acessa o registro clinico', () => {
      assert.ok(temPermissao('recepcao', 'paciente:criar'));
      assert.equal(temPermissao('recepcao', 'evolucao:registrar'), false);
      assert.equal(temPermissao('recepcao', 'sinais:registrar'), false);
    });

    test('o auditor le tudo e nao escreve nada', () => {
      assert.ok(temPermissao('auditor', 'auditoria:ler'));
      const escritas = PERMISSOES.auditor.filter((p) => !p.endsWith(':ler'));
      assert.deepEqual(escritas, [], 'auditor com permissao de escrita quebra a independencia da auditoria');
    });

    test('somente o auditor e o admin leem a trilha de auditoria', () => {
      const comAcesso = Object.keys(PERMISSOES).filter((p) => temPermissao(p, 'auditoria:ler'));
      assert.deepEqual(comAcesso.sort(), ['admin', 'auditor']);
    });

    test('o paciente nao acessa nenhuma rota do nucleo regulado', () => {
      assert.deepEqual(PERMISSOES.paciente, []);
      for (const permissao of ['paciente:ler', 'atendimento:ler', 'chamado:ler', 'auditoria:ler']) {
        assert.equal(temPermissao('paciente', permissao), false);
      }
    });
  });
});
