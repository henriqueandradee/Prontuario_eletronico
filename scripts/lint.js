#!/usr/bin/env node
/**
 * Verificacao sintatica de todos os modulos do projeto (substitui o ESLint).
 *
 * Usa `node --check`, que apenas ANALISA o arquivo. Importar os modulos os
 * executaria - o que rodaria o seed e os servidores durante o build.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const IGNORAR = ['node_modules', '.git', 'data', 'coverage', 'evidencias'];

const arquivos = [];
(function varrer(dir) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.includes(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho);
    else if (nome.endsWith('.js')) arquivos.push(caminho);
  }
})('.');

let falhas = 0;
for (const arquivo of arquivos) {
  try {
    execFileSync(process.execPath, ['--check', arquivo], { stdio: 'pipe' });
  } catch (e) {
    console.error(`FALHA  ${arquivo}`);
    console.error(`       ${String(e.stderr).split('\n').find((l) => l.includes('Error')) ?? ''}`);
    falhas++;
  }
}

console.log(falhas
  ? `\n${falhas} de ${arquivos.length} arquivo(s) com erro de sintaxe.`
  : `OK  ${arquivos.length} arquivos verificados, nenhum erro de sintaxe.`);
process.exit(falhas ? 1 : 0);
