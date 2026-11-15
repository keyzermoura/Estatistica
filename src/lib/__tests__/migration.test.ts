import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import {
  applyMigrations,
  getSchemaVersion,
  initializeSchema,
  LATEST_SCHEMA_VERSION,
  tableColumns,
} from '../schema';

/**
 * Migração a partir de um `.sqlite` real da versão anterior (schema v1).
 *
 * O fixture `fixtures/schema-v1.sqlite` foi gerado com `fixtures/schema-v1.sql`
 * (sqlite3/Python) e contém métodos, validações, versões, relatório, auditoria
 * e medições. O teste compara os dados antigos coluna a coluna antes/depois.
 */

const METHOD_V1_COLUMNS = [
  'id',
  'code',
  'name',
  'type',
  'unit',
  'range_min',
  'range_max',
  'equipment',
  'reference_norm',
  'validation_type',
  'description',
  'criteria_json',
  'created_at',
  'updated_at',
];

const MEASUREMENT_V1_COLUMNS = [
  'id',
  'validation_id',
  'run_order',
  'level',
  'analyst',
  'day',
  'equipment',
  'lot',
  'sample',
  'replicate',
  'value',
  'reference_value',
  'text_value',
  'notes',
];

const AUDIT_LOG_V1_COLUMNS = [
  'id',
  'validation_id',
  'entity',
  'action',
  'actor',
  'before_json',
  'after_json',
  'reason',
  'timestamp',
];

const LEGACY_TABLES = [
  'validations',
  'validation_parameters',
  'designs',
  'analyses',
  'uncertainty_items',
  'reports',
  'validation_versions',
  'settings',
];

function query(db: Database, sql: string): Array<Record<string, unknown>> {
  const result = db.exec(sql);
  if (!result[0]) return [];
  const { columns, values } = result[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  );
}

function snapshotLegacy(db: Database) {
  const snapshot: Record<string, Array<Record<string, unknown>>> = {
    methods: query(
      db,
      `SELECT ${METHOD_V1_COLUMNS.join(', ')} FROM methods ORDER BY id`,
    ),
    measurements: query(
      db,
      `SELECT ${MEASUREMENT_V1_COLUMNS.join(', ')} FROM measurements ORDER BY id`,
    ),
    audit_logs: query(
      db,
      `SELECT ${AUDIT_LOG_V1_COLUMNS.join(', ')} FROM audit_logs ORDER BY rowid`,
    ),
  };
  for (const table of LEGACY_TABLES) {
    snapshot[table] = query(db, `SELECT * FROM ${table} ORDER BY rowid`);
  }
  return snapshot;
}

