/**
 * Exportações: XLSX/CSV, DOCX, PDF, pacote ZIP de evidências e banco SQLite.
 */

import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type {
  Measurement,
  ReportRecord,
  ValidationBundle,
} from './types';
import type { ValidationAnalysis } from '../stats/analysis';
import { fmt } from '../stats/distributions';
import { exportSqlite } from './repository';
import { downloadBlob, downloadText, downloadBytes, sha256, slugify } from './utils';
import { VERDICT_LABELS } from './report';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_PDF = 'application/pdf';

function baseName(bundle: ValidationBundle): string {
  return `${slugify(bundle.method.code || 'metodo')}-v${bundle.validation.version}`;
}

function measurementRows(bundle: ValidationBundle) {
  return bundle.measurements.map((m) => ({
    'Ordem': m.runOrder,
    'Nível': m.level,
    'Analista/Lab': m.analyst,
    'Dia': m.day,
    'Equipamento': m.equipment,
    'Lote': m.lot,
    'Amostra': m.sample,
    'Réplica': m.replicate,
    'Valor': m.value ?? '',
    'Referência': m.referenceValue ?? '',
    'Texto': m.textValue,
    'Notas': m.notes,
  }));
}

export function measurementsToCsv(bundle: ValidationBundle): string {
  const sheet = XLSX.utils.json_to_sheet(measurementRows(bundle));
  return XLSX.utils.sheet_to_csv(sheet, { FS: ';' });
}

export function downloadMeasurementsCsv(bundle: ValidationBundle) {
  downloadText(
    `\ufeff${measurementsToCsv(bundle)}`,
    `${baseName(bundle)}-dados.csv`,
    'text/csv;charset=utf-8',
  );
}

export function downloadMeasurementsXlsx(bundle: ValidationBundle) {
  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.json_to_sheet(measurementRows(bundle));
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Medições');
  const design = bundle.design;
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
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  downloadBytes(new Uint8Array(bytes), `${baseName(bundle)}-dados.xlsx`, MIME_XLSX);
}

export function downloadDesignTemplate(bundle: ValidationBundle) {
  const workbook = XLSX.utils.book_new();
  const rows =
    bundle.design?.plan.runs.map((r) => ({
      'Ordem': r.runOrder,
      'Nível': r.level,
      'Analista/Lab': r.analyst,
      'Dia': r.day,
      'Equipamento': r.equipment,
      'Lote': r.lot,
      'Amostra': r.sample,
      'Réplica': r.replicate,
      'Valor': '',
      'Referência': '',
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
      'Réplica': '',
      'Valor': '',
      'Referência': '',
      'Notas': '',
    }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Coleta');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  downloadBytes(
    new Uint8Array(bytes),
    `${baseName(bundle)}-modelo-coleta.xlsx`,
    MIME_XLSX,
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
  analyst: ['analista', 'laboratorio', 'lab', 'analyst'],
  day: ['dia', 'day', 'data'],
  equipment: ['equipamento', 'equipment', 'instrumento'],
  lot: ['lote', 'lot', 'batch'],
  sample: ['amostra', 'sample', 'id'],
  replicate: ['replica', 'replicate', 'rep'],
  value: ['valor', 'resultado', 'value', 'resposta', 'response', 'medicao'],
  referenceValue: ['referencia', 'reference', 'valoreferencia', 'nominal', 'fortificado'],
  textValue: ['texto', 'textvalue', 'resultadotexto', 'qualitativo'],
  notes: ['notas', 'notes', 'observacoes', 'observacao'],
};

export interface ImportedRow {
  runOrder: number;
  level: string;
  analyst: string;
  day: string;
  equipment: string;
  lot: string;
  sample: string;
  replicate: number;
  value: number | null;
  referenceValue: number | null;
  textValue: string;
  notes: string;
}

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
  const explicitOrder = numeric(pick('runOrder'));
  return {
    runOrder: explicitOrder ?? index + 1,
    level: text(pick('level')),
    analyst: text(pick('analyst')),
    day: text(pick('day')),
    equipment: text(pick('equipment')),
    lot: text(pick('lot')),
    sample: text(pick('sample')),
    replicate: numeric(pick('replicate')) ?? 1,
    value: numeric(pick('value')),
    referenceValue: numeric(pick('referenceValue')),
    textValue: text(pick('textValue')),
    notes: text(pick('notes')),
  };
}

export async function parseSpreadsheet(file: File): Promise<ImportedRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('A planilha não possui abas.');
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: '',
  });
  return raw.map(mapImportRow).filter((r) => r.value !== null || r.textValue);
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
      textValue: row.textValue,
    };
  });
}

