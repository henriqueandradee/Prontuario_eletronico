import { createHash } from 'node:crypto';

/**
 * Trilha de auditoria imutavel e encadeada por hash.
 *
 * Cada registro carrega o hash do anterior; alterar ou remover qualquer linha
 * quebra a cadeia e e detectado por verificarCadeia(). Atende a exigencia de
 * rastreabilidade do nucleo regulado (LGPD Art. 37 e auditoria hospitalar).
 */
const GENESE = '0'.repeat(64);

function calcularHash(registro, hashAnterior) {
  return createHash('sha256').update([
    hashAnterior,
    registro.ator_id ?? '',
    registro.ator_nome,
    registro.papel,
    registro.acao,
    registro.entidade,
    registro.entidade_id ?? '',
    registro.detalhes ?? '',
    registro.criado_em,
  ].join('|')).digest('hex');
}

export function criarAuditoria(db) {
  const ultimo = db.prepare('SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1');
  const inserir = db.prepare(`
    INSERT INTO auditoria (ator_id, ator_nome, papel, acao, entidade, entidade_id,
                           detalhes, ip, criado_em, hash_anterior, hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

  /** Registra uma operacao na trilha. Nunca lanca: auditoria nao derruba o atendimento. */
  function registrar({ ator, acao, entidade, entidadeId = null, detalhes = null, ip = null }) {
    const criadoEm = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const registro = {
      ator_id: ator?.sub ?? null,
      ator_nome: ator?.nome ?? 'sistema',
      papel: ator?.papel ?? 'sistema',
      acao, entidade,
      entidade_id: entidadeId === null ? null : String(entidadeId),
      detalhes: detalhes ? JSON.stringify(detalhes) : null,
      criado_em: criadoEm,
    };
    const hashAnterior = ultimo.get()?.hash ?? GENESE;
    const hash = calcularHash(registro, hashAnterior);
    inserir.run(registro.ator_id, registro.ator_nome, registro.papel, registro.acao,
                registro.entidade, registro.entidade_id, registro.detalhes, ip,
                registro.criado_em, hashAnterior, hash);
    return hash;
  }

  /** Recalcula a cadeia inteira e aponta a primeira divergencia. */
  function verificarCadeia() {
    const linhas = db.prepare('SELECT * FROM auditoria ORDER BY id ASC').all();
    let anterior = GENESE;
    for (const linha of linhas) {
      if (linha.hash_anterior !== anterior) {
        return { integra: false, registros: linhas.length, quebradoEm: linha.id, motivo: 'encadeamento rompido' };
      }
      if (calcularHash(linha, anterior) !== linha.hash) {
        return { integra: false, registros: linhas.length, quebradoEm: linha.id, motivo: 'conteudo adulterado' };
      }
      anterior = linha.hash;
    }
    return { integra: true, registros: linhas.length, ultimoHash: anterior };
  }

  return { registrar, verificarCadeia };
}