async function openFixture(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      resolve(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const bytes = readFileSync(
    resolve(process.cwd(), 'src/lib/__tests__/fixtures/schema-v1.sqlite'),
  );
  return new SQL.Database(new Uint8Array(bytes));
}

describe('migração versionada do banco', () => {
  it('abre um .sqlite da versão anterior preservando todos os dados', async () => {
    const db = await openFixture();
    const before = snapshotLegacy(db);

    expect(getSchemaVersion(db)).toBe(0);
    const result = initializeSchema(db);

    expect(result.from).toBe(0);
    expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    expect(result.applied).toEqual([1, 2, 3]);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    const after = snapshotLegacy(db);
    expect(after).toEqual(before);
    expect(before.methods).toHaveLength(2);
    expect(before.measurements).toHaveLength(4);
    expect(before.validation_versions).toHaveLength(2);
    expect(before.audit_logs).toHaveLength(2);

    // Família padrão dos métodos existentes e colunas novas disponíveis.
    const methods = query(
      db,
      'SELECT id, family, lsl, usl, resolution, measurand, tolerance_unit FROM methods ORDER BY id',
    );
    expect(methods).toEqual([
      {
        id: 'method_old_a',
        family: 'analytical',
        lsl: null,
        usl: null,
        resolution: null,
        measurand: '',
        tolerance_unit: '',
      },
      {
        id: 'method_old_b',
        family: 'analytical',
        lsl: null,
        usl: null,
        resolution: null,
        measurand: '',
        tolerance_unit: '',
      },
    ]);

    // Campos de medição antigos permanecem e os novos têm defaults seguros.
    const measurements = query(
      db,
      `SELECT id, value, reference_value, part_id, specimen, destructive,
              condition_json, ref_value, ref_uncertainty, category
         FROM measurements ORDER BY id`,
    );
    expect(measurements[0]).toMatchObject({
      id: 'm_old_1',
      value: 1.02,
      reference_value: 1,
      part_id: null,
      specimen: null,
      destructive: 0,
      condition_json: null,
      ref_value: null,
      ref_uncertainty: null,
      category: null,
    });

    expect(tableColumns(db, 'methods')).toEqual(
      expect.arrayContaining([
        'family',
        'lsl',
        'usl',
        'resolution',
        'measurand',
        'tolerance_unit',
      ]),
    );
    expect(tableColumns(db, 'measurements')).toEqual(
      expect.arrayContaining([
        'part_id',
        'specimen',
        'destructive',
        'condition_json',
        'ref_value',
        'ref_uncertainty',
        'category',
      ]),
    );

    // As colunas novas aceitam nulo (não são NOT NULL).
    const measurementInfo = query(db, 'PRAGMA table_info(measurements)');
    for (const column of [
      'part_id',
      'specimen',
      'destructive',
      'condition_json',
      'ref_value',
      'ref_uncertainty',
      'category',
    ]) {
      const info = measurementInfo.find((row) => row.name === column);
      expect(info?.notnull, `${column} deve aceitar nulo`).toBe(0);
    }

    const auditInfo = query(db, 'PRAGMA table_info(audit_logs)');
    for (const column of ['previous_hash', 'current_hash']) {
      const info = auditInfo.find((row) => row.name === column);
      expect(info?.notnull, `${column} deve aceitar nulo`).toBe(0);
    }

    // Um banco migrado continua aceitando inserts no formato antigo, com
    // defaults/null para as colunas novas.
    db.run(
      `INSERT INTO methods (id, code, name, type, created_at, updated_at)
       VALUES ('method_new', 'NOVO-1', 'Método novo', 'quantitative', '2026-01-01', '2026-01-01')`,
    );
    const insertedMethod = query(
      db,
      "SELECT family, lsl, usl, resolution, measurand, tolerance_unit FROM methods WHERE id = 'method_new'",
    )[0];
    expect(insertedMethod).toEqual({
      family: 'analytical',
      lsl: null,
      usl: null,
      resolution: null,
      measurand: '',
      tolerance_unit: '',
    });

    db.run(
      `INSERT INTO measurements (id, validation_id, value) VALUES ('m_new', 'val_old_b', 10.5)`,
    );
    const insertedMeasurement = query(
      db,
      `SELECT destructive, part_id, specimen, condition_json, ref_value,
              ref_uncertainty, category
         FROM measurements WHERE id = 'm_new'`,
    )[0];
    expect(insertedMeasurement).toEqual({
      destructive: 0,
      part_id: null,
      specimen: null,
      condition_json: null,
      ref_value: null,
      ref_uncertainty: null,
      category: null,
    });

    db.close();
  });

  it('é idempotente em execuções repetidas', async () => {
    const db = await openFixture();
    const first = initializeSchema(db);
    expect(first.applied).toEqual([1, 2, 3]);

    const second = applyMigrations(db);
    expect(second).toEqual({
      from: LATEST_SCHEMA_VERSION,
      to: LATEST_SCHEMA_VERSION,
      applied: [],
      addedColumns: [],
    });

    const versions = query(
      db,
      'SELECT version, description FROM schema_migrations ORDER BY version',
    );
    expect(versions).toHaveLength(3);
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    db.close();
  });
});
