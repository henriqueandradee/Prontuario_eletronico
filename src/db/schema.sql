-- =====================================================================
-- Prontuario Eletronico Hospitalar + Despacho de Ambulancias
-- Baseline: docs/00-documento-de-contexto.md
-- Qualquer alteracao neste arquivo exige aprovacao formal (nucleo regulado)
-- =====================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ----------------------------- IDENTIDADE ----------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  senha_hash    TEXT    NOT NULL,
  papel         TEXT    NOT NULL CHECK (papel IN (
                  'admin','medico','enfermeiro','recepcao',
                  'operador_despacho','socorrista','auditor','paciente')),
  registro_prof TEXT,                         -- CRM / COREN
  paciente_id   INTEGER REFERENCES pacientes(id),
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------- PRONTUARIO ----------------------------
CREATE TABLE IF NOT EXISTS pacientes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL,
  cpf             TEXT NOT NULL UNIQUE,
  data_nascimento TEXT NOT NULL,
  sexo            TEXT CHECK (sexo IN ('M','F','O')),
  cartao_sus      TEXT,
  telefone        TEXT,
  endereco        TEXT,
  tipo_sanguineo  TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  criado_por      INTEGER REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_pacientes_nome ON pacientes(nome);

CREATE TABLE IF NOT EXISTS alergias (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id   INTEGER NOT NULL REFERENCES pacientes(id),
  substancia    TEXT NOT NULL,
  gravidade     TEXT NOT NULL CHECK (gravidade IN ('leve','moderada','grave')),
  observacao    TEXT,
  registrado_por INTEGER REFERENCES usuarios(id),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alergias_paciente ON alergias(paciente_id);

CREATE TABLE IF NOT EXISTS atendimentos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id         INTEGER NOT NULL REFERENCES pacientes(id),
  tipo                TEXT NOT NULL CHECK (tipo IN ('emergencia','ambulatorial','internacao')),
  origem              TEXT NOT NULL CHECK (origem IN ('balcao','ambulancia','transferencia')),
  chamado_id          INTEGER REFERENCES chamados(id),
  classificacao_risco TEXT CHECK (classificacao_risco IN ('vermelho','laranja','amarelo','verde','azul')),
  queixa_principal    TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'aberto'
                        CHECK (status IN ('aberto','em_atendimento','observacao','alta','obito','transferido')),
  leito               TEXT,
  responsavel_id      INTEGER REFERENCES usuarios(id),
  desfecho            TEXT,
  aberto_em           TEXT NOT NULL DEFAULT (datetime('now')),
  fechado_em          TEXT
);
CREATE INDEX IF NOT EXISTS idx_atend_paciente ON atendimentos(paciente_id);
CREATE INDEX IF NOT EXISTS idx_atend_status   ON atendimentos(status);

-- Registro clinico e APPEND-ONLY: nao ha UPDATE nem DELETE.
-- Correcoes sao feitas por nova evolucao do tipo 'retificacao'.
CREATE TABLE IF NOT EXISTS evolucoes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  atendimento_id INTEGER NOT NULL REFERENCES atendimentos(id),
  autor_id       INTEGER NOT NULL REFERENCES usuarios(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('anamnese','evolucao','enfermagem','exame','retificacao')),
  texto          TEXT NOT NULL,
  retifica_id    INTEGER REFERENCES evolucoes(id),
  assinatura     TEXT NOT NULL,               -- HMAC do conteudo + autor
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evol_atend ON evolucoes(atendimento_id);

