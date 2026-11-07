/**
 * Planilhas de coleta (XLSX/CSV) e conversão para o modelo de dados.
 *
 * A importação é orientada por cabeçalho e mantém compatibilidade com
 * planilhas antigas: colunas desconhecidas são ignoradas e as novas colunas
 * assumem valores neutros quando ausentes. A primeira aba é sempre a de
 * medições; uma aba "Método" é exportada como evidência e referência.
 */

import * as XLSX from 'xlsx';
import type {
  DesignRecord,
  Measurement,
  MeasurementCondition,
  Method,
} from './types';

export interface MeasurementWorkbookInput {
  measurements: Measurement[];
  method?: Method;
  design?: DesignRecord | null;
}

export interface ImportedRow {
  runOrder: number;
  level: string;
  analyst: string;
  day: string;
  equipment: string;
  lot: string;
  sample: string;
  partId: string;
  specimen: string;
  destructive: boolean;
  replicate: number;
  value: number | null;
  referenceValue: number | null;
  refValue: number | null;
  refUncertainty: number | null;
  condition: MeasurementCondition | null;
  category: string;
  textValue: string;
  notes: string;
}

/** Linhas de medição com os cabeçalhos em português usados nos exports. */
export function measurementRows(measurements: Measurement[]) {
  return measurements.map((m) => ({
    'Ordem': m.runOrder,
    'Nível': m.level,
    'Analista/Lab': m.analyst,
    'Dia': m.day,
    'Equipamento': m.equipment,
    'Lote': m.lot,
    'Amostra': m.sample,
    'Parte': m.partId ?? '',
    'Corpo de prova': m.specimen ?? '',
    'Destrutivo (0/1)': m.destructive ? 1 : 0,
    'Réplica': m.replicate,
    'Valor': m.value ?? '',
    'Referência': m.referenceValue ?? '',
    'Valor de referência': m.refValue ?? '',
    'Incerteza da referência': m.refUncertainty ?? '',
    'Temperatura': m.condition?.temperature ?? '',
    'Umidade': m.condition?.humidity ?? '',
    'Velocidade de ensaio': m.condition?.testSpeed ?? '',
    'Outras condições': m.condition?.other ?? '',
    'Categoria': m.category ?? '',
    'Texto': m.textValue,
    'Notas': m.notes,
  }));
}

/** Metadados do método exportados na aba "Método". */
export function methodMetadataRows(method: Method) {
  return [
    {
      'Código': method.code,
      'Nome': method.name,
      'Família': method.family,
      'Mensurando': method.measurand,
      'Unidade': method.unit,
      'Unidade da tolerância': method.toleranceUnit,
      'LSL': method.lsl ?? '',
      'USL': method.usl ?? '',
      'Resolução': method.resolution ?? '',
      'Faixa mínima': method.rangeMin ?? '',
      'Faixa máxima': method.rangeMax ?? '',
    },
  ];
}

export function measurementsToCsv(measurements: Measurement[]): string {
  const sheet = XLSX.utils.json_to_sheet(measurementRows(measurements));
  return XLSX.utils.sheet_to_csv(sheet, { FS: ';' });
}

export function buildMeasurementsXlsx(input: MeasurementWorkbookInput): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.json_to_sheet(measurementRows(input.measurements));
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Medições');
  if (input.method) {
    const methodSheet = XLSX.utils.json_to_sheet(methodMetadataRows(input.method));
    XLSX.utils.book_append_sheet(workbook, methodSheet, 'Método');
  }
  const design = input.design;
  if (design) {
    const planSheet = XLSX.utils.json_to_sheet(
      design.plan.runs.map((r) => ({
        'Ordem': r.runOrder,
        'Nível': r.level,
        'Analista': r.analyst,
        'Dia': r.day,
        'Equipamento': r.equipment,
        'Lote': r.lot,
        'Amostra': r.sample,
        'Réplica': r.replicate,
        'Combinação': r.combination,
      })),
    );
    XLSX.utils.book_append_sheet(workbook, planSheet, 'Plano');
    const paramSheet = XLSX.utils.json_to_sheet(
      design.plan.parameterPlans.map((p) => ({
        'Parâmetro': p.key,
        'Método': p.method,
        'n por grupo': p.nPerGroup ?? '',
        'Grupos': p.groups ?? '',
        'Total': p.total,
        'Poder': p.achievedPower ?? '',
        'Fórmula': p.formula,
        'Referência': p.reference,
      })),
    );
    XLSX.utils.book_append_sheet(workbook, paramSheet, 'Tamanho de amostra');
  }
  return new Uint8Array(
    XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
  );
}

export function buildDesignTemplateXlsx(
  input: Pick<MeasurementWorkbookInput, 'method' | 'design'>,
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const rows =
    input.design?.plan.runs.map((r) => ({
      'Ordem': r.runOrder,
      'Nível': r.level,
      'Analista/Lab': r.analyst,
      'Dia': r.day,
      'Equipamento': r.equipment,
      'Lote': r.lot,
      'Amostra': r.sample,
      'Parte': '',
      'Corpo de prova': '',
      'Destrutivo (0/1)': '',
      'Réplica': r.replicate,
      'Valor': '',
      'Referência': '',
      'Valor de referência': '',
      'Incerteza da referência': '',
      'Temperatura': '',
      'Umidade': '',
      'Velocidade de ensaio': '',
      'Outras condições': '',
      'Categoria': '',
      'Texto': '',
      'Notas': '',
    })) ??
    Array.from({ length: 20 }, (_, i) => ({
      'Ordem': i + 1,
      'Nível': '',
      'Analista/Lab': '',
      'Dia': '',
      'Equipamento': '',
      'Lote': '',
      'Amostra': '',
      'Parte': '',
      'Corpo de prova': '',
      'Destrutivo (0/1)': '',
      'Réplica': '',
      'Valor': '',
      'Referência': '',
      'Valor de referência': '',
      'Incerteza da referência': '',
      'Temperatura': '',
      'Umidade': '',
      'Velocidade de ensaio': '',
      'Outras condições': '',
      'Categoria': '',
      'Texto': '',
      'Notas': '',
    }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Coleta');
  if (input.method) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(methodMetadataRows(input.method)),
      'Método',
    );
  }
  return new Uint8Array(
    XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
  );
}

