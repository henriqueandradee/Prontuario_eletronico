#!/usr/bin/env node
/**
 * Verificacao da integridade da trilha de auditoria.
 *
 * Roda no pipeline (etapa de conformidade) e pode ser agendada em producao.
 * Sai com codigo 1 se a cadeia estiver rompida, reprovando o build.
 */
import { abrirBanco } from '../src/db/index.js';
import { criarAuditoria } from '../src/lib/audit.js';
import { config } from '../src/config.js';

const db = abrirBanco(config.dbPath);
const { verificarCadeia } = criarAuditoria(db);
const r = verificarCadeia();

if (r.integra) {
  console.log(`OK  Trilha integra: ${r.registros} registros verificados.`);
  console.log(`    ultimo hash: ${r.ultimoHash ?? '(vazia)'}`);
  db.close();
  process.exit(0);
}

console.error(`FALHA  Integridade violada no registro #${r.quebradoEm}: ${r.motivo}.`);
console.error(`       ${r.registros} registros na trilha. Acione a area de conformidade.`);
db.close();
process.exit(1);
