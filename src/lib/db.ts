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
import { initializeSchema } from './schema';

const STORAGE_KEY = 'validametodo.sqlite.v1';
let SQL: SqlJsStatic | null = null;
let database: Database | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let txDepth = 0;
let lifecycleRegistered = false;
const listeners = new Set<() => void>();

/** Estado observável da gravação do banco local no IndexedDB. */
export type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'error';
let persistenceStatus: PersistenceStatus = 'idle';
const persistenceListeners = new Set<(status: PersistenceStatus) => void>();

function setPersistenceStatus(next: PersistenceStatus): void {
  if (persistenceStatus === next) return;
  persistenceStatus = next;
  for (const listener of persistenceListeners) listener(next);
}

export function getPersistenceStatus(): PersistenceStatus {
  return persistenceStatus;
}

export function onPersistenceStatusChange(
  listener: (status: PersistenceStatus) => void,
): () => void {
  persistenceListeners.add(listener);
  return () => persistenceListeners.delete(listener);
}

function registerLifecycleFlush(): void {
  if (typeof window === 'undefined' || lifecycleRegistered) return;
  lifecycleRegistered = true;
  window.addEventListener('pagehide', () => {
    if (dirty && database) void flush();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && dirty && database) void flush();
    });
  }
}

export function setDatabaseForTests(next: Database | null): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  database = next;
  dirty = false;
  txDepth = 0;
  setPersistenceStatus('idle');
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
      initializeSchema(database);
    } catch (error) {
      // Não substituir o banco persistido por um vazio: uma falha de migração
      // deve ser diagnosticada sem destruir os dados locais. O arquivo
      // original continua intacto no IndexedDB e pode ser exportado.
      console.error('Falha ao abrir/migrar o banco persistido.', error);
      throw error;
    }
  } else {
    database = new SQL.Database();
    initializeSchema(database);
  }
  // Garante que o schema/migrações recém-aplicados sejam gravados mesmo que
  // nenhuma escrita de domínio aconteça nesta sessão.
  dirty = true;
  await persist();
  registerLifecycleFlush();
  return database;
}

function db(): Database {
  if (!database) throw new Error('Banco não inicializado. Chame initDb() antes.');
  return database;
}

export function markDirty() {
  dirty = true;
  setPersistenceStatus('saving');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist();
  }, 200);
}

export async function persist(): Promise<void> {
  if (!database || !dirty) return;
  setPersistenceStatus('saving');
  try {
    const bytes = database.export();
    await set(STORAGE_KEY, bytes);
    dirty = false;
    setPersistenceStatus('saved');
  } catch (error) {
    setPersistenceStatus('error');
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
  initializeSchema(next);
  database = next;
  txDepth = 0;
  dirty = true;
  await persist();
  listeners.forEach((listener) => listener());
}

export async function resetDatabase(): Promise<void> {
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl });
  database = new SQL.Database();
  initializeSchema(database);
  await del(STORAGE_KEY);
  txDepth = 0;
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
  if (txDepth > 0) {
    const sp = `sp_${txDepth + 1}`;
    d.run(`SAVEPOINT ${sp}`);
    txDepth += 1;
    try {
      const result = fn();
      txDepth -= 1;
      d.run(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (error) {
      txDepth -= 1;
      d.run(`ROLLBACK TO SAVEPOINT ${sp}`);
      d.run(`RELEASE SAVEPOINT ${sp}`);
      throw error;
    }
  }
  d.run('BEGIN');
  txDepth = 1;
  try {
    const result = fn();
    txDepth = 0;
    d.run('COMMIT');
    markDirty();
    return result;
  } catch (error) {
    txDepth = 0;
    d.run('ROLLBACK');
    throw error;
  }
}

export function lastInsertId(): number {
  const result = row<{ id: number }>('SELECT last_insert_rowid() AS id');
  return result?.id ?? 0;
}
