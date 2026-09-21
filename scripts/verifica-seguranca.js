#!/usr/bin/env node
/**
 * Verificacoes de seguranca e conformidade do nucleo regulado.
 *
 * Substitui, em escala academica, a etapa de SAST do pipeline: checa invariantes
 * que, se quebradas, colocam dados de saude em risco. Reprova o build ao falhar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSOES } from '../src/nucleo/rbac.js';

const falhas = [];
const avisos = [];
const checar = (condicao, mensagem) => { if (!condicao) falhas.push(mensagem); };

// ------------------- 1. segredos fora do codigo -----------------------
function arquivos(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    if (['node_modules', '.git', 'data', 'coverage'].includes(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, acc);
    else if (/\.(js|json|sql|html)$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

const SUSPEITOS = [
  { regex: /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9+/]{20,}['"]/i, texto: 'possivel segredo embutido no codigo' },
  { regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, texto: 'chave privada versionada' },
];

for (const arquivo of arquivos('src').concat(arquivos('public'), arquivos('tests'))) {
  const conteudo = readFileSync(arquivo, 'utf8');
  for (const s of SUSPEITOS) {
    if (s.regex.test(conteudo)) falhas.push(`${arquivo}: ${s.texto}`);
  }
}

// --------------- 2. o segredo padrao nunca vai a producao --------------
const configFonte = readFileSync('src/config.js', 'utf8');
checar(configFonte.includes("ambiente === 'production'"),
  'config.js deve impedir o segredo de desenvolvimento em producao');

// ------------------ 3. invariantes da matriz de RBAC -------------------
checar(PERMISSOES.paciente.length === 0,
  'o papel paciente nao pode ter permissao alguma no nucleo regulado');

const escritasDoAuditor = PERMISSOES.auditor.filter((p) => !p.endsWith(':ler'));
checar(escritasDoAuditor.length === 0,
  `o auditor deve ser somente leitura (encontrado: ${escritasDoAuditor.join(', ')})`);

const prescritores = Object.entries(PERMISSOES)
  .filter(([, lista]) => lista.includes('prescricao:criar') || lista.includes('*'))
  .map(([papel]) => papel);
checar(prescritores.every((p) => ['medico', 'admin'].includes(p)),
  `somente medico e admin podem prescrever (encontrado: ${prescritores.join(', ')})`);

const leitoresDaTrilha = Object.entries(PERMISSOES)
  .filter(([, lista]) => lista.includes('auditoria:ler') || lista.includes('*'))
  .map(([papel]) => papel);
checar(leitoresDaTrilha.every((p) => ['auditor', 'admin'].includes(p)),
  `a trilha de auditoria so pode ser lida por auditor e admin (encontrado: ${leitoresDaTrilha.join(', ')})`);

// ------------- 4. registro clinico permanece append-only ---------------
const prontuarioFonte = readFileSync('src/nucleo/prontuario.service.js', 'utf8');
checar(!/UPDATE\s+evolucoes/i.test(prontuarioFonte),
  'evolucoes nao podem sofrer UPDATE: o registro clinico e append-only');
checar(!/DELETE\s+FROM\s+evolucoes/i.test(prontuarioFonte),
  'evolucoes nao podem ser apagadas');
checar(!/DELETE\s+FROM\s+auditoria/i.test(readFileSync('src/lib/audit.js', 'utf8')),
  'a trilha de auditoria nao pode ter rotina de exclusao');

// ---------------- 5. toda rota do nucleo exige permissao ---------------
const rotasFonte = readFileSync('src/rotas.js', 'utf8');
const blocos = rotasFonte.split(/r\.(get|post|patch|put|delete)\(/).slice(1);
for (let i = 1; i < blocos.length; i += 2) {
  const bloco = blocos[i];
  const caminho = bloco.match(/'([^']+)'/)?.[1] ?? '?';
  if (!caminho.startsWith('/api/nucleo/')) continue;
  if (!/exigirPermissao|papel !== 'admin'/.test(bloco)) {
    falhas.push(`rota ${caminho} do nucleo regulado sem verificacao de permissao`);
  }
}

// ------------------ 6. dependencias de terceiros -----------------------
const pacote = JSON.parse(readFileSync('package.json', 'utf8'));
const deps = Object.keys(pacote.dependencies ?? {}).length;
if (deps > 0) avisos.push(`${deps} dependencia(s) de producao exigem analise de vulnerabilidades`);

// ------------------------------ relatorio ------------------------------
console.log('Verificacao de seguranca e conformidade do nucleo regulado\n');
for (const a of avisos) console.log(`AVISO  ${a}`);
if (!falhas.length) {
  console.log('OK  Todas as verificacoes passaram.');
  console.log('    segredos, RBAC, append-only do registro clinico e autorizacao das rotas.');
  process.exit(0);
}
for (const f of falhas) console.error(`FALHA  ${f}`);
console.error(`\n${falhas.length} verificacao(oes) reprovada(s). Build interrompido.`);
process.exit(1);
