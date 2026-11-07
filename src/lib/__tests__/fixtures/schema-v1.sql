-- Banco de referência da versão anterior à migração v2 (Prompt 2).
-- Reproduz o schema e os dados de um arquivo .sqlite real exportado pelo
-- ValidaMétodo antes da introdução das famílias de método.
-- O binário schema-v1.sqlite foi gerado executando este script com sqlite3.

PRAGMA foreign_keys = ON;

CREATE TABLE methods (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  unit TEXT DEFAULT '',
  range_min REAL,
  range_max REAL,
  equipment TEXT DEFAULT '',
  reference_norm TEXT DEFAULT '',
  validation_type TEXT DEFAULT 'full',
  description TEXT DEFAULT '',
  criteria_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE validations (
  id TEXT PRIMARY KEY,
  method_id TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT DEFAULT '',
  scope TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  current_step INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  responsible TEXT DEFAULT '',
  reviewer TEXT DEFAULT '',
  approver TEXT DEFAULT '',
  approved_at TEXT,
  locked INTEGER DEFAULT 0,
  report_config_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(method_id) REFERENCES methods(id)
);

CREATE TABLE validation_parameters (
  validation_id TEXT NOT NULL,
  param_key TEXT NOT NULL,
  selected INTEGER DEFAULT 0,
  justification TEXT DEFAULT '',
  criteria_json TEXT DEFAULT '[]',
  PRIMARY KEY(validation_id, param_key),
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE designs (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  seed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE measurements (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  run_order INTEGER DEFAULT 0,
  level TEXT DEFAULT '',
  analyst TEXT DEFAULT '',
  day TEXT DEFAULT '',
  equipment TEXT DEFAULT '',
  lot TEXT DEFAULT '',
  sample TEXT DEFAULT '',
  replicate INTEGER DEFAULT 1,
  value REAL,
  reference_value REAL,
  text_value TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  parameter_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_hash TEXT DEFAULT '',
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE uncertainty_items (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  distribution TEXT NOT NULL,
  value REAL NOT NULL,
  divisor REAL DEFAULT 1,
  sensitivity REAL DEFAULT 1,
  std_uncertainty REAL DEFAULT 0,
  dof REAL,
  notes TEXT DEFAULT '',
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT DEFAULT 'draft',
  content_json TEXT NOT NULL,
  elaborated_by TEXT DEFAULT '',
  reviewed_by TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  elaborated_at TEXT,
  reviewed_at TEXT,
  approved_at TEXT,
  locked INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE validation_versions (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  reason TEXT DEFAULT '',
  timestamp TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE INDEX idx_validations_method ON validations(method_id);
CREATE INDEX idx_measurements_validation ON measurements(validation_id);
CREATE INDEX idx_analyses_validation ON analyses(validation_id);
CREATE INDEX idx_audit_validation ON audit_logs(validation_id);
CREATE INDEX idx_uncertainty_validation ON uncertainty_items(validation_id);

INSERT INTO methods VALUES
  ('method_old_a', 'ANAL-001', 'Método analítico antigo', 'quantitative', 'mg/L', 1, 10,
   'HPLC antigo', 'ISO 17025', 'full', 'Método preservado pela migração.',
   '[{"id":"c1","parameter":"linearity","metric":"r2","operator":">=","limit":0.99}]',
   '2025-01-01T10:00:00.000Z', '2025-02-01T10:00:00.000Z'),
  ('method_old_b', 'DIM-001', 'Método dimensional antigo', 'dimensional', 'mm', 0, 100,
   'Paquímetro', 'ISO 13385', 'full', 'Método dimensional anterior.',
   '[]', '2025-01-02T10:00:00.000Z', '2025-02-02T10:00:00.000Z');

INSERT INTO validations VALUES
  ('val_old_a', 'method_old_a', 'Validação antiga A', 'Objetivo A', 'Escopo A',
   'approved', 6, 2, 'Ana', 'Bruno', 'Carla', '2025-03-01T12:00:00.000Z', 1,
   '{"laboratoryName":"Lab Antigo","reportTitle":"Relatório A"}',
   '2025-01-01T10:00:00.000Z', '2025-03-01T12:00:00.000Z'),
  ('val_old_b', 'method_old_b', 'Validação antiga B', 'Objetivo B', 'Escopo B',
   'in_progress', 3, 1, 'Dora', '', '', NULL, 0,
   '{}', '2025-01-02T10:00:00.000Z', '2025-02-02T10:00:00.000Z');

INSERT INTO validation_parameters VALUES
  ('val_old_a', 'linearity', 1, 'Faixa declarada', '[{"metric":"r2","operator":">=","limit":0.99}]'),
  ('val_old_a', 'repeatability', 1, 'Precisão', '[]'),
  ('val_old_b', 'repeatability', 1, 'Precisão dimensional', '[]');

INSERT INTO designs VALUES
  ('design_old_a', 'val_old_a', '{"seed":123}', '{"runs":[]}', 123, '2025-01-05T10:00:00.000Z');

INSERT INTO measurements VALUES
  ('m_old_1', 'val_old_a', 1, '1', 'Ana', 'D1', 'HPLC', 'L1', 'S1', 1, 1.02, 1.0, '', 'preservada 1'),
  ('m_old_2', 'val_old_a', 2, '1', 'Ana', 'D1', 'HPLC', 'L1', 'S2', 2, 1.04, 1.0, '', 'preservada 2'),
  ('m_old_3', 'val_old_a', 3, '2', 'Bruno', 'D2', 'HPLC', 'L1', 'S3', 1, 2.01, 2.0, '', 'preservada 3'),
  ('m_old_4', 'val_old_b', 1, '10', 'Dora', 'D1', 'Paquímetro', 'L2', 'P1', 1, 10.01, 10.0, '', 'dimensional antiga');

INSERT INTO analyses VALUES
  ('an_old_1', 'val_old_a', 'linearity', 'linearity', 'hash-abc',
   '{"slope":1.0,"intercept":0.0}', '2025-02-10T10:00:00.000Z');

INSERT INTO uncertainty_items VALUES
  ('u_old_1', 'val_old_a', 'Repetibilidade', 'A', 'normal', 0.1, 1, 1, 0.1, 9, 'antiga'),
  ('u_old_2', 'val_old_a', 'Calibração', 'B', 'rectangular', 0.2, 1.7320508075688772, 1, 0.11547, 30, 'antiga');

INSERT INTO reports VALUES
  ('rep_old_1', 'val_old_a', 2, 'approved', '{"title":"Relatório antigo","version":"1.0"}',
   'Ana', 'Bruno', 'Carla', '2025-02-20T10:00:00.000Z', '2025-02-21T10:00:00.000Z',
   '2025-03-01T12:00:00.000Z', 1, '2025-02-20T10:00:00.000Z', '2025-03-01T12:00:00.000Z');

INSERT INTO validation_versions VALUES
  ('ver_old_1', 'val_old_a', 1, '{"validation":{"id":"val_old_a","version":1},"audit":[]}',
   'Primeira versão', 'Ana', '2025-02-01T10:00:00.000Z'),
  ('ver_old_2', 'val_old_a', 2, '{"validation":{"id":"val_old_a","version":2},"audit":[{"id":"aud_old_1"}]}',
   'Aprovação', 'Carla', '2025-03-01T12:00:00.000Z');

INSERT INTO audit_logs VALUES
  ('aud_old_1', 'val_old_a', 'validation', 'create', 'Ana', NULL,
   '{"id":"val_old_a","title":"Validação antiga A"}', 'Criação', '2025-01-01T10:00:00.000Z'),
  ('aud_old_2', 'val_old_a', 'measurements', 'replace', 'Bruno',
   '{"count":1}', '{"count":3}', 'Coleta', '2025-02-01T10:00:00.000Z');

INSERT INTO settings VALUES
  ('app', '{"laboratoryName":"Laboratório Antigo","theme":"light"}');
