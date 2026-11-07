import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { Method, Measurement } from '../types';
import {
  buildMeasurementsXlsx,
  importedToMeasurements,
  measurementsToCsv,
  parseSpreadsheetBuffer,
  type ImportedRow,
} from '../spreadsheet';

const METHOD: Method = {
  id: 'method_dim',
  code: 'DIM-001',
  name: 'Diâmetro externo',
  type: 'dimensional',
  family: 'dimensional',
  unit: 'mm',
  rangeMin: 9.9,
  rangeMax: 10.2,
  lsl: 9.9,
  usl: 10.1,
  resolution: 0.01,
  measurand: 'Diâmetro externo',
  toleranceUnit: 'mm',
  equipment: 'Micrômetro 0–25 mm',
  referenceNorm: 'ISO 13385-1',
  validationType: 'full',
  description: 'Ensaio dimensional de demonstração.',
  criteria: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const MEASUREMENTS: Measurement[] = [
  {
    id: 'm1',
    validationId: 'val_roundtrip',
    runOrder: 1,
    level: '10',
    analyst: 'Ana',
    day: 'D1',
    equipment: 'MIC-1',
    lot: 'L1',
    sample: 'S1',
    partId: 'P-001',
    specimen: 'CP-001',
    destructive: true,
    condition: {
      temperature: 23.4,
      humidity: 48,
      testSpeed: 2.5,
      other: 'Sem vibração',
    },
    refValue: 10.0,
    refUncertainty: 0.002,
    category: 'conforme',
    replicate: 1,
    value: 10.02,
    referenceValue: 10.0,
    textValue: 'aprovado',
    notes: 'Medição de referência',
  },
  {
    id: 'm2',
    validationId: 'val_roundtrip',
    runOrder: 2,
    level: '10',
    analyst: 'Bruno',
    day: 'D2',
    equipment: 'MIC-2',
    lot: 'L1',
    sample: 'S2',
    partId: 'P-002',
    specimen: 'CP-002',
    destructive: false,
    condition: null,
    refValue: null,
    refUncertainty: null,
    category: '',
    replicate: 2,
    value: 9.98,
    referenceValue: 10.0,
    textValue: '',
    notes: '',
  },
];

function core(m: Measurement | ImportedRow) {
  return {
    runOrder: m.runOrder,
    level: m.level,
    analyst: m.analyst,
    day: m.day,
    equipment: m.equipment,
    lot: m.lot,
    sample: m.sample,
    partId: m.partId ?? '',
    specimen: m.specimen ?? '',
    destructive: m.destructive === true,
    replicate: m.replicate,
    value: m.value,
    referenceValue: m.referenceValue ?? null,
    refValue: m.refValue ?? null,
    refUncertainty: m.refUncertainty ?? null,
    condition: m.condition ?? null,
    category: m.category ?? '',
    textValue: m.textValue,
    notes: m.notes,
  };
}

describe('exportação e importação de planilhas', () => {
  it('faz round-trip XLSX de todas as colunas novas de medição', () => {
    const bytes = buildMeasurementsXlsx({ method: METHOD, measurements: MEASUREMENTS });
    const imported = parseSpreadsheetBuffer(bytes);

    expect(imported).toHaveLength(2);
    expect(imported.map(core)).toEqual(MEASUREMENTS.map(core));

    const converted = importedToMeasurements(imported, 'val_roundtrip');
    expect(converted.map(({ id: _id, validationId: _validationId, ...rest }) => rest)).toEqual(
      MEASUREMENTS.map(({ id: _id, validationId: _validationId, ...rest }) => rest),
    );

    // A aba "Método" leva os novos campos do cadastro como evidência.
    const workbook = XLSX.read(bytes, { type: 'array' });
    expect(workbook.SheetNames).toContain('Método');
    const methodRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets['Método'],
    );
    expect(methodRows[0]).toMatchObject({
      'Código': 'DIM-001',
      'Família': 'dimensional',
      'LSL': 9.9,
      'USL': 10.1,
      'Resolução': 0.01,
      'Mensurando': 'Diâmetro externo',
      'Unidade da tolerância': 'mm',
    });
  });

  it('faz round-trip CSV preservando acentos e campos novos', () => {
    const csv = measurementsToCsv(MEASUREMENTS);
    const bytes = new TextEncoder().encode(`\ufeff${csv}`);
    const imported = parseSpreadsheetBuffer(bytes);

    expect(imported.map(core)).toEqual(MEASUREMENTS.map(core));
  });

  it('importa planilhas antigas sem as colunas novas', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      {
        'Ordem': 1,
        'Nível': '5',
        'Analista': 'Ana',
        'Dia': 'D1',
        'Equipamento': 'HPLC',
        'Lote': 'L1',
        'Amostra': 'S1',
        'Réplica': 1,
        'Valor': 5.01,
        'Referência': 5,
        'Texto': '',
        'Notas': 'planilha antiga',
      },
      {
        // Linha de atributo: categoria é resultado, mesmo sem valor/texto.
        'Ordem': 2,
        'Categoria': 'aprovado',
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Coleta');
    const bytes = new Uint8Array(
      XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );
    const imported = parseSpreadsheetBuffer(bytes);

    expect(imported).toHaveLength(2);
    expect(imported[0]).toMatchObject({
      runOrder: 1,
      level: '5',
      analyst: 'Ana',
      value: 5.01,
      referenceValue: 5,
      partId: '',
      specimen: '',
      destructive: false,
      condition: null,
      refValue: null,
      refUncertainty: null,
      category: '',
      notes: 'planilha antiga',
    });
    expect(imported[1]).toMatchObject({
      runOrder: 2,
      value: null,
      textValue: '',
      category: 'aprovado',
    });
  });
});
