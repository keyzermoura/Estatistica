import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Measurement } from '../../lib/types';
import { replaceMeasurements, updateValidation } from '../../lib/repository';
import { assertMeasurementIdentities } from '../../lib/validation';
import {
  computeBufferSha256,
  downloadDesignTemplate,
  downloadMeasurementsCsv,
  downloadMeasurementsXlsx,
  importedToMeasurements,
  parseSpreadsheetBuffer,
  validateImportBalance,
} from '../../lib/export';
import { parseNumber, uid } from '../../lib/utils';
import { fmt } from '../../stats/distributions';
import { attributeReferenceSheet } from '../../stats/attribute-data';
import { StepShell } from '../../components/wizard';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Modal,
  Stat,
  useToast,
} from '../../components/ui';
import type { StepProps } from './types';

const inputClass =
  'w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-100 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100';

function blankMeasurement(bundle: StepProps['bundle'], index: number): Measurement {
  const run = bundle.design?.plan.runs[index];
  const destructiveFamily = bundle.method.family === 'physical-destructive';
  return {
    id: uid('m'),
    validationId: bundle.validation.id,
    runOrder: run?.runOrder ?? index + 1,
    level: run?.level ?? '',
    analyst: run?.analyst ?? '',
    day: run?.day ?? '',
    equipment: run?.equipment ?? '',
    lot: run?.lot ?? '',
    sample: run?.sample ?? '',
    partId: run?.partId ?? '',
    specimen: run?.specimen ?? '',
    destructive: run?.destructive ?? destructiveFamily,
    condition: null,
    refValue: null,
    refUncertainty: null,
    category: '',
    replicate: run?.replicate ?? 1,
    value: null,
    referenceValue: null,
    textValue: '',
    notes: '',
  };
}

