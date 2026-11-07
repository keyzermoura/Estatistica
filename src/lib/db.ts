/**
 * Persistência SQLite (sql.js/WASM) + IndexedDB.
 *
 * O banco vive inteiramente no navegador: um arquivo SQLite real é mantido em
 * memória, serializado e gravado em IndexedDB a cada alteração. A exportação
 * gera um `.sqlite` que pode ser aberto por qualquer ferramenta SQLite.
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { get, set, del } from 'idb-keyval';

const STORAGE_KEY = 'validametodo.sqlite.v1';
let SQL: SqlJsStatic | null = null;
let database: Database | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
const listeners = new Set<() => void>();

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS methods (
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
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validations_method ON validations(method_id);
CREATE INDEX IF NOT EXISTS idx_measurements_validation ON measurements(validation_id);
CREATE INDEX IF NOT EXISTS idx_analyses_validation ON analyses(validation_id);
CREATE INDEX IF NOT EXISTS idx_audit_validation ON audit_logs(validation_id);
CREATE INDEX IF NOT EXISTS idx_uncertainty_validation ON uncertainty_items(validation_id);
`;

function ensureMigrations(db: Database) {
  try {
    const cols = db.exec('PRAGMA table_info(measurements)');
    const names = cols[0]?.values.map((row) => String(row[1])) ?? [];
    if (!names.includes('reference_value')) {
      db.run('ALTER TABLE measurements ADD COLUMN reference_value REAL');
    }
  } catch {
    // tabela ainda não existe; o schema cuidará disso
  }
}

export async function initDb(): Promise<Database> {
  if (database) return database;
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
  }
  const persisted = await get<Uint8Array>(STORAGE_KEY);
  if (persisted && persisted.byteLength > 0) {
    try {
      database = new SQL.Database(persisted);
      database.run('PRAGMA foreign_keys = ON');
      ensureMigrations(database);
    } catch (error) {
      console.error('Falha ao abrir banco persistido; criando novo.', error);
      database = new SQL.Database();
    }
  } else {
    database = new SQL.Database();
  }
  database.run(SCHEMA);
  await persist();
  return database;
}

function db(): Database {
  if (!database) throw new Error('Banco não inicializado. Chame initDb() antes.');
  return database;
}

export function markDirty() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist();
  }, 200);
}

export async function persist(): Promise<void> {
  if (!database || !dirty) return;
  try {
    const bytes = database.export();
    await set(STORAGE_KEY, bytes);
    dirty = false;
  } catch (error) {
    console.error('Falha ao persistir o banco em IndexedDB.', error);
  }
}

export async function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persist();
}

export function exportDatabase(): Uint8Array {
  return db().export();
}

export async function importDatabase(bytes: Uint8Array): Promise<void> {
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const next = new SQL.Database(bytes);
  next.run('PRAGMA foreign_keys = ON');
  next.run(SCHEMA);
  ensureMigrations(next);
  database = next;
  dirty = true;
  await persist();
  listeners.forEach((listener) => listener());
}

export async function resetDatabase(): Promise<void> {
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl });
  database = new SQL.Database();
  database.run(SCHEMA);
  await del(STORAGE_KEY);
  dirty = true;
  await persist();
  listeners.forEach((listener) => listener());
}

export function onDatabaseChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function rows<T = Record<string, unknown>>(
  sql: string,
  params: Array<string | number | null | Uint8Array> = [],
): T[] {
  const stmt = db().prepare(sql);
  try {
    stmt.bind(params as never);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    return out;
  } finally {
    stmt.free();
  }
}

export function row<T = Record<string, unknown>>(
  sql: string,
  params: Array<string | number | null | Uint8Array> = [],
): T | null {
  const result = rows<T>(sql, params);
  return result.length ? result[0] : null;
}

export function run(
  sql: string,
  params: Array<string | number | null | Uint8Array> = [],
): void {
  db().run(sql, params as never);
  markDirty();
}

export function transaction<T>(fn: () => T): T {
  const d = db();
  d.run('BEGIN');
  try {
    const result = fn();
    d.run('COMMIT');
    markDirty();
    return result;
  } catch (error) {
    d.run('ROLLBACK');
    throw error;
  }
}

export function lastInsertId(): number {
  const result = row<{ id: number }>('SELECT last_insert_rowid() AS id');
  return result?.id ?? 0;
}
