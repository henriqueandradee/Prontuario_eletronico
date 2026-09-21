import { criarAplicacao } from '../src/app.js';
import { gerarHashSenha } from '../src/lib/auth.js';

/** Aplicacao isolada em memoria para cada arquivo de teste. */
export function aplicacaoDeTeste() {
  const app = criarAplicacao({ caminhoBanco: ':memory:' });
  const senha = gerarHashSenha('senha123');
  const inserir = app.db.prepare(
    'INSERT INTO usuarios (nome, email, senha_hash, papel, registro_prof, paciente_id) VALUES (?,?,?,?,?,?)');

  const equipe = {};
  const criar = (nome, email, papel, registro = null, pacienteId = null) => {
    const { lastInsertRowid } = inserir.run(nome, email, senha, papel, registro, pacienteId);
    return { sub: Number(lastInsertRowid), nome, papel, paciente_id: pacienteId };
  };

  equipe.medico = criar('Dra. Teste', 'medico@t.local', 'medico', 'CRM-SC 1');
  equipe.enfermeiro = criar('Enf. Teste', 'enf@t.local', 'enfermeiro', 'COREN-SC 1');
  equipe.recepcao = criar('Recepcao Teste', 'rec@t.local', 'recepcao');
  equipe.operador = criar('Operador Teste', 'ope@t.local', 'operador_despacho');
  equipe.auditor = criar('Auditor Teste', 'aud@t.local', 'auditor');
  equipe.admin = criar('Admin Teste', 'adm@t.local', 'admin');

  const frota = app.db.prepare(
    'INSERT INTO ambulancias (prefixo, tipo, base, lat, lng) VALUES (?,?,?,?,?)');
  frota.run('USB-T1', 'USB', 'Base Teste', -26.3045, -48.8487); // a ~0 km do ponto de referencia
  frota.run('USA-T1', 'USA', 'Base Teste', -26.3200, -48.8600); // mais distante, porem avancada

  return { ...app, equipe, ip: '127.0.0.1' };
}

/** Paciente valido pronto para uso (CPF com digitos verificadores corretos). */
export function pacienteDeTeste(app, sobrescrever = {}) {
  return app.prontuario.cadastrarPaciente({
    nome: 'Paciente de Teste',
    cpf: '52998224725',
    data_nascimento: '1980-05-10',
    sexo: 'F',
    ...sobrescrever,
  }, app.equipe.recepcao, app.ip);
}

export const PONTO = { lat: -26.3045, lng: -48.8487 };

export const chamadoBase = (sobrescrever = {}) => ({
  solicitante_nome: 'Solicitante de Teste',
  endereco: 'Rua de Teste, 100 - Centro',
  ...PONTO,
  natureza: 'clinico',
  descricao: 'Relato padrao de teste sem sinais de alarme descritos.',
  prioridade: 4,
  ...sobrescrever,
});