// ── DOCX ───────────────────────────────────────────────────────────────────

function heading(text: string, level: 1 | 2 = 1): Paragraph {
  return new Paragraph({
    text,
    heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
  });
}

function para(text: string, opts: { bold?: boolean; size?: number; italics?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italics,
        size: opts.size ?? 22,
        font: 'Calibri',
      }),
    ],
    spacing: { after: 100 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } });
}

function table(headers: string[], rows: string[][], widths?: number[]): Table {
  const border = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map(
          (h, i) =>
            new TableCell({
              children: [para(h, { bold: true, size: 18 })],
              shading: { fill: 'F0FDFA' },
              borders: border,
              width: widths ? { size: widths[i], type: WidthType.PERCENTAGE } : undefined,
            }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell, i) =>
                new TableCell({
                  children: [para(cell, { size: 18 })],
                  borders: border,
                  width: widths ? { size: widths[i], type: WidthType.PERCENTAGE } : undefined,
                }),
            ),
          }),
      ),
    ],
  });
}

function dataUrlToUint8(dataUrl: string): { bytes: Uint8Array; type: 'png' | 'jpg' } | null {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, type: match[1].toLowerCase().startsWith('jpg') ? 'jpg' : 'png' };
}

export async function buildReportDocx(
  bundle: ValidationBundle,
  analysis: ValidationAnalysis,
  report: ReportRecord,
): Promise<Uint8Array> {
  const content = report.content;
  const children: Array<Paragraph | Table> = [];
  const logo = content.laboratory.logoDataUrl ? dataUrlToUint8(content.laboratory.logoDataUrl) : null;
  if (logo) {
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: logo.bytes,
            transformation: { width: 110, height: 60 },
            type: logo.type,
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    );
  }
  children.push(
    new Paragraph({
      children: [new TextRun({ text: content.laboratory.name || 'Laboratório', bold: true, size: 22 })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: content.laboratory.address, size: 18, color: '475569' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
    }),
    new Paragraph({
      children: [new TextRun({ text: content.title, bold: true, size: 34, color: '0F766E' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: content.subtitle, size: 22, italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
  );
  if (content.laboratory.accreditation) {
    children.push(para(content.laboratory.accreditation, { italics: true, size: 18 }));
  }
  children.push(
    heading('1. Identificação'),
    table(
      ['Campo', 'Informação'],
      [
        ['Método', `${content.method.name} (${content.method.code})`],
        ['Tipo', content.method.type],
        ['Unidade', content.method.unit],
        ['Faixa', content.method.range],
        ['Equipamento', content.method.equipment],
        ['Norma de referência', content.method.referenceNorm],
        ['Tipo de validação', content.method.validationType],
        ['Versão do relatório', content.version],
        ['Gerado em', new Date(content.generatedAt).toLocaleString('pt-BR')],
        ['Hash de auditoria', content.auditHash.slice(0, 32)],
      ],
      [28, 72],
    ),
    heading('2. Objetivo'),
    para(content.objective || '—'),
    heading('3. Escopo'),
    para(content.scope || '—'),
    heading('4. Delineamento amostral'),
    para(content.designSummary),
    para(content.dataSummary),
    heading('5. Resultados por parâmetro'),
  );
  for (const parameter of content.parameterResults) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: parameter.label, bold: true, size: 24, color: '0F766E' }),
          new TextRun({ text: `  — ${VERDICT_LABELS[parameter.verdict]}`, bold: true, size: 20 }),
        ],
        spacing: { before: 180, after: 80 },
      }),
      para(parameter.summary),
    );
    if (parameter.metrics.length) {
      children.push(
        table(
          ['Métrica', 'Valor', 'Critério', 'Veredito'],
          parameter.metrics.map((m) => [
            m.label,
            m.value,
            m.criterion,
            VERDICT_LABELS[m.verdict],
          ]),
          [33, 20, 27, 20],
        ),
      );
    }
    if (parameter.notes.length) {
      children.push(para('Observações:', { bold: true, size: 20 }));
      for (const note of parameter.notes) children.push(bullet(note));
    }
  }
  if (content.uncertainty) {
    children.push(heading('6. Incerteza de medição (GUM)'));
    children.push(para(content.uncertainty.summary));
    children.push(
      table(
        ['Fonte', 'Tipo', 'Valor', 'Divisor', 'c_i', 'u_i', 'ν'],
        content.uncertainty.items.map((i) => [
          i.source,
          i.type,
          fmt(i.value),
          fmt(i.divisor),
          fmt(i.sensitivity),
          fmt(i.stdUncertainty),
          i.dof === null ? '—' : fmt(i.dof),
        ]),
        [34, 8, 14, 10, 10, 14, 10],
      ),
    );
  }
  children.push(
    heading('7. Conclusão'),
    para(content.conclusion),
    heading('8. Limitações e pressupostos'),
  );
  for (const limitation of content.limitations) children.push(bullet(limitation));
  for (const assumption of content.assumptions) children.push(bullet(assumption));
  children.push(heading('9. Referências'));
  for (const reference of content.references) children.push(bullet(reference));
  children.push(heading('10. Assinaturas'));
  children.push(
    table(
      ['Papel', 'Nome', 'Data', 'Assinatura'],
      content.signatures.map((s) => [
        s.role === 'elaboration' ? 'Elaboração' : s.role === 'review' ? 'Revisão' : 'Aprovação',
        s.name || '—',
        s.date ? new Date(s.date).toLocaleString('pt-BR') : '—',
        s.signed ? 'Assinado eletronicamente' : '_______________________',
      ]),
      [22, 30, 24, 24],
    ),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: content.laboratory.name
            ? `Documento gerado por ValidaMétodo — ${content.laboratory.name}`
            : 'Documento gerado por ValidaMétodo',
          size: 16,
          color: '64748B',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 300 },
    }),
  );
  const doc = new Document({
    creator: 'ValidaMétodo',
    title: content.title,
    description: content.subtitle,
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${content.laboratory.name || 'Laboratório'} · ${content.method.code}`,
                    size: 16,
                    color: '64748B',
                  }),
                ],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: 'Página ', size: 16, color: '64748B' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '64748B' }),
                  new TextRun({ text: ' de ', size: 16, color: '64748B' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '64748B' }),
                  new TextRun({
                    text: ` · hash ${content.auditHash.slice(0, 12)}`,
                    size: 16,
                    color: '64748B',
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

export function downloadReportDocx(bytes: Uint8Array, bundle: ValidationBundle) {
  downloadBytes(bytes, `${baseName(bundle)}-relatorio.docx`, MIME_DOCX);
}

// ── PDF ────────────────────────────────────────────────────────────────────

interface PdfContext {
  doc: jsPDF;
  y: number;
  margin: number;
  width: number;
  pageHeight: number;
}

function pdfEnsure(ctx: PdfContext, height: number) {
  if (ctx.y + height > ctx.pageHeight - 22) {
    ctx.doc.addPage();
    ctx.y = ctx.margin;
  }
}

function pdfHeading(ctx: PdfContext, text: string, size = 13) {
  pdfEnsure(ctx, 14);
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(size);
  ctx.doc.setTextColor(15, 118, 110);
  ctx.doc.text(text, ctx.margin, ctx.y);
  ctx.y += size * 0.5 + 4;
  ctx.doc.setTextColor(30, 41, 59);
}

function pdfText(ctx: PdfContext, text: string, size = 9.5, bold = false) {
  ctx.doc.setFont('helvetica', bold ? 'bold' : 'normal');
  ctx.doc.setFontSize(size);
  const lines = ctx.doc.splitTextToSize(text || '—', ctx.width);
  for (const line of lines) {
    pdfEnsure(ctx, 5);
    ctx.doc.text(line, ctx.margin, ctx.y);
    ctx.y += size * 0.45 + 1.5;
  }
  ctx.y += 2;
}

function pdfTable(
  ctx: PdfContext,
  headers: string[],
  rows: string[][],
  widths: number[],
) {
  const total = widths.reduce((a, b) => a + b, 0);
  const colWidths = widths.map((w) => (w / total) * ctx.width);
  const drawRow = (cells: string[], header: boolean) => {
    const size = 7.8;
    ctx.doc.setFont('helvetica', header ? 'bold' : 'normal');
    ctx.doc.setFontSize(size);
    const wrapped = cells.map((cell, i) =>
      ctx.doc.splitTextToSize(String(cell ?? '—'), colWidths[i] - 3),
    );
    const height = Math.max(...wrapped.map((lines) => lines.length)) * size * 0.45 + 4;
    pdfEnsure(ctx, height + 2);
    if (header) {
      ctx.doc.setFillColor(240, 253, 250);
      ctx.doc.rect(ctx.margin, ctx.y - 3, ctx.width, height, 'F');
    }
    let x = ctx.margin;
    wrapped.forEach((lines, i) => {
      lines.forEach((line: string, lineIndex: number) => {
        ctx.doc.text(line, x + 1.5, ctx.y + lineIndex * size * 0.45);
      });
      x += colWidths[i];
    });
    ctx.doc.setDrawColor(203, 213, 225);
    ctx.doc.line(ctx.margin, ctx.y + height - 3, ctx.margin + ctx.width, ctx.y + height - 3);
    ctx.y += height;
  };
  drawRow(headers, true);
  rows.forEach((row) => drawRow(row, false));
  ctx.y += 3;
}

export async function buildReportPdf(
  bundle: ValidationBundle,
  analysis: ValidationAnalysis,
  report: ReportRecord,
): Promise<Uint8Array> {
  const content = report.content;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ctx: PdfContext = {
    doc,
    y: 18,
    margin: 18,
    width: 174,
    pageHeight: 297,
  };
  const logo = content.laboratory.logoDataUrl;
  if (logo && /^data:image\/(png|jpe?g)/i.test(logo)) {
    try {
      const format = logo.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(logo, format, 18, 12, 24, 14);
      ctx.y = 30;
    } catch {
      ctx.y = 18;
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 118, 110);
  doc.text(content.title, 105, ctx.y, { align: 'center', maxWidth: 170 });
  ctx.y += 9;
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(content.subtitle, 105, ctx.y, { align: 'center', maxWidth: 170 });
  ctx.y += 8;
  doc.setFontSize(8);
  doc.text(
    `${content.laboratory.name || 'Laboratório'} · ${content.laboratory.address || ''}`,
    105,
    ctx.y,
    { align: 'center' },
  );
  ctx.y += 6;
  doc.setTextColor(30, 41, 59);

  pdfHeading(ctx, '1. Identificação');
  pdfTable(
    ctx,
    ['Campo', 'Informação'],
    [
      ['Método', `${content.method.name} (${content.method.code})`],
      ['Tipo / unidade', `${content.method.type} · ${content.method.unit}`],
      ['Faixa', content.method.range],
      ['Equipamento', content.method.equipment],
      ['Norma de referência', content.method.referenceNorm],
      ['Versão', content.version],
      ['Gerado em', new Date(content.generatedAt).toLocaleString('pt-BR')],
      ['Hash de auditoria', content.auditHash],
    ],
    [30, 70],
  );
  pdfHeading(ctx, '2. Objetivo');
  pdfText(ctx, content.objective);
  pdfHeading(ctx, '3. Escopo');
  pdfText(ctx, content.scope);
  pdfHeading(ctx, '4. Delineamento amostral');
  pdfText(ctx, content.designSummary);
  pdfText(ctx, content.dataSummary);
  pdfHeading(ctx, '5. Resultados por parâmetro');
  for (const parameter of content.parameterResults) {
    pdfEnsure(ctx, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 118, 110);
    doc.text(`${parameter.label} — ${VERDICT_LABELS[parameter.verdict]}`, ctx.margin, ctx.y);
    ctx.y += 5;
    doc.setTextColor(30, 41, 59);
    pdfText(ctx, parameter.summary);
    if (parameter.metrics.length) {
      pdfTable(
        ctx,
        ['Métrica', 'Valor', 'Critério', 'Veredito'],
        parameter.metrics.map((m) => [
          m.label,
          m.value,
          m.criterion,
          VERDICT_LABELS[m.verdict],
        ]),
        [35, 20, 28, 17],
      );
    }
    for (const note of parameter.notes) pdfText(ctx, `• ${note}`, 8.5);
  }
  if (content.uncertainty) {
    pdfHeading(ctx, '6. Incerteza de medição (GUM)');
    pdfText(ctx, content.uncertainty.summary);
    pdfTable(
      ctx,
      ['Fonte', 'Tipo', 'Valor', 'Divisor', 'c_i', 'u_i', 'ν'],
      content.uncertainty.items.map((i) => [
        i.source,
        i.type,
        fmt(i.value),
        fmt(i.divisor),
        fmt(i.sensitivity),
        fmt(i.stdUncertainty),
        i.dof === null ? '—' : fmt(i.dof),
      ]),
      [36, 7, 14, 9, 9, 14, 8],
    );
  }
  pdfHeading(ctx, '7. Conclusão');
  pdfText(ctx, content.conclusion);
  pdfHeading(ctx, '8. Limitações e pressupostos');
  for (const limitation of content.limitations) pdfText(ctx, `• ${limitation}`, 8.5);
  for (const assumption of content.assumptions) pdfText(ctx, `• ${assumption}`, 8.5);
  pdfHeading(ctx, '9. Referências');
  for (const reference of content.references) pdfText(ctx, `• ${reference}`, 8.5);
  pdfHeading(ctx, '10. Assinaturas');
  pdfTable(
    ctx,
    ['Papel', 'Nome', 'Data', 'Assinatura'],
    content.signatures.map((s) => [
      s.role === 'elaboration' ? 'Elaboração' : s.role === 'review' ? 'Revisão' : 'Aprovação',
      s.name || '—',
      s.date ? new Date(s.date).toLocaleString('pt-BR') : '—',
      s.signed ? 'Assinado eletronicamente' : '________________',
    ]),
    [20, 30, 26, 24],
  );
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `ValidaMétodo · ${content.method.code} · v${content.version} · página ${i} de ${pages} · hash ${content.auditHash.slice(0, 12)}`,
      105,
      290,
      { align: 'center' },
    );
  }
  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}

export function downloadReportPdf(bytes: Uint8Array, bundle: ValidationBundle) {
  downloadBytes(bytes, `${baseName(bundle)}-relatorio.pdf`, MIME_PDF);
}

// ── ZIP de evidências ──────────────────────────────────────────────────────

export async function buildEvidenceZip(
  bundle: ValidationBundle,
  analysis: ValidationAnalysis,
  report: ReportRecord,
): Promise<Uint8Array> {
  const zip = new JSZip();
  const folder = zip.folder(baseName(bundle)) ?? zip;
  const csv = measurementsToCsv(bundle);
  const docx = await buildReportDocx(bundle, analysis, report);
  const pdf = await buildReportPdf(bundle, analysis, report);
  const sqlite = await exportSqlite();
  const analysisJson = JSON.stringify(
    {
      generatedAt: analysis.generatedAt,
      overallVerdict: analysis.overallVerdict,
      nTotal: analysis.nTotal,
      nUsed: analysis.nUsed,
      parameters: analysis.parameters,
      qc: analysis.qc,
      warnings: analysis.warnings,
      assumptions: analysis.assumptions,
    },
    null,
    2,
  );
  const files: Array<[string, Uint8Array | string]> = [
    ['dados.csv', `\ufeff${csv}`],
    ['resultados.json', analysisJson],
    ['relatorio.docx', docx],
    ['relatorio.pdf', pdf],
    ['banco.sqlite', sqlite],
  ];
  const manifestLines = [
    `ValidaMétodo — pacote de evidências`,
    `Método: ${bundle.method.code} — ${bundle.method.name}`,
    `Validação: ${bundle.validation.title}`,
    `Versão: ${bundle.validation.version}`,
    `Gerado em: ${new Date().toISOString()}`,
    `Hash do relatório: ${report.content.auditHash}`,
    '',
    'Arquivos e hashes SHA-256:',
  ];
  for (const [name, content] of files) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    folder.file(name, bytes);
    manifestLines.push(`${await sha256(bytes)}  ${name}`);
  }
  folder.file('MANIFESTO.txt', manifestLines.join('\r\n'));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return bytes;
}

export function downloadEvidenceZip(bytes: Uint8Array, bundle: ValidationBundle) {
  downloadBytes(bytes, `${baseName(bundle)}-evidencias.zip`, 'application/zip');
}

export function downloadAnalysisJson(analysis: ValidationAnalysis, bundle: ValidationBundle) {
  downloadText(
    JSON.stringify(analysis, null, 2),
    `${baseName(bundle)}-resultados.json`,
    'application/json',
  );
}

export function downloadReportHtml(
  bundle: ValidationBundle,
  report: ReportRecord,
  element: HTMLElement | null,
) {
  if (!element) return;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${report.content.title}</title><style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1e293b}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #cbd5e1;padding:6px;font-size:12px;text-align:left}h1{color:#0f766e}</style></head><body>${element.innerHTML}</body></html>`;
  downloadText(html, `${baseName(bundle)}-relatorio.html`, 'text/html;charset=utf-8');
}

export function downloadBlobFile(blob: Blob, filename: string) {
  downloadBlob(blob, filename);
}
