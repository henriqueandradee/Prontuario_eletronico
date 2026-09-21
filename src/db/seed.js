import { abrirBanco } from './index.js';
import { gerarHashSenha } from '../lib/auth.js';
import { criarAuditoria } from '../lib/audit.js';
import { criarFlags } from '../app-paciente/flags.js';
import { criarServicoProntuario } from '../nucleo/prontuario.service.js';
import { criarServicoDespacho } from '../nucleo/despacho.service.js';
import { config } from '../config.js';

// Cenario ambientado em Joinville/SC.
const BASE = { lat: -26.3045, lng: -48.8487 };

const USUARIOS = [
  ['Dra. Helena Marques',    'helena@hospital.local',  'medico',            'CRM-SC 12345'],
  ['Dr. Rafael Nogueira',    'rafael@hospital.local',  'medico',            'CRM-SC 54321'],
  ['Enf. Camila Duarte',     'camila@hospital.local',  'enfermeiro',        'COREN-SC 98765'],
  ['Enf. Bruno Tavares',     'bruno@hospital.local',   'enfermeiro',        'COREN-SC 45612'],
  ['Juliana Alves',          'juliana@hospital.local', 'recepcao',          null],
  ['Marcos Vinicius',        'marcos@hospital.local',  'operador_despacho', null],
  ['Patricia Lemos',         'patricia@hospital.local','operador_despacho', null],
  ['Diego Ramos',            'diego@hospital.local',   'socorrista',        null],
  ['Sandra Figueiredo',      'sandra@hospital.local',  'auditor',           null],
  ['Administrador do Sistema','admin@hospital.local',  'admin',             null],
];

const AMBULANCIAS = [
  ['USB-01', 'USB', 'Base Centro',        -26.3045, -48.8487, 'Diego Ramos (condutor), Leticia Braz (tecnica)'],
  ['USB-02', 'USB', 'Base Norte',         -26.2610, -48.8510, 'Paulo Henrique (condutor), Ana Cruz (tecnica)'],
  ['USB-03', 'USB', 'Base Sul',           -26.3480, -48.8320, 'Ricardo Alves (condutor), Bianca Melo (tecnica)'],
  ['USA-01', 'USA', 'Base Centro',        -26.3050, -48.8460, 'Dr. Felipe Souza, Enf. Marina Lima, Jose Carlos (condutor)'],
  ['USA-02', 'USA', 'Base Hospital Geral',-26.2890, -48.8600, 'Dra. Larissa Pinto, Enf. Otavio Reis, Edson Matos (condutor)'],
];

const PACIENTES = [
  ['Maria Aparecida Souza', '52998224725', '1958-03-12', 'F', 'O+',  '47 99123-4567', 'Rua das Palmeiras, 120 - Centro'],
  ['Joao Pedro Lima',       '15350946056', '1992-07-30', 'M', 'A+',  '47 99888-1122', 'Av. Getulio Vargas, 875 - Bucarein'],
  ['Antonio Carlos Ferraz', '87748248800', '1945-11-02', 'M', 'B+',  '47 99777-3344', 'Rua Blumenau, 45 - America'],
  ['Luiza Martins Rocha',   '39053344705', '2001-01-25', 'F', 'AB-', '47 99666-5566', 'Rua Dona Francisca, 2200 - Santo Antonio'],
  ['Cleide Ramos da Silva', '11144477735', '1976-09-18', 'F', 'O-',  '47 99555-7788', 'Rua Iririu, 980 - Iririu'],
];