export function StepCollection({ bundle, goTo, reload }: StepProps) {
  const toast = useToast();
  const locked = bundle.validation.locked;
  const dimensional = bundle.method.family === 'dimensional';
  const physicalDestructive = bundle.method.family === 'physical-destructive';
  const physicalNonDestructive = bundle.method.family === 'physical-nondestructive';
  const physical = physicalDestructive || physicalNonDestructive;
  const attribute = bundle.method.family === 'attribute';
  /** Perfis que usam Peça como identificador do Gage R&R. */
  const requiresPart = dimensional || physicalNonDestructive;
  /** Perfis que registram valor de referência do padrão. */
  const showsReference = dimensional || physical;
  const showPartColumn = !attribute && !physicalDestructive;
  const showSpecimenColumn = physicalDestructive;
  const [measurements, setMeasurements] = useState<Measurement[]>(bundle.measurements);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [referenceDrafts, setReferenceDrafts] = useState<Record<string, string>>({});
  const [bulkReference, setBulkReference] = useState(
    () => bundle.design?.input.levels?.[0] ?? '',
  );
  const [importAudit, setImportAudit] = useState<{
    fileName: string;
    sha256: string;
    warnings: string[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMeasurements(bundle.measurements);
    setReferenceDrafts({});
  }, [bundle.measurements]);

  const patch = (id: string, value: Partial<Measurement>) => {
    setMeasurements((prev) => prev.map((row) => (row.id === id ? { ...row, ...value } : row)));
  };

  const addRow = () => {
    setMeasurements((prev) => [...prev, blankMeasurement(bundle, prev.length)]);
  };

  const removeRow = (id: string) => {
    setMeasurements((prev) => prev.filter((row) => row.id !== id));
  };

  const quality = useMemo(() => {
    const numeric = measurements.filter((row) => row.value !== null && Number.isFinite(row.value));
    const textual = measurements.filter((row) => row.value === null && row.textValue.trim());
    const categorized = measurements.filter(
      (row) =>
        (row.category ?? '').trim() !== '' ||
        row.textValue.trim() !== '' ||
        (row.value !== null && Number.isFinite(row.value)),
    );
    const missing = attribute
      ? measurements.length - categorized.length
      : measurements.length - numeric.length - textual.length;
    const levels = [...new Set(measurements.map((row) => row.level).filter(Boolean))];
    const references = attribute
      ? measurements.filter(
          (row) =>
            row.level.trim() !== '' ||
            (row.referenceValue !== null && Number.isFinite(row.referenceValue)),
        )
      : measurements.filter(
          (row) => row.referenceValue !== null && Number.isFinite(row.referenceValue),
        );
    const missingReferences = attribute
      ? measurements.filter(
          (row) =>
            row.level.trim() === '' &&
            (row.referenceValue === null || !Number.isFinite(row.referenceValue)),
        ).length
      : 0;
    const items = [...new Set(measurements.map((row) => row.sample.trim()).filter(Boolean))];
    const raters = [...new Set(measurements.map((row) => row.analyst.trim()).filter(Boolean))];
    const cellCounts = new Map<string, number>();
    if (attribute) {
      for (const row of measurements) {
        const item = row.sample.trim();
        const rater = row.analyst.trim();
        if (!item || !rater) continue;
        const key = `${item}\u0000${rater}\u0000${row.replicate}`;
        cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
      }
    }
    const duplicateCells = [...cellCounts.values()].reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0,
    );
    const outside = numeric.filter((row) => {
      if (bundle.method.rangeMin === null && bundle.method.rangeMax === null) return false;
      const value = row.value!;
      return (
        (bundle.method.rangeMin !== null && value < bundle.method.rangeMin) ||
        (bundle.method.rangeMax !== null && value > bundle.method.rangeMax)
      );
    });
    const byAnalyst = new Map<string, number>();
    for (const row of measurements) {
      const key = row.analyst || '—';
      byAnalyst.set(key, (byAnalyst.get(key) ?? 0) + 1);
    }
    const counts = [...byAnalyst.values()];
    const unbalanced = counts.length > 1 && Math.max(...counts) !== Math.min(...counts);
    const missingParts = requiresPart
      ? numeric.filter(
          (row) =>
            !(row.partId ?? '').trim() &&
            (row.refValue === null || row.refValue === undefined),
        ).length
      : 0;
    const specimenCounts = new Map<string, number>();
    for (const row of measurements) {
      const specimen = (row.specimen ?? '').trim();
      if (!specimen) continue;
      specimenCounts.set(specimen, (specimenCounts.get(specimen) ?? 0) + 1);
    }
    const duplicateSpecimens = [...specimenCounts.values()].reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0,
    );
    const missingSpecimens = physicalDestructive
      ? measurements.filter(
          (row) => row.destructive !== false && !(row.specimen ?? '').trim(),
        ).length
      : 0;
    const missingDestructiveSamples = physicalDestructive
      ? measurements.filter(
          (row) => row.destructive !== false && !row.sample.trim(),
        ).length
      : 0;
    return {
      numeric,
      textual,
      categorized,
      missing,
      levels,
      references,
      missingReferences,
      items,
      raters,
      duplicateCells,
      outside,
      byAnalyst,
      unbalanced,
      missingParts,
      duplicateSpecimens,
      missingSpecimens,
      missingDestructiveSamples,
    };
  }, [
    measurements,
    bundle.method.rangeMin,
    bundle.method.rangeMax,
    requiresPart,
    physicalDestructive,
    attribute,
  ]);

  const attributeSheet = useMemo(
    () => (attribute ? attributeReferenceSheet(measurements) : null),
    [attribute, measurements],
  );
  const attributeItems = attributeSheet?.items ?? [];
  const attributeCategories = useMemo(() => {
    const values = new Set<string>();
    for (const level of bundle.design?.input.levels ?? []) {
      const trimmed = level.trim();
      if (trimmed) values.add(trimmed);
    }
    for (const category of attributeSheet?.categories ?? []) values.add(category);
    return [...values].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [attributeSheet, bundle.design?.input.levels]);
  const missingReferenceItems = attributeItems.filter(
    (item) => !item.reference && !item.conflict,
  );
  const conflictReferenceItems = attributeItems.filter((item) => item.conflict);

  const applyAttributeReference = (items: string[], reference: string) => {
    if (!items.length) return;
    const target = new Set(items);
    const value = reference.trim();
    setMeasurements((prev) =>
      prev.map((row) =>
        target.has(row.sample.trim())
          ? { ...row, level: value, referenceValue: null }
          : row,
      ),
    );
    setReferenceDrafts((prev) => {
      const next = { ...prev };
      for (const item of items) delete next[item];
      return next;
    });
  };

  const commitReferenceDraft = (item: string) => {
    const draft = referenceDrafts[item];
    if (draft === undefined) return;
    applyAttributeReference([item], draft);
  };

  const fillFromPlan = () => {
    if (!bundle.design?.plan.runs.length) {
      toast.push('Gere e salve um delineamento antes de preencher pelo plano.', 'danger');
      return;
    }
    const rows = bundle.design.plan.runs.map((run) => ({
      id: uid('m'),
      validationId: bundle.validation.id,
      runOrder: run.runOrder,
      level: run.level,
      analyst: run.analyst,
      day: run.day,
      equipment: run.equipment,
      lot: run.lot,
      sample: run.sample,
      partId: run.partId ?? '',
      specimen: run.specimen ?? '',
      destructive: run.destructive ?? physicalDestructive,
      condition: null,
      refValue: null,
      refUncertainty: null,
      category: '',
      replicate: run.replicate,
      value: null,
      referenceValue: null,
      textValue: '',
      notes: '',
    }));
    setMeasurements(rows);
    setReferenceDrafts({});
    setPlanOpen(false);
    toast.push(`${rows.length} linha(s) criadas a partir do plano. Preencha os valores e salve.`);
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const [fileSha256, rows] = await Promise.all([
        computeBufferSha256(buffer),
        Promise.resolve(parseSpreadsheetBuffer(buffer)),
      ]);
      if (!rows.length) {
        toast.push('Nenhuma linha com valor ou texto foi encontrada na planilha.', 'danger');
        return;
      }
      assertMeasurementIdentities(rows, bundle.method.family);
      const balanceWarnings = validateImportBalance(rows, bundle.method.family);
      setImportAudit({
        fileName: file.name,
        sha256: fileSha256,
        warnings: balanceWarnings,
      });
      setMeasurements(importedToMeasurements(rows, bundle.validation.id));
      setReferenceDrafts({});
      toast.push(
        `${rows.length} linha(s) importadas (SHA-256 ${fileSha256.slice(0, 12)}…). Revise e clique em salvar.`,
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao importar planilha.', 'danger');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const persist = (): boolean => {
    if (locked) return false;
    setSaving(true);
    try {
      const actor = bundle.validation.responsible.trim() || 'sistema';
      const normalized = measurements.map((row, index) => ({
        ...row,
        runOrder: row.runOrder || index + 1,
      }));
      replaceMeasurements(
        bundle.validation.id,
        normalized,
        actor,
        'Coleta editada na interface',
      );
      if (bundle.validation.status === 'draft') {
        updateValidation({ ...bundle.validation, status: 'in_progress' }, actor);
      }
      toast.push('Dados de coleta salvos.');
      reload();
      return true;
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao salvar dados.', 'danger');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const bundleForExport = { ...bundle, measurements };
  const columnCount =
    7 +
    (showPartColumn ? 1 : 0) +
    1 +
    (attribute ? 1 : 2) +
    (showsReference ? 2 : 0) +
    (showSpecimenColumn ? 2 : 0) +
    3;

  return (
    <StepShell
      step={3}
      title="Coleta de dados"
      description="Registre as medições na ordem de execução, importe uma planilha modelo e verifique faltantes, valores fora da faixa e desbalanceamento antes de analisar."
      locked={locked}
      help={
        <>
          <p>
            Cada linha representa uma execução. Use “Nível” para concentração ou condição e
            “Referência” para o valor aceito na avaliação de exatidão. Em métodos qualitativos,
            registre o resultado em “Texto”.
          </p>
          <p className="mt-1">
            A referência tem prioridade sobre o nível numérico na avaliação de tendência e
            recuperação.
          </p>
          {dimensional ? (
            <p className="mt-1">
              No perfil dimensional, <strong>Peça</strong> identifica a peça do Gage R&amp;R e{' '}
              <strong>Valor de referência</strong> é o valor aceito do padrão (usado em
              tendência/linearidade e estabilidade). A coluna “Referência” continua disponível
              para o valor nominal de exatidão.
            </p>
          ) : null}
          {physicalNonDestructive ? (
            <p className="mt-1">
              No perfil físico <strong>não destrutivo</strong>, a mesma peça é medida por todos
              os operadores e réplicas, sem consumo. <strong>Peça</strong> identifica a peça
              reutilizada no Gage R&amp;R e <strong>Valor ref. padrão</strong> é o valor aceito
              do padrão para tendência/linearidade/estabilidade.
            </p>
          ) : null}
          {physicalDestructive ? (
            <p className="mt-1">
              No perfil físico <strong>destrutivo</strong>, cada linha consome um{' '}
              <strong>corpo de prova</strong> distinto. Informe a <strong>Amostra</strong>{' '}
              (lote/grupo de origem), o <strong>Analista</strong> e um{' '}
              <strong>Corpo de prova</strong> único; mantenha “Destrutivo” marcado. O mesmo
              corpo de prova não pode ser medido duas vezes.
            </p>
          ) : null}
          {attribute ? (
            <p className="mt-1">
              No perfil de atributo, <strong>Amostra</strong> identifica o item,{' '}
              <strong>Analista / lab</strong> é o avaliador e <strong>Rep.</strong> é a réplica.
              Registre a classificação em <strong>Categoria observada</strong> e a categoria
              correta do item em <strong>Ref. categ.</strong> (por exemplo, “conforme” ou “não
              conforme”). A referência deve ser a mesma para todas as réplicas do mesmo item.
            </p>
          ) : null}
        </>
      }
      aside={
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">{measurements.length} registro(s)</Badge>
          {attribute ? (
            <>
              <Badge tone="neutral">
                {quality.items.length} item(ns) · {quality.raters.length} avaliador(es)
              </Badge>
              {quality.missing ? (
                <Badge tone="warning">{quality.missing} sem categoria</Badge>
              ) : null}
              {quality.missingReferences ? (
                <Badge tone="warning">{quality.missingReferences} sem referência</Badge>
              ) : null}
              {quality.duplicateCells ? (
                <Badge tone="danger">{quality.duplicateCells} duplicidade(s)</Badge>
              ) : null}
            </>
          ) : (
            <>
              {quality.missing ? <Badge tone="warning">{quality.missing} sem valor</Badge> : null}
              {quality.outside.length ? <Badge tone="danger">{quality.outside.length} fora da faixa</Badge> : null}
              {requiresPart && quality.missingParts ? (
                <Badge tone="warning">{quality.missingParts} sem peça</Badge>
              ) : null}
              {showSpecimenColumn && quality.missingSpecimens ? (
                <Badge tone="warning">{quality.missingSpecimens} sem corpo de prova</Badge>
              ) : null}
              {showSpecimenColumn && quality.duplicateSpecimens ? (
                <Badge tone="danger">
                  {quality.duplicateSpecimens} corpo(s) de prova duplicado(s)
                </Badge>
              ) : null}
            </>
          )}
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => goTo(2)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void persist()} disabled={locked} loading={saving}>
              <Save className="h-4 w-4" /> Salvar dados
            </Button>
            <Button
              onClick={() => {
                if (persist()) goTo(4);
              }}
              disabled={locked}
              loading={saving}
            >
              Salvar e analisar <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {attribute ? (
          <>
            <Stat
              label="Registros"
              value={measurements.length}
              hint={`${quality.items.length} item(ns) · ${quality.raters.length} avaliador(es)`}
              icon={<ClipboardList className="h-5 w-5" />}
            />
            <Stat
              label="Sem categoria"
              value={quality.missing}
              hint="classificação observada ausente"
              icon={<AlertTriangle className="h-5 w-5" />}
              tone={quality.missing ? 'warning' : 'success'}
            />
            <Stat
              label="Categorias"
              value={quality.levels.length}
              hint={quality.levels.join(', ') || '—'}
              icon={<FileSpreadsheet className="h-5 w-5" />}
              tone="neutral"
            />
            <Stat
              label="Sem referência"
              value={quality.missingReferences}
              hint="registros sem categoria correta"
              icon={<AlertTriangle className="h-5 w-5" />}
              tone={quality.missingReferences ? 'warning' : 'success'}
            />
          </>
        ) : (
          <>
            <Stat label="Registros" value={measurements.length} hint={`${quality.numeric.length} numéricos · ${quality.textual.length} textuais`} icon={<ClipboardList className="h-5 w-5" />} />
            <Stat label="Sem valor" value={quality.missing} hint="faltantes ou incompletos" icon={<AlertTriangle className="h-5 w-5" />} tone={quality.missing ? 'warning' : 'success'} />
            <Stat label="Níveis" value={quality.levels.length} hint={quality.levels.join(', ') || '—'} icon={<FileSpreadsheet className="h-5 w-5" />} tone="neutral" />
            <Stat label="Fora da faixa" value={quality.outside.length} hint={quality.references.length ? `${quality.references.length} com referência` : 'sem valor de referência'} icon={<AlertTriangle className="h-5 w-5" />} tone={quality.outside.length ? 'danger' : 'success'} />
          </>
        )}
      </div>

      {importAudit ? (
        <Alert
          tone={importAudit.warnings.length ? 'warning' : 'success'}
          title={`Arquivo importado: ${importAudit.fileName} · SHA-256 ${importAudit.sha256.slice(0, 16)}…`}
        >
          {importAudit.warnings.length ? (
            <ul className="list-disc pl-4">
              {importAudit.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            'Integridade SHA-256 registrada e balanceamento das réplicas verificado.'
          )}
        </Alert>
      ) : null}

      {quality.unbalanced ? (
        <Alert tone="warning" title="Desbalanceamento entre analistas/laboratórios">
          {[...quality.byAnalyst.entries()].map(([name, count]) => `${name}: ${count}`).join(' · ')}.{' '}
          {attribute
            ? 'Cada avaliador deve classificar todos os itens; um avaliador com menos registros reduz a comparabilidade do κ.'
            : 'A ANOVA e a decomposição de variância podem exigir aproximação; o relatório registrará a limitação.'}
        </Alert>
      ) : null}

      {attribute && quality.duplicateCells ? (
        <Alert tone="danger" title="Combinações item/avaliador/réplica duplicadas">
          Há {quality.duplicateCells} combinação(ões) repetida(s). O estudo de concordância não
          será avaliado até que cada item tenha uma única classificação por avaliador e réplica.
        </Alert>
      ) : null}

      {attribute && quality.missingReferences ? (
        <Alert tone="warning" title="Itens sem referência conhecida">
          {quality.missingReferences} registro(s) não têm categoria de referência. A concordância
          entre avaliadores ainda pode ser calculada, mas eficácia, FAR, FRR e concordância com a
          referência ficam limitadas aos itens com referência.
        </Alert>
      ) : null}

      {attribute && quality.missing ? (
        <Alert tone="warning" title="Classificações ausentes">
          {quality.missing} registro(s) sem categoria observada não entram no estudo. Preencha
          “Categoria observada” ou remova as linhas que não serão usadas.
        </Alert>
      ) : null}

      {requiresPart && quality.missingParts ? (
        <Alert tone="warning" title="Medições sem peça">
          {quality.missingParts} medição(ões) numérica(s) não têm identificação de peça e não
          entram no Gage R&amp;R. Preencha a coluna “Peça” ou use um valor de referência se a
          linha for de tendência/estabilidade.
        </Alert>
      ) : null}

      {showSpecimenColumn && quality.missingSpecimens ? (
        <Alert tone="warning" title="Corpos de prova não identificados">
          {quality.missingSpecimens} linha(s) destrutiva(s) não têm corpo de prova. No ensaio
          destrutivo, cada réplica consome um corpo de prova único; sem essa identificação a
          repetibilidade e a reprodutibilidade ficam “não avaliadas”.
        </Alert>
      ) : null}

      {showSpecimenColumn && quality.duplicateSpecimens ? (
        <Alert tone="danger" title="Corpos de prova duplicados">
          Há {quality.duplicateSpecimens} corpo(s) de prova repetido(s). Cada corpo de prova é
          consumido uma única vez; corrija os identificadores antes de analisar. O estudo
          aninhado não será avaliado enquanto houver duplicidade.
        </Alert>
      ) : null}

      {showSpecimenColumn && quality.missingDestructiveSamples ? (
        <Alert tone="warning" title="Amostras não identificadas">
          {quality.missingDestructiveSamples} linha(s) destrutiva(s) não têm amostra. A amostra
          identifica o lote/grupo de onde o corpo de prova foi retirado e é necessária para o
          modelo aninhado.
        </Alert>
      ) : null}

      {quality.outside.length ? (
        <Alert tone="danger" title="Valores fora da faixa declarada">
          {quality.outside
            .slice(0, 6)
            .map((row) => `${row.level || 'sem nível'}: ${fmt(row.value)}`)
            .join(' · ')}
          {quality.outside.length > 6 ? ` … +${quality.outside.length - 6}` : ''}. Confirme se são
          válidos ou se a faixa precisa ser revista.
        </Alert>
      ) : null}

      {attribute ? (
        <Card>
          <CardHeader
            title="Gabarito de referência"
            description="Defina a categoria correta de cada item. A referência vale para todas as réplicas e avaliadores do mesmo item."
            icon={<ClipboardList className="h-4 w-4" />}
            action={
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="outline">{attributeItems.length} item(ns)</Badge>
                {missingReferenceItems.length ? (
                  <Badge tone="warning">
                    {missingReferenceItems.length} sem referência
                  </Badge>
                ) : null}
                {conflictReferenceItems.length ? (
                  <Badge tone="danger">
                    {conflictReferenceItems.length} em conflito
                  </Badge>
                ) : null}
              </div>
            }
          />
          <CardBody className="space-y-3">
            {attributeItems.length === 0 ? (
              <p className="text-xs text-ink-500">
                Nenhum item identificado. Preencha a coluna “Amostra”, use o plano ou importe a
                coleta para definir o gabarito.
              </p>
            ) : (
              <>
                {conflictReferenceItems.length ? (
                  <Alert tone="danger" title="Referências conflitantes">
                    {conflictReferenceItems.length} item(ns) têm referências diferentes entre
                    linhas. Defina uma única categoria por item antes de analisar; o estudo fica
                    “não avaliado” enquanto houver conflito.
                  </Alert>
                ) : null}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[220px] flex-1">
                    <label htmlFor="attribute-bulk-reference" className="field-label">
                      Categoria para aplicação em massa
                    </label>
                    <input
                      id="attribute-bulk-reference"
                      className={`${inputClass} h-10`}
                      list="attribute-reference-options"
                      value={bulkReference}
                      disabled={locked}
                      onChange={(e) => setBulkReference(e.target.value)}
                      placeholder="Ex.: conforme"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={locked || !bulkReference.trim()}
                    onClick={() =>
                      applyAttributeReference(
                        attributeItems.map((item) => item.item),
                        bulkReference,
                      )
                    }
                  >
                    Aplicar a todos
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      locked || !bulkReference.trim() || missingReferenceItems.length === 0
                    }
                    onClick={() =>
                      applyAttributeReference(
                        missingReferenceItems.map((item) => item.item),
                        bulkReference,
                      )
                    }
                  >
                    Aplicar aos sem referência
                  </Button>
                  {conflictReferenceItems.length ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={locked || !bulkReference.trim()}
                      onClick={() =>
                        applyAttributeReference(
                          conflictReferenceItems.map((item) => item.item),
                          bulkReference,
                        )
                      }
                    >
                      Resolver conflitos
                    </Button>
                  ) : null}
                </div>
                <datalist id="attribute-reference-options">
                  {attributeCategories.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
                <div className="max-h-[320px] overflow-auto rounded-xl border border-ink-200 dark:border-ink-800">
                  <table className="data-table">
                    <thead className="sticky top-0 z-10 bg-ink-50 dark:bg-ink-900">
                      <tr>
                        <th>Item (amostra)</th>
                        <th className="text-right">Registros</th>
                        <th>Referência atual</th>
                        <th>Definir referência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attributeItems.map((item) => (
                        <tr key={item.item}>
                          <td className="font-mono text-xs">{item.item}</td>
                          <td className="text-right font-mono text-xs">{item.rows}</td>
                          <td>
                            {item.conflict ? (
                              <Badge tone="danger">conflito</Badge>
                            ) : item.reference ? (
                              <Badge tone="neutral">{item.reference}</Badge>
                            ) : (
                              <Badge tone="warning">sem referência</Badge>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              <input
                                className={`${inputClass} w-40`}
                                list="attribute-reference-options"
                                value={referenceDrafts[item.item] ?? item.reference ?? ''}
                                disabled={locked}
                                onChange={(e) =>
                                  setReferenceDrafts((prev) => ({
                                    ...prev,
                                    [item.item]: e.target.value,
                                  }))
                                }
                                onBlur={() => commitReferenceDraft(item.item)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitReferenceDraft(item.item);
                                  }
                                }}
                                placeholder="definir…"
                                aria-label={`Categoria de referência do item ${item.item}`}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={locked || referenceDrafts[item.item] === undefined}
                                onClick={() => commitReferenceDraft(item.item)}
                                title={`Aplicar referência ao item ${item.item}`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-ink-400">
                  A aplicação substitui a referência existente nas linhas do item e grava a
                  categoria em “Nível”. Salve a coleta para persistir. Para uma classificação
                  cega, o avaliador não deve ver esta coluna nem este gabarito.
                </p>
              </>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Dados brutos"
          description="Edite diretamente na tabela. Nada é gravado até clicar em salvar."
          icon={<ClipboardList className="h-4 w-4" />}
          action={
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setPlanOpen(true)} disabled={locked || !bundle.design}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Do plano
              </Button>
              <Button variant="outline" size="sm" onClick={() => void downloadDesignTemplate(bundleForExport)}>
                <Download className="h-3.5 w-3.5" /> Modelo
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => void importFile(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" size="sm" loading={importing} onClick={() => fileInput.current?.click()} disabled={locked}>
                <Upload className="h-3.5 w-3.5" /> Importar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void downloadMeasurementsCsv(bundleForExport)}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void downloadMeasurementsXlsx(bundleForExport)}>
                <Download className="h-3.5 w-3.5" /> XLSX
              </Button>
            </div>
          }
        />
        <div className="max-h-[620px] overflow-auto">
          <table className={`w-full ${physicalDestructive ? 'min-w-[1700px]' : dimensional || physicalNonDestructive ? 'min-w-[1560px]' : attribute ? 'min-w-[1220px]' : 'min-w-[1320px]'} border-collapse text-xs`}>
            <thead className="sticky top-0 z-10 bg-ink-50 dark:bg-ink-900">
              <tr className="text-left text-[10px] uppercase tracking-wide text-ink-500">
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Ordem</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">
                  {attribute ? 'Ref. categ.' : 'Nível'}
                </th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Analista / lab</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Dia</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Equip.</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Lote</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Amostra</th>
                {showPartColumn ? (
                  <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Peça</th>
                ) : null}
                {showSpecimenColumn ? (
                  <>
                    <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">
                      Corpo de prova
                    </th>
                    <th className="border-b border-ink-200 px-2 py-2 text-center dark:border-ink-800">
                      Destrutivo
                    </th>
                  </>
                ) : null}
                <th className="border-b border-ink-200 px-2 py-2 text-center dark:border-ink-800">Rep.</th>
                {!attribute ? (
                  <>
                    <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Valor</th>
                    <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Referência</th>
                  </>
                ) : (
                  <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">
                    Categoria observada
                  </th>
                )}
                {showsReference ? (
                  <>
                    <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Valor ref. padrão</th>
                    <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Incerteza ref.</th>
                  </>
                ) : null}
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Texto</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Notas</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800" />
              </tr>
            </thead>
            <tbody>
              {measurements.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-3 py-10 text-center text-sm text-ink-500">
                    Nenhum dado. Adicione uma linha, preencha pelo plano ou importe uma planilha.
                  </td>
                </tr>
              ) : (
                measurements.map((row) => (
                  <tr key={row.id} className="odd:bg-white even:bg-ink-50/40 dark:odd:bg-ink-900 dark:even:bg-ink-950/40">
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input
                        type="number"
                        className={`${inputClass} w-16`}
                        value={row.runOrder}
                        disabled={locked}
                        onChange={(e) => patch(row.id, { runOrder: Number(e.target.value) })}
                      />
                    </td>
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input className={`${inputClass} w-24`} value={row.level} disabled={locked} onChange={(e) => patch(row.id, { level: e.target.value })} placeholder={attribute ? 'conforme' : '5'} />
                    </td>
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input className={`${inputClass} w-28`} value={row.analyst} disabled={locked} onChange={(e) => patch(row.id, { analyst: e.target.value })} placeholder="Ana" />
                    </td>
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input className={`${inputClass} w-16`} value={row.day} disabled={locked} onChange={(e) => patch(row.id, { day: e.target.value })} placeholder="D1" />
                    </td>
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input className={`${inputClass} w-20`} value={row.equipment} disabled={locked} onChange={(e) => patch(row.id, { equipment: e.target.value })} placeholder="HPLC-1" />
                    </td>
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input className={`${inputClass} w-24`} value={row.lot} disabled={locked} onChange={(e) => patch(row.id, { lot: e.target.value })} />
                    </td>
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input className={`${inputClass} w-28`} value={row.sample} disabled={locked} onChange={(e) => patch(row.id, { sample: e.target.value })} />
                    </td>
                    {showPartColumn ? (
                      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                        <input className={`${inputClass} w-20 font-mono`} value={row.partId ?? ''} disabled={locked} onChange={(e) => patch(row.id, { partId: e.target.value })} placeholder="P-01" />
                      </td>
                    ) : null}
                    {showSpecimenColumn ? (
                      <>
                        <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                          <input
                            className={`${inputClass} w-24 font-mono ${
                              (row.destructive ?? true) && !(row.specimen ?? '').trim()
                                ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20'
                                : ''
                            }`}
                            value={row.specimen ?? ''}
                            disabled={locked}
                            onChange={(e) => patch(row.id, { specimen: e.target.value })}
                            placeholder="CP-001"
                          />
                        </td>
                        <td className="border-b border-ink-100 px-1.5 py-1 text-center dark:border-ink-800">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                            checked={row.destructive ?? true}
                            disabled={locked}
                            onChange={(e) => patch(row.id, { destructive: e.target.checked })}
                            aria-label={`Linha ${row.runOrder} é destrutiva`}
                          />
                        </td>
                      </>
                    ) : null}
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input
                        type="number"
                        className={`${inputClass} w-14 text-center`}
                        value={row.replicate}
                        disabled={locked}
                        onChange={(e) => patch(row.id, { replicate: Number(e.target.value) })}
                      />
                    </td>
                    {attribute ? (
                      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                        <input
                          className={`${inputClass} w-32 ${
                            (row.category ?? '').trim() === '' &&
                            row.textValue.trim() === '' &&
                            row.value === null
                              ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20'
                              : ''
                          }`}
                          value={row.category ?? ''}
                          disabled={locked}
                          onChange={(e) => patch(row.id, { category: e.target.value })}
                          placeholder="conforme"
                        />
                      </td>
                    ) : (
                      <>
                        <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                          <input
                            type="number"
                            step="any"
                            className={`${inputClass} w-24 ${row.value === null && row.textValue === '' ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20' : ''}`}
                            value={row.value ?? ''}
                            disabled={locked}
                            onChange={(e) => patch(row.id, { value: parseNumber(e.target.value) })}
                          />
                        </td>
                        <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                          <input
                            type="number"
                            step="any"
                            className={`${inputClass} w-24`}
                            value={row.referenceValue ?? ''}
                            disabled={locked}
                            onChange={(e) => patch(row.id, { referenceValue: parseNumber(e.target.value) })}
                            placeholder="—"
                          />
                        </td>
                      </>
                    )}
                    {showsReference ? (
                      <>
                        <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                          <input
                            type="number"
                            step="any"
                            className={`${inputClass} w-24`}
                            value={row.refValue ?? ''}
                            disabled={locked}
                            onChange={(e) => patch(row.id, { refValue: parseNumber(e.target.value) })}
                            placeholder="—"
                          />
                        </td>
                        <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                          <input
                            type="number"
                            step="any"
                            className={`${inputClass} w-24`}
                            value={row.refUncertainty ?? ''}
                            disabled={locked}
                            onChange={(e) =>
                              patch(row.id, { refUncertainty: parseNumber(e.target.value) })
                            }
                            placeholder="U_ref"
                          />
                        </td>
                      </>
                    ) : null}
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input className={`${inputClass} w-32`} value={row.textValue} disabled={locked} onChange={(e) => patch(row.id, { textValue: e.target.value })} placeholder="positivo/negativo" />
                    </td>
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input className={`${inputClass} w-40`} value={row.notes} disabled={locked} onChange={(e) => patch(row.id, { notes: e.target.value })} />
                    </td>
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <Button variant="ghost" size="icon" disabled={locked} onClick={() => removeRow(row.id)} title="Remover linha">
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <CardBody className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 dark:border-ink-800">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={addRow} disabled={locked}>
              <Plus className="h-3.5 w-3.5" /> Adicionar linha
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setClearOpen(true)} disabled={locked || measurements.length === 0}>
              <Trash2 className="h-3.5 w-3.5" /> Limpar tabela
            </Button>
          </div>
          <p className="text-[11px] text-ink-400">
            Dica: use “Modelo” para baixar a planilha já com a ordem do delineamento.
          </p>
        </CardBody>
      </Card>

      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Preencher a partir do plano"
        description="As linhas atuais serão substituídas pelas execuções do delineamento, com valores vazios."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanOpen(false)}>Cancelar</Button>
            <Button onClick={fillFromPlan}>Preencher {bundle.design?.plan.runs.length ?? 0} linha(s)</Button>
          </>
        }
      >
        <Alert tone="warning">
          Os valores já digitados serão perdidos. Exporte o CSV antes se precisar preservá-los.
        </Alert>
      </Modal>

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Limpar tabela"
        description="Remove todas as linhas da edição atual. O banco só muda após salvar."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setClearOpen(false)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                setMeasurements([]);
                setReferenceDrafts({});
                setClearOpen(false);
                toast.push('Tabela limpa. Clique em salvar para confirmar.');
              }}
            >
              Limpar
            </Button>
          </>
        }
      >
        <Alert tone="danger">Esta ação não pode ser desfeita sem recarregar os dados salvos.</Alert>
      </Modal>
    </StepShell>
  );
}
