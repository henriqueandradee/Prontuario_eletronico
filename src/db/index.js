import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const aqui = dirname(fileURLToPath(import.meta.url));

/** Abre (ou cria) o banco e aplica o schema versionado. */
export function abrirBanco(caminho = config.dbPath) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec(readFileSync(join(aqui, 'schema.sql'), 'utf8'));
  return db;
}

/** Executa uma funcao dentro de uma transacao. */
export function emTransacao(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