function principal() {
  const db = abrirBanco(config.dbPath);
  if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n > 0) {
    console.log('Banco ja populado. Use "npm run reset" para recriar do zero.');
    db.close();
    return;
  }

  const auditoria = criarAuditoria(db);
  criarFlags(db);
  const prontuario = criarServicoProntuario(db, auditoria);
  const despacho = criarServicoDespacho(db, auditoria);

  const sistema = { sub: null, nome: 'carga-inicial', papel: 'admin' };
  const senhaHash = gerarHashSenha('senha123');

  // --- equipe ---
  const inserirUsuario = db.prepare(
    'INSERT INTO usuarios (nome, email, senha_hash, papel, registro_prof) VALUES (?,?,?,?,?)');
  const ids = {};
  for (const [nome, email, papel, registro] of USUARIOS) {
    const { lastInsertRowid } = inserirUsuario.run(nome, email, senhaHash, papel, registro);
    ids[papel] = ids[papel] ?? Number(lastInsertRowid);
    ids[email] = Number(lastInsertRowid);
  }
  const medico = { sub: ids['helena@hospital.local'], nome: 'Dra. Helena Marques', papel: 'medico' };
  const enfermeiro = { sub: ids['camila@hospital.local'], nome: 'Enf. Camila Duarte', papel: 'enfermeiro' };
  const operador = { sub: ids['marcos@hospital.local'], nome: 'Marcos Vinicius', papel: 'operador_despacho' };
  const recepcao = { sub: ids['juliana@hospital.local'], nome: 'Juliana Alves', papel: 'recepcao' };

  // --- frota ---
  const inserirAmb = db.prepare(
    'INSERT INTO ambulancias (prefixo, tipo, base, lat, lng, equipe) VALUES (?,?,?,?,?,?)');
  for (const a of AMBULANCIAS) inserirAmb.run(...a);

  // --- pacientes ---
  const pacientes = PACIENTES.map(([nome, cpf, nasc, sexo, sangue, tel, end]) =>
    prontuario.cadastrarPaciente({
      nome, cpf, data_nascimento: nasc, sexo, tipo_sanguineo: sangue,
      telefone: tel, endereco: end, cartao_sus: `7000${cpf.slice(0, 11)}`,
    }, recepcao, '127.0.0.1'));

  prontuario.registrarAlergia(pacientes[0].id,
    { substancia: 'Dipirona', gravidade: 'grave', observacao: 'Episodio de anafilaxia em 2019.' }, medico, '127.0.0.1');
  prontuario.registrarAlergia(pacientes[2].id,
    { substancia: 'Penicilina', gravidade: 'moderada', observacao: 'Urticaria generalizada.' }, medico, '127.0.0.1');
  prontuario.registrarAlergia(pacientes[3].id,
    { substancia: 'Latex', gravidade: 'leve' }, enfermeiro, '127.0.0.1');

  // --- login do app para cada paciente ---
  const inserirLogin = db.prepare(
    'INSERT INTO usuarios (nome, email, senha_hash, papel, paciente_id) VALUES (?,?,?,?,?)');
  pacientes.forEach((p, i) => {
    inserirLogin.run(p.nome, `paciente${i + 1}@app.local`, senhaHash, 'paciente', p.id);
    db.prepare(`INSERT INTO consentimentos (paciente_id, finalidade, versao_termo, aceito)
                VALUES (?,?,?,1)`).run(p.id, 'Assistencia a saude e uso do aplicativo do paciente', 'TERMO-1.0');
  });

  // --- atendimento ambulatorial ja encerrado (historico) ---
  const antigo = prontuario.abrirAtendimento({
    paciente_id: pacientes[1].id, tipo: 'ambulatorial', origem: 'balcao',
    queixa_principal: 'Dor lombar ha 3 dias, sem irradiacao.', classificacao_risco: 'verde',
  }, recepcao, '127.0.0.1');
  prontuario.registrarEvolucao(antigo.id, {
    tipo: 'anamnese',
    texto: 'Paciente refere lombalgia mecanica ha 3 dias apos esforco fisico. Nega febre, trauma ou deficit neurologico. Exame fisico sem sinais de alarme.',
  }, medico, '127.0.0.1');
  prontuario.prescrever(antigo.id, {
    medicamento: 'Ibuprofeno 600mg', dose: '1 comprimido', via: 'oral',
    frequencia: '8/8h', duracao: '5 dias', observacao: 'Administrar apos as refeicoes.',
  }, medico, '127.0.0.1');
  prontuario.encerrarAtendimento(antigo.id, {
    status: 'alta', desfecho: 'Alta com analgesia e orientacoes posturais. Retorno se piora ou sinais de alarme.',
  }, medico, '127.0.0.1');

  // --- chamado concluido com admissao (demonstra a integracao dos modulos) ---
  const concluido = despacho.abrirChamado({
    solicitante_nome: 'Vizinho - Sr. Osvaldo', solicitante_telefone: '47 99444-2211',
    endereco: 'Rua Blumenau, 45 - America', lat: -26.2975, lng: -48.8555,
    natureza: 'cardiaco', descricao: 'Homem idoso com dor no peito e sudorese, consciente.',
    prioridade: 3, paciente_id: pacientes[2].id,
  }, operador, '127.0.0.1');
  despacho.despachar(concluido.id, {}, operador, '127.0.0.1');
  despacho.avancarChamado(concluido.id, operador, '127.0.0.1'); // no_local
  despacho.avancarChamado(concluido.id, operador, '127.0.0.1'); // transportando
  // A admissao e um ato clinico: quem abre o prontuario e a equipe do hospital,
  // nao o operador da central (ver a matriz de papeis em src/nucleo/rbac.js).
  const admissao = despacho.admitirNoHospital(concluido.id,
    { queixa_principal: 'Dor toracica tipica com sudorese, suspeita de sindrome coronariana aguda.' },
    prontuario, enfermeiro, '127.0.0.1');
  prontuario.registrarSinaisVitais(admissao.atendimento.id, {
    pa_sistolica: 168, pa_diastolica: 98, fc: 112, fr: 22, saturacao: 94, temperatura: 36.4, dor: 8,
  }, enfermeiro, '127.0.0.1');
  prontuario.registrarEvolucao(admissao.atendimento.id, {
    tipo: 'evolucao',
    texto: 'Paciente admitido via SAMU com dor toracica opressiva iniciada ha 40 minutos, irradiada para MSE, acompanhada de sudorese. ECG solicitado, troponina coletada. Mantido em monitorizacao continua na sala vermelha.',
  }, medico, '127.0.0.1');
  despacho.avancarChamado(concluido.id, operador, '127.0.0.1'); // concluido
  // Equipe sinalizou disponibilidade e retornou a base.
  despacho.atualizarAmbulancia(
    db.prepare('SELECT ambulancia_id AS id FROM chamados WHERE id = ?').get(concluido.id).id,
    { status: 'disponivel' }, operador, '127.0.0.1');

  // --- chamados ativos para o painel da central ---
  despacho.abrirChamado({
    solicitante_nome: 'Transeunte - Fernanda', solicitante_telefone: '47 98111-9090',
    endereco: 'Av. Santos Dumont, 1500 - Santo Antonio', lat: -26.2755, lng: -48.8300,
    natureza: 'trauma', descricao: 'Colisao moto x carro, motociclista consciente com fratura exposta na perna.',
    prioridade: 3,
  }, operador, '127.0.0.1');

  const critico = despacho.abrirChamado({
    solicitante_nome: 'Filha - Renata Souza', solicitante_telefone: '47 99123-4567',
    endereco: 'Rua das Palmeiras, 120 - Centro', lat: -26.3060, lng: -48.8470,
    natureza: 'clinico', descricao: 'Senhora idosa caiu e esta inconsciente, nao responde ao chamado.',
    prioridade: 4, paciente_id: pacientes[0].id,
  }, operador, '127.0.0.1');
  despacho.despachar(critico.id, {}, operador, '127.0.0.1');

  despacho.abrirChamado({
    solicitante_nome: 'Portaria do condominio', solicitante_telefone: '47 3422-1010',
    endereco: 'Rua Iririu, 980 - Iririu', lat: -26.2680, lng: -48.8180,
    natureza: 'respiratorio', descricao: 'Crise asmatica, paciente com falta de ar e chiado.',
    prioridade: 3, paciente_id: pacientes[4].id,
  }, operador, '127.0.0.1');

  // --- atendimento em andamento no PS ---
  const emAndamento = prontuario.abrirAtendimento({
    paciente_id: pacientes[3].id, tipo: 'emergencia', origem: 'balcao',
    queixa_principal: 'Febre alta e vomitos ha 12 horas.', classificacao_risco: 'amarelo', leito: 'PS-04',
  }, recepcao, '127.0.0.1');
  prontuario.registrarSinaisVitais(emAndamento.id, {
    temperatura: 39.2, fc: 118, fr: 20, saturacao: 97, pa_sistolica: 104, pa_diastolica: 66, dor: 5,
  }, enfermeiro, '127.0.0.1');
  prontuario.registrarEvolucao(emAndamento.id, {
    tipo: 'enfermagem',
    texto: 'Paciente acolhida na classificacao de risco com febre de 39,2 C e taquicardia. Instalado acesso venoso periferico em MSD. Aguarda avaliacao medica na sala amarela.',
  }, enfermeiro, '127.0.0.1');

  const integridade = auditoria.verificarCadeia();
  console.log('Carga inicial concluida.');
  console.log(`  usuarios .......... ${db.prepare('SELECT COUNT(*) n FROM usuarios').get().n}`);
  console.log(`  pacientes ......... ${db.prepare('SELECT COUNT(*) n FROM pacientes').get().n}`);
  console.log(`  ambulancias ....... ${db.prepare('SELECT COUNT(*) n FROM ambulancias').get().n}`);
  console.log(`  chamados .......... ${db.prepare('SELECT COUNT(*) n FROM chamados').get().n}`);
  console.log(`  atendimentos ...... ${db.prepare('SELECT COUNT(*) n FROM atendimentos').get().n}`);
  console.log(`  auditoria ......... ${integridade.registros} registros, cadeia ${integridade.integra ? 'integra' : 'VIOLADA'}`);
  console.log('\n  Senha de todos os usuarios de demonstracao: senha123\n');
  db.close();
}

principal();
