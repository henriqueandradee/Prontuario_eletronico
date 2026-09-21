/**
 * Feature flags do app do paciente.
 *
 * Decisao 4/5 do documento: o app do paciente evolui com DevOps e deploys
 * frequentes. As flags permitem entregar codigo em producao desligado e fazer
 * ROLLBACK de funcionalidade sem novo deploy - o que o nucleo regulado, sob
 * Cascata, nao pode fazer.
 */
export const FLAGS_PADRAO = [
  { chave: 'app.solicitar_ambulancia', descricao: 'Permite abrir chamado de ambulancia pelo app', ativo: 1 },
  { chave: 'app.acompanhar_chamado',   descricao: 'Acompanhamento em tempo real do chamado', ativo: 1 },
  { chave: 'app.ver_prescricoes',      descricao: 'Exibe prescricoes ativas ao paciente', ativo: 1 },
  { chave: 'app.ver_evolucoes',        descricao: 'Exibe evolucoes clinicas ao paciente', ativo: 0 },
  { chave: 'app.historico_completo',   descricao: 'Historico de todos os atendimentos anteriores', ativo: 1 },
  { chave: 'app.teleorientacao',       descricao: 'Canal de teleorientacao (em canario)', ativo: 0 },
];

export function criarFlags(db) {
  const inserir = db.prepare(
    'INSERT OR IGNORE INTO feature_flags (chave, descricao, ativo) VALUES (?,?,?)');
  for (const f of FLAGS_PADRAO) inserir.run(f.chave, f.descricao, f.ativo);

  return {
    listar: () => db.prepare('SELECT * FROM feature_flags ORDER BY chave').all(),
    ativa: (chave) => Boolean(db.prepare('SELECT ativo FROM feature_flags WHERE chave = ?').get(chave)?.ativo),
    mapa: () => Object.fromEntries(
      db.prepare('SELECT chave, ativo FROM feature_flags').all().map((f) => [f.chave, Boolean(f.ativo)])),
    definir(chave, ativo) {
      const r = db.prepare(
        "UPDATE feature_flags SET ativo = ?, atualizado_em = datetime('now') WHERE chave = ?")
        .run(ativo ? 1 : 0, chave);
      return r.changes > 0;
    },
  };
}
