import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
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
  downloadDesignTemplate,
  downloadMeasurementsCsv,
  downloadMeasurementsXlsx,
  importedToMeasurements,
  parseSpreadsheet,
} from '../../lib/export';
import { parseNumber, uid } from '../../lib/utils';
import { fmt } from '../../stats/distributions';
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
    specimen: '',
    destructive: false,
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
  const attribute = bundle.method.family === 'attribute';
  const [measurements, setMeasurements] = useState<Measurement[]>(bundle.measurements);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMeasurements(bundle.measurements);
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
    const missingParts = dimensional
      ? numeric.filter(
          (row) =>
            !(row.partId ?? '').trim() &&
            (row.refValue === null || row.refValue === undefined),
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
    };
  }, [
    measurements,
    bundle.method.rangeMin,
    bundle.method.rangeMax,
    dimensional,
    attribute,
  ]);

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
      specimen: '',
      destructive: false,
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
    setPlanOpen(false);
    toast.push(`${rows.length} linha(s) criadas a partir do plano. Preencha os valores e salve.`);
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const rows = await parseSpreadsheet(file);
      if (!rows.length) {
        toast.push('Nenhuma linha com valor ou texto foi encontrada na planilha.', 'danger');
        return;
      }
      assertMeasurementIdentities(rows, bundle.method.family);
      setMeasurements(importedToMeasurements(rows, bundle.validation.id));
      toast.push(`${rows.length} linha(s) importadas. Revise e clique em salvar.`);
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
      const normalized = measurements.map((row, index) => ({
        ...row,
        runOrder: row.runOrder || index + 1,
      }));
      replaceMeasurements(
        bundle.validation.id,
        normalized,
        'sistema',
        'Coleta editada na interface',
      );
      if (bundle.validation.status === 'draft') {
        updateValidation({ ...bundle.validation, status: 'in_progress' });
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
              {dimensional && quality.missingParts ? (
                <Badge tone="warning">{quality.missingParts} sem peça</Badge>
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

      {dimensional && quality.missingParts ? (
        <Alert tone="warning" title="Medições sem peça">
          {quality.missingParts} medição(ões) numérica(s) não têm identificação de peça e não
          entram no Gage R&amp;R. Preencha a coluna “Peça” ou use um valor de referência se a
          linha for de tendência/estabilidade.
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
          <table className={`w-full ${dimensional ? 'min-w-[1560px]' : attribute ? 'min-w-[1220px]' : 'min-w-[1320px]'} border-collapse text-xs`}>
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
                {!attribute ? (
                  <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Peça</th>
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
                {dimensional ? (
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
                  <td colSpan={dimensional ? 16 : attribute ? 12 : 14} className="px-3 py-10 text-center text-sm text-ink-500">
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
                    {!attribute ? (
                      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                        <input className={`${inputClass} w-20 font-mono`} value={row.partId ?? ''} disabled={locked} onChange={(e) => patch(row.id, { partId: e.target.value })} placeholder="P-01" />
                      </td>
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
                    {dimensional ? (
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
