import { criarAplicacao, criarServidor } from './app.js';
import { config } from './config.js';

const app = criarAplicacao();
const servidor = criarServidor(app);

servidor.listen(config.porta, () => {
  const integridade = app.auditoria.verificarCadeia();
  console.log('');
  console.log('  Prontuario Eletronico Hospitalar + Despacho de Ambulancias');
  console.log(`  versao ${config.versao} | baseline ${config.baseline} | ambiente ${config.ambiente}`);
  console.log('  ---------------------------------------------------------');
  console.log(`  Portal .............. http://localhost:${config.porta}/`);
  console.log(`  Painel hospitalar ... http://localhost:${config.porta}/nucleo.html`);
  console.log(`  Central de despacho . http://localhost:${config.porta}/despacho.html`);
  console.log(`  App do paciente ..... http://localhost:${config.porta}/paciente.html`);
  console.log(`  Trilha de auditoria . ${integridade.registros} registros, cadeia ${integridade.integra ? 'integra' : 'VIOLADA'}`);
  console.log('');
});

const encerrar = (sinal) => {
  console.log(`\n${sinal} recebido, encerrando com seguranca...`);
  servidor.close(() => { app.db.close(); process.exit(0); });
};
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