CREATE TABLE IF NOT EXISTS sinais_vitais (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  atendimento_id INTEGER NOT NULL REFERENCES atendimentos(id),
  pa_sistolica   INTEGER, pa_diastolica INTEGER,
  fc             INTEGER, fr INTEGER,
  temperatura    REAL,    saturacao INTEGER,
  glicemia       INTEGER, dor INTEGER CHECK (dor BETWEEN 0 AND 10),
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sv_atend ON sinais_vitais(atendimento_id);

CREATE TABLE IF NOT EXISTS prescricoes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  atendimento_id INTEGER NOT NULL REFERENCES atendimentos(id),
  medicamento    TEXT NOT NULL,
  dose           TEXT NOT NULL,
  via            TEXT NOT NULL CHECK (via IN ('oral','ev','im','sc','inalatoria','topica','retal')),
  frequencia     TEXT NOT NULL,
  duracao        TEXT,
  observacao     TEXT,
  prescritor_id  INTEGER NOT NULL REFERENCES usuarios(id),
  status         TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','suspensa','concluida')),
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_presc_atend ON prescricoes(atendimento_id);

-- LGPD Art. 7 e 11: base legal para tratamento dos dados de saude
CREATE TABLE IF NOT EXISTS consentimentos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id  INTEGER NOT NULL REFERENCES pacientes(id),
  finalidade   TEXT NOT NULL,
  versao_termo TEXT NOT NULL,
  aceito       INTEGER NOT NULL,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------- DESPACHO -------------------------------
CREATE TABLE IF NOT EXISTS ambulancias (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  prefixo       TEXT NOT NULL UNIQUE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('USB','USA')),  -- Basica / Avancada
  base          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN (
                  'disponivel','a_caminho','no_local','transportando','no_hospital','indisponivel')),
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  equipe        TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chamados (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  protocolo           TEXT NOT NULL UNIQUE,
  canal               TEXT NOT NULL CHECK (canal IN ('central','app_paciente')),
  solicitante_nome    TEXT NOT NULL,
  solicitante_telefone TEXT,
  paciente_id         INTEGER REFERENCES pacientes(id),
  endereco            TEXT NOT NULL,
  lat                 REAL NOT NULL,
  lng                 REAL NOT NULL,
  natureza            TEXT NOT NULL CHECK (natureza IN (
                        'clinico','trauma','cardiaco','respiratorio','obstetrico',
                        'psiquiatrico','intoxicacao','transferencia')),
  descricao           TEXT,
  prioridade          INTEGER NOT NULL CHECK (prioridade BETWEEN 1 AND 5),
  cor_triagem         TEXT NOT NULL CHECK (cor_triagem IN ('vermelho','laranja','amarelo','verde','azul')),
  status              TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN (
                        'aguardando','despachado','no_local','transportando','concluido','cancelado')),
  ambulancia_id       INTEGER REFERENCES ambulancias(id),
  atendimento_id      INTEGER REFERENCES atendimentos(id),
  aberto_por          INTEGER REFERENCES usuarios(id),
  aberto_em           TEXT NOT NULL DEFAULT (datetime('now')),
  despachado_em       TEXT,
  no_local_em         TEXT,
  hospital_em         TEXT,
  encerrado_em        TEXT,
  motivo_cancelamento TEXT
);
CREATE INDEX IF NOT EXISTS idx_chamados_status ON chamados(status, prioridade);

CREATE TABLE IF NOT EXISTS chamado_eventos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chamado_id INTEGER NOT NULL REFERENCES chamados(id),
  tipo       TEXT NOT NULL,
  descricao  TEXT NOT NULL,
  autor_id   INTEGER REFERENCES usuarios(id),
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evt_chamado ON chamado_eventos(chamado_id);

-- ---------------------------- AUDITORIA ------------------------------
-- Trilha imutavel encadeada por hash (LGPD Art. 37 - registro das operacoes)
CREATE TABLE IF NOT EXISTS auditoria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ator_id       INTEGER,
  ator_nome     TEXT NOT NULL,
  papel         TEXT NOT NULL,
  acao          TEXT NOT NULL,
  entidade      TEXT NOT NULL,
  entidade_id   TEXT,
  detalhes      TEXT,
  ip            TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  hash_anterior TEXT NOT NULL,
  hash          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aud_entidade ON auditoria(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_aud_ator     ON auditoria(ator_id);

-- --------------------- APP DO PACIENTE (DevOps) ----------------------
-- Feature flags: habilitam deploy continuo com rollback sem redeploy
CREATE TABLE IF NOT EXISTS feature_flags (
  chave         TEXT PRIMARY KEY,
  descricao     TEXT NOT NULL,
  ativo         INTEGER NOT NULL DEFAULT 0,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