const normalizeHeader = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const HEADER_ALIASES: Record<string, string[]> = {
  runOrder: ['ordem', 'ordemexecucao', 'run', 'runorder', 'sequencia'],
  level: ['nivel', 'nivelconcentracao', 'concentracao', 'level', 'concentration'],
  analyst: ['analista', 'analistalab', 'laboratorio', 'lab', 'analyst'],
  day: ['dia', 'day', 'data'],
  equipment: ['equipamento', 'equipment', 'instrumento'],
  lot: ['lote', 'lot', 'batch'],
  sample: ['amostra', 'sample', 'id'],
  partId: ['parte', 'partid', 'peca', 'idpeca', 'identificacaopeca'],
  specimen: ['corpodeprova', 'specimen', 'especime', 'provete', 'exemplar'],
  destructive: ['destrutivo', 'destrutivo01', 'destructive', 'ensaiodestrutivo'],
  replicate: ['replica', 'replicate', 'rep'],
  value: ['valor', 'resultado', 'value', 'resposta', 'response', 'medicao'],
  referenceValue: ['referencia', 'reference', 'valoreferencia', 'nominal', 'fortificado'],
  refValue: [
    'valordereferencia',
    'valordereferenciapadrao',
    'referenciadopadrao',
    'refvalue',
    'valordopadrao',
    'valorpadrao',
  ],
  refUncertainty: [
    'incertezadareferencia',
    'incertezadopadrao',
    'refuncertainty',
    'uref',
    'ureferencia',
  ],
  temperature: ['temperatura', 'temperature', 'temp'],
  humidity: ['umidade', 'humidity', 'ur'],
  testSpeed: ['velocidadedeensaio', 'velocidade', 'testspeed', 'velocidadeensaio'],
  otherCondition: ['outrascondicoes', 'outras', 'otherconditions', 'condicoesadicionais'],
  category: ['categoria', 'category', 'classificacao', 'resultadocategorico'],
  textValue: ['texto', 'textvalue', 'resultadotexto', 'qualitativo'],
  notes: ['notas', 'notes', 'observacoes', 'observacao'],
};

function mapImportRow(raw: Record<string, unknown>, index: number): ImportedRow {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(raw)) {
    normalized.set(normalizeHeader(key), value);
  }
  const pick = (field: keyof typeof HEADER_ALIASES): unknown => {
    for (const alias of HEADER_ALIASES[field]) {
      if (normalized.has(alias)) return normalized.get(alias);
    }
    return undefined;
  };
  const numeric = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const parsed = Number(String(v).trim().replace(',', '.').replace(/[^\d.+-eE]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
  const booleanish = (v: unknown): boolean => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1;
    const value = text(v).toLowerCase();
    return ['1', 'sim', 's', 'true', 'verdadeiro', 'yes', 'y', 'x'].includes(value);
  };
  const explicitOrder = numeric(pick('runOrder'));
  const temperature = numeric(pick('temperature'));
  const humidity = numeric(pick('humidity'));
  const testSpeed = numeric(pick('testSpeed'));
  const otherCondition = text(pick('otherCondition'));
  const hasCondition =
    temperature !== null ||
    humidity !== null ||
    testSpeed !== null ||
    otherCondition !== '';
  return {
    runOrder: explicitOrder ?? index + 1,
    level: text(pick('level')),
    analyst: text(pick('analyst')),
    day: text(pick('day')),
    equipment: text(pick('equipment')),
    lot: text(pick('lot')),
    sample: text(pick('sample')),
    partId: text(pick('partId')),
    specimen: text(pick('specimen')),
    destructive: booleanish(pick('destructive')),
    replicate: numeric(pick('replicate')) ?? 1,
    value: numeric(pick('value')),
    referenceValue: numeric(pick('referenceValue')),
    refValue: numeric(pick('refValue')),
    refUncertainty: numeric(pick('refUncertainty')),
    condition: hasCondition ? { temperature, humidity, testSpeed, other: otherCondition } : null,
    category: text(pick('category')),
    textValue: text(pick('textValue')),
    notes: text(pick('notes')),
  };
}

/** Lê a primeira aba (Medições/Coleta) de um XLSX, XLS ou CSV. */
export function parseSpreadsheetBuffer(buffer: ArrayBuffer | Uint8Array): ImportedRow[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  // CSV é texto: decodificar explicitamente como UTF-8 preserva acentos.
  const workbook =
    isZip || isOle
      ? XLSX.read(bytes, { type: 'array' })
      : XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('A planilha não possui abas.');
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: '',
  });
  return raw
    .map(mapImportRow)
    .filter((r) => r.value !== null || r.textValue !== '' || r.category !== '');
}

export function importedToMeasurements(
  imported: ImportedRow[],
  validationId: string,
): Measurement[] {
  let id = 0;
  return imported.map((row) => {
    id += 1;
    return {
      id: `imp_${Date.now().toString(36)}_${id}`,
      validationId,
      ...row,
    };
  });
}
