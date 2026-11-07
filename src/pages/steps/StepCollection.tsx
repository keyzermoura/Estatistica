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
    partId: '',
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
    const missing = measurements.length - numeric.length - textual.length;
    const levels = [...new Set(measurements.map((row) => row.level).filter(Boolean))];
    const references = measurements.filter((row) => row.referenceValue !== null && Number.isFinite(row.referenceValue));
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
    return { numeric, textual, missing, levels, references, outside, byAnalyst, unbalanced };
  }, [measurements, bundle.method.rangeMin, bundle.method.rangeMax]);

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
      partId: '',
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
        </>
      }
      aside={
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">{measurements.length} registro(s)</Badge>
          {quality.missing ? <Badge tone="warning">{quality.missing} sem valor</Badge> : null}
          {quality.outside.length ? <Badge tone="danger">{quality.outside.length} fora da faixa</Badge> : null}
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
        <Stat label="Registros" value={measurements.length} hint={`${quality.numeric.length} numéricos · ${quality.textual.length} textuais`} icon={<ClipboardList className="h-5 w-5" />} />
        <Stat label="Sem valor" value={quality.missing} hint="faltantes ou incompletos" icon={<AlertTriangle className="h-5 w-5" />} tone={quality.missing ? 'warning' : 'success'} />
        <Stat label="Níveis" value={quality.levels.length} hint={quality.levels.join(', ') || '—'} icon={<FileSpreadsheet className="h-5 w-5" />} tone="neutral" />
        <Stat label="Fora da faixa" value={quality.outside.length} hint={quality.references.length ? `${quality.references.length} com referência` : 'sem valor de referência'} icon={<AlertTriangle className="h-5 w-5" />} tone={quality.outside.length ? 'danger' : 'success'} />
      </div>

      {quality.unbalanced ? (
        <Alert tone="warning" title="Desbalanceamento entre analistas/laboratórios">
          {[...quality.byAnalyst.entries()].map(([name, count]) => `${name}: ${count}`).join(' · ')}. A ANOVA e a
          decomposição de variância podem exigir aproximação; o relatório registrará a limitação.
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
          <table className="w-full min-w-[1180px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-ink-50 dark:bg-ink-900">
              <tr className="text-left text-[10px] uppercase tracking-wide text-ink-500">
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Ordem</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Nível</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Analista / lab</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Dia</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Equip.</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Lote</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Amostra</th>
                <th className="border-b border-ink-200 px-2 py-2 text-center dark:border-ink-800">Rep.</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Valor</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Referência</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Texto</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800">Notas</th>
                <th className="border-b border-ink-200 px-2 py-2 dark:border-ink-800" />
              </tr>
            </thead>
            <tbody>
              {measurements.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-sm text-ink-500">
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
                      <input className={`${inputClass} w-24`} value={row.level} disabled={locked} onChange={(e) => patch(row.id, { level: e.target.value })} placeholder="5" />
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
                    <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
                      <input
                        type="number"
                        className={`${inputClass} w-14 text-center`}
                        value={row.replicate}
                        disabled={locked}
                        onChange={(e) => patch(row.id, { replicate: Number(e.target.value) })}
                      />
                    </td>
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
