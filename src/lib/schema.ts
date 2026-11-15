/**
 * Schema SQLite e migrações versionadas.
 *
 * O schema base é criado com `CREATE TABLE IF NOT EXISTS`, portanto abrir um
 * banco antigo não altera tabelas existentes. As migrações abaixo evoluem o
 * banco de forma incremental, idempotente e registrada em `schema_migrations`.
 *
 * Versões:
 *   1 — schema inicial (métodos analíticos, medições, análises, auditoria).
 *   2 — famílias de método, tolerâncias, resolução, mensurando e campos de
 *       medição para dimensionais/físicos/atributo.
 */

import type { Database } from 'sql.js';

export const LATEST_SCHEMA_VERSION = 3;

export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS methods (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  family TEXT DEFAULT 'analytical',
  unit TEXT DEFAULT '',
  range_min REAL,
  range_max REAL,
  lsl REAL,
  usl REAL,
  resolution REAL,
  measurand TEXT DEFAULT '',
  tolerance_unit TEXT DEFAULT '',
  equipment TEXT DEFAULT '',
  reference_norm TEXT DEFAULT '',
  validation_type TEXT DEFAULT 'full',
  description TEXT DEFAULT '',
  criteria_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validations (
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

CREATE TABLE IF NOT EXISTS validation_parameters (
  validation_id TEXT NOT NULL,
  param_key TEXT NOT NULL,
  selected INTEGER DEFAULT 0,
  justification TEXT DEFAULT '',
  criteria_json TEXT DEFAULT '[]',
  PRIMARY KEY(validation_id, param_key),
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  seed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  run_order INTEGER DEFAULT 0,
  level TEXT DEFAULT '',
  analyst TEXT DEFAULT '',
  day TEXT DEFAULT '',
  equipment TEXT DEFAULT '',
  lot TEXT DEFAULT '',
  sample TEXT DEFAULT '',
  part_id TEXT,
  specimen TEXT,
  destructive INTEGER DEFAULT 0,
  condition_json TEXT,
  ref_value REAL,
  ref_uncertainty REAL,
  category TEXT,
  replicate INTEGER DEFAULT 1,
  value REAL,
  reference_value REAL,
  text_value TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  parameter_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_hash TEXT DEFAULT '',
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE IF NOT EXISTS uncertainty_items (
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

CREATE TABLE IF NOT EXISTS reports (
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

CREATE TABLE IF NOT EXISTS validation_versions (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(validation_id) REFERENCES validations(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  reason TEXT DEFAULT '',
  timestamp TEXT NOT NULL,
  previous_hash TEXT,
  current_hash TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_validations_method ON validations(method_id);
CREATE INDEX IF NOT EXISTS idx_measurements_validation ON measurements(validation_id);
CREATE INDEX IF NOT EXISTS idx_analyses_validation ON analyses(validation_id);
CREATE INDEX IF NOT EXISTS idx_audit_validation ON audit_logs(validation_id);
CREATE INDEX IF NOT EXISTS idx_uncertainty_validation ON uncertainty_items(validation_id);
`;

export interface MigrationResult {
  /** Versão encontrada antes das migrações. */
  from: number;
  /** Versão registrada ao final. */
  to: number;
  /** Versões efetivamente aplicadas nesta execução. */
  applied: number[];
  /** Colunas criadas nesta execução (para diagnóstico e testes). */
  addedColumns: string[];
}

interface Migration {
  version: number;
  description: string;
  up: (db: Database, addedColumns: string[]) => void;
}

function tableExists(db: Database, table: string): boolean {
  const result = db.exec(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table.replace(/'/g, "''")}'`,
  );
  return Boolean(result[0]?.values.length);
}

/** Colunas de uma tabela; retorna [] quando a tabela ainda não existe. */
export function tableColumns(db: Database, table: string): string[] {
  if (!tableExists(db, table)) return [];
  const result = db.exec(`PRAGMA table_info(${table})`);
  return result[0]?.values.map((row) => String(row[1])) ?? [];
}

/**
 * Adiciona uma coluna somente se ela ainda não existir.
 * Retorna `true` quando a coluna foi criada nesta chamada.
 */
export function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  definition: string,
  addedColumns?: string[],
): boolean {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(column)) {
    throw new Error(`Identificador inválido na migração: ${table}.${column}`);
  }
  if (tableColumns(db, table).includes(column)) return false;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  addedColumns?.push(`${table}.${column}`);
  return true;
}

function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT DEFAULT ''
    )
  `);
}

/** Maior versão de schema registrada; 0 quando o banco é anterior ao controle. */
export function getSchemaVersion(db: Database): number {
  if (!tableExists(db, 'schema_migrations')) return 0;
  const result = db.exec('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations');
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

export function listAppliedMigrations(db: Database): number[] {
  if (!tableExists(db, 'schema_migrations')) return [];
  const result = db.exec('SELECT version FROM schema_migrations ORDER BY version');
  return result[0]?.values.map((row) => Number(row[0])) ?? [];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Schema inicial — métodos analíticos',
    // O schema inicial já é criado integralmente por SCHEMA (CREATE TABLE IF
    // NOT EXISTS). A versão 1 apenas registra o marco para bancos existentes.
    up: () => {},
  },
  {
    version: 2,
    description: 'Famílias de método e campos dimensionais/físicos/atributo',
    up: (db, addedColumns) => {
      addColumnIfMissing(db, 'methods', 'family', "TEXT DEFAULT 'analytical'", addedColumns);
      addColumnIfMissing(db, 'methods', 'lsl', 'REAL', addedColumns);
      addColumnIfMissing(db, 'methods', 'usl', 'REAL', addedColumns);
      addColumnIfMissing(db, 'methods', 'resolution', 'REAL', addedColumns);
      addColumnIfMissing(db, 'methods', 'measurand', "TEXT DEFAULT ''", addedColumns);
      addColumnIfMissing(db, 'methods', 'tolerance_unit', "TEXT DEFAULT ''", addedColumns);

      addColumnIfMissing(db, 'measurements', 'part_id', 'TEXT', addedColumns);
      addColumnIfMissing(db, 'measurements', 'specimen', 'TEXT', addedColumns);
      addColumnIfMissing(db, 'measurements', 'destructive', 'INTEGER DEFAULT 0', addedColumns);
      addColumnIfMissing(db, 'measurements', 'condition_json', 'TEXT', addedColumns);
      addColumnIfMissing(db, 'measurements', 'ref_value', 'REAL', addedColumns);
      addColumnIfMissing(db, 'measurements', 'ref_uncertainty', 'REAL', addedColumns);
      addColumnIfMissing(db, 'measurements', 'category', 'TEXT', addedColumns);
      // Migração anterior (não versionada) do Prompt 1; mantida para bancos
      // ainda mais antigos que não passaram por `ensureMigrations`.
      addColumnIfMissing(db, 'measurements', 'reference_value', 'REAL', addedColumns);

      // Métodos existentes passam a pertencer à família analítica. A cláusula
      // cobre tanto NULL (bancos muito antigos) quanto string vazia.
      db.run("UPDATE methods SET family = 'analytical' WHERE family IS NULL OR TRIM(family) = ''");
      db.run('UPDATE measurements SET destructive = 0 WHERE destructive IS NULL');
    },
  },
  {
    version: 3,
    description: 'Trilha de auditoria com hash-chaining (21 CFR Part 11)',
    up: (db, addedColumns) => {
      addColumnIfMissing(db, 'audit_logs', 'previous_hash', 'TEXT', addedColumns);
      addColumnIfMissing(db, 'audit_logs', 'current_hash', 'TEXT', addedColumns);
    },
  },
];

/**
 * Aplica as migrações pendentes em ordem, registrando cada versão.
 * É idempotente: uma segunda chamada não encontra versões pendentes.
 */
export function applyMigrations(db: Database): MigrationResult {
  ensureMigrationsTable(db);
  const from = getSchemaVersion(db);
  const applied: number[] = [];
  const addedColumns: string[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    db.run('BEGIN');
    try {
      migration.up(db, addedColumns);
      db.run(
        'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
        [migration.version, new Date().toISOString(), migration.description],
      );
      db.run('COMMIT');
      applied.push(migration.version);
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  }

  return {
    from,
    to: getSchemaVersion(db),
    applied,
    addedColumns,
  };
}

/**
 * Cria o schema base e aplica as migrações pendentes.
 * Use ao abrir/criar o banco e ao importar um `.sqlite`.
 */
export function initializeSchema(db: Database): MigrationResult {
  db.run(SCHEMA);
  return applyMigrations(db);
}
