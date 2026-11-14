import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  FlaskConical,
  Info,
  LineChart,
  Plus,
  Save,
  Sigma,
  Trash2,
} from 'lucide-react';
import type { UncertaintyDistribution, UncertaintyItem, UncertaintyType } from '../../lib/types';
import { clearAnalyses, replaceUncertainty, saveAnalysis, updateValidation } from '../../lib/repository';
import { getProfileForMethod } from '../../profiles/index';
import { resolveCriteria } from '../../lib/criteria';
import { computeUncertainty, defaultDivisor } from '../../stats/uncertainty';
import { fmt } from '../../stats/distributions';
import { objectHash, uid } from '../../lib/utils';
import { ParameterResultCard } from '../../components/ParameterResultCard';
import { ScatterPlot, ResidualPlot } from '../../components/charts';
import { StepShell } from '../../components/wizard';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  Stat,
  Textarea,
  VerdictBadge,
  useToast,
} from '../../components/ui';
import type { StepProps } from './types';

const DISTRIBUTION_LABELS: Record<UncertaintyDistribution, string> = {
  normal: 'Normal',
  rectangular: 'Retangular',
  triangular: 'Triangular',
  u_shaped: 'Forma U',
  none: 'Sem distribuição',
};

function newUncertaintyItem(validationId: string): UncertaintyItem {
  return {
    id: uid('u'),
    validationId,
    source: '',
    type: 'B',
    distribution: 'rectangular',
    value: 0,
    divisor: Math.sqrt(3),
    sensitivity: 1,
    stdUncertainty: 0,
    dof: null,
    notes: '',
  };
}

export function StepAnalysis({ bundle, analysis, goTo, reload }: StepProps) {
  const toast = useToast();
  const locked = bundle.validation.locked;
  const profile = getProfileForMethod(bundle.method);
  const attribute = profile.id === 'attribute';
  const attributeQc = analysis.qc.attribute;
  const uncertaintyDefinition = profile.parameters.find((parameter) => parameter.key === 'uncertainty');
  const [items, setItems] = useState<UncertaintyItem[]>(bundle.uncertainty);
  const [savingUncertainty, setSavingUncertainty] = useState(false);
  const [freezing, setFreezing] = useState(false);

  useEffect(() => {
    setItems(bundle.uncertainty);
  }, [bundle.uncertainty]);

  const uncertaintyPreview = useMemo(
    () => computeUncertainty(items.map((item) => ({ ...item, id: item.id }))),
    [items],
  );

  const patchItem = (id: string, patch: Partial<UncertaintyItem>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        if (patch.distribution && !patch.divisor) {
          next.divisor = defaultDivisor(patch.distribution);
        }
        const divisor = next.divisor > 0 ? next.divisor : defaultDivisor(next.distribution);
        next.stdUncertainty = next.value / divisor;
        return next;
      }),
    );
  };

  const addItem = () => {
    setItems((prev) => [...prev, newUncertaintyItem(bundle.validation.id)]);
  };

  const saveUncertainty = () => {
    if (locked) return;
    if (items.some((item) => !item.source.trim())) {
      toast.push('Toda fonte de incerteza precisa de um nome.', 'danger');
      return;
    }
    setSavingUncertainty(true);
    try {
      const normalized = items.map((item) => {
        const divisor = item.divisor > 0 ? item.divisor : defaultDivisor(item.distribution);
        return {
          ...item,
          divisor,
          stdUncertainty: item.value / divisor,
          dof: item.dof === null || !Number.isFinite(item.dof) ? null : item.dof,
        };
      });
      replaceUncertainty(bundle.validation.id, normalized, 'sistema');
      if (bundle.validation.status === 'draft') {
        updateValidation({ ...bundle.validation, status: 'in_progress' });
      }
      toast.push('Orçamento de incerteza salvo.');
      reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao salvar incerteza.', 'danger');
    } finally {
      setSavingUncertainty(false);
    }
  };

  const freezeResults = async () => {
    if (locked) {
      toast.push('Validação bloqueada.', 'danger');
      return;
    }
    setFreezing(true);
    try {
      clearAnalyses(bundle.validation.id);
      for (const parameter of analysis.parameters) {
        saveAnalysis({
          validationId: bundle.validation.id,
          parameterKey: parameter.key,
          kind: 'auto',
          inputHash: await objectHash({
            measurements: bundle.measurements,
            parameter: parameter.key,
            criteria: resolveCriteria(
              bundle.method.criteria,
              bundle.parameters.find((item) => item.key === parameter.key)?.criteria ?? [],
              parameter.key,
            ),
          }),
          results: {
            verdict: parameter.verdict,
            summary: parameter.summary,
            metrics: parameter.metrics,
            rawMetrics: parameter.rawMetrics,
            tables: parameter.tables,
            warnings: parameter.warnings,
            notes: parameter.notes,
            reference: parameter.reference,
            results: parameter.results,
            generatedAt: analysis.generatedAt,
          },
        });
      }
      toast.push(`${analysis.parameters.length} resultado(s) congelado(s) no banco.`);
      reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao registrar análise.', 'danger');
    } finally {
      setFreezing(false);
    }
  };

  const descriptive = analysis.qc.descriptive;
  const calibration = analysis.qc.regression;
  const attributeData = attributeQc?.data ?? null;
  const attributeStudy = attributeQc?.study ?? null;
  const finiteValues = (values: Array<number | null>) =>
    values.filter((value): value is number => value !== null && Number.isFinite(value));
  const intraKappas = finiteValues(
    attributeStudy?.intraRater.map((result) => result.kappa.kappa) ?? [],
  );
  const referenceKappas = finiteValues(
    attributeStudy?.vsReference.map((result) => result.kappa.kappa) ?? [],
  );
  const worstIntra = intraKappas.length ? Math.min(...intraKappas) : null;
  const worstReference = referenceKappas.length ? Math.min(...referenceKappas) : null;

  return (
    <StepShell
      step={4}
      title="Análise estatística e incerteza"
      description="Resultados calculados a partir dos dados brutos, com fórmula, valor, critério e veredito. Nenhum resultado é concluído sem critério cadastrado."
      locked={locked}
      help={
        <>
          <p>
            A análise é recalculada a cada alteração dos dados ou critérios. O botão “Congelar
            resultados” grava o estado atual com um hash de entrada na tabela de análises.
          </p>
          {attribute ? (
            <p className="mt-1">
              No perfil de atributo, o estudo usa <strong>Amostra</strong> como item,{' '}
              <strong>Analista / lab</strong> como avaliador e <strong>Ref. categ.</strong> como
              referência conhecida. Kappa, eficácia, FAR e FRR são calculados a partir das
              categorias observadas; classificações ausentes e duplicidades são reportadas antes de
              qualquer conclusão.
            </p>
          ) : (
            <p className="mt-1">
              Outliers são sinalizados, nunca removidos automaticamente. A decisão de excluir um
              ponto deve ser registrada e justificada.
            </p>
          )}
        </>
      }
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge verdict={analysis.overallVerdict} />
          <Badge tone="outline">
            {analysis.nUsed} {attribute ? 'classificações usadas' : 'medições usadas'}
          </Badge>
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => goTo(3)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void freezeResults()} loading={freezing} disabled={locked}>
              <Database className="h-4 w-4" /> Congelar resultados
            </Button>
            <Button onClick={() => goTo(5)}>
              Ir para o relatório <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      }
    >
      {analysis.warnings.length ? (
        <Alert tone="warning" title="Avisos da análise">
          <ul className="list-disc space-y-1 pl-4">
            {analysis.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {attribute ? (
          <>
            <Stat
              label="Classificações válidas"
              value={analysis.nUsed}
              hint={`${analysis.nTotal} registros na coleta`}
              icon={<Sigma className="h-5 w-5" />}
            />
            <Stat
              label="Itens"
              value={attributeQc?.data?.items.length ?? 0}
              hint="amostras distintas"
              icon={<FlaskConical className="h-5 w-5" />}
              tone="neutral"
            />
            <Stat
              label="Avaliadores"
              value={attributeQc?.data?.raters.length ?? 0}
              hint="analistas/labs distintos"
              icon={<Database className="h-5 w-5" />}
              tone="neutral"
            />
            <Stat
              label="Sem referência"
              value={attributeQc?.data?.itemsWithoutReference ?? 0}
              hint="itens sem categoria correta"
              icon={<Info className="h-5 w-5" />}
              tone={attributeQc?.data?.itemsWithoutReference ? 'warning' : 'success'}
            />
            <Stat
              label="Veredito global"
              value={analysis.overallVerdict === 'pass' ? 'Conforme' : analysis.overallVerdict === 'fail' ? 'Não conforme' : analysis.overallVerdict === 'warning' ? 'Atenção' : 'Não avaliado'}
              hint={`${analysis.parameters.length} parâmetro(s)`}
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone={analysis.overallVerdict === 'pass' ? 'success' : analysis.overallVerdict === 'fail' ? 'danger' : 'warning'}
            />
          </>
        ) : (
          <>
            <Stat label="n usado" value={analysis.nUsed} hint={`${analysis.nTotal} registros`} icon={<Sigma className="h-5 w-5" />} />
            <Stat label="Média" value={fmt(descriptive.mean)} hint={`IC ${((descriptive.confidence ?? 0.95) * 100).toFixed(0)}%: ${fmt(descriptive.ciLow)} – ${fmt(descriptive.ciHigh)}`} icon={<BarChart3 className="h-5 w-5" />} tone="neutral" />
            <Stat label="s" value={fmt(descriptive.sd)} hint={`variância ${fmt(descriptive.variance)}`} icon={<LineChart className="h-5 w-5" />} tone="neutral" />
            <Stat label="CV" value={descriptive.cv === null ? '—' : `${fmt(descriptive.cv, 2)}%`} hint={`mediana ${fmt(descriptive.median)}`} icon={<FlaskConical className="h-5 w-5" />} tone={descriptive.cv !== null && descriptive.cv > 10 ? 'warning' : 'success'} />
            <Stat label="Veredito global" value={analysis.overallVerdict === 'pass' ? 'Conforme' : analysis.overallVerdict === 'fail' ? 'Não conforme' : analysis.overallVerdict === 'warning' ? 'Atenção' : 'Não avaliado'} hint={`${analysis.parameters.length} parâmetro(s)`} icon={<CheckCircle2 className="h-5 w-5" />} tone={analysis.overallVerdict === 'pass' ? 'success' : analysis.overallVerdict === 'fail' ? 'danger' : 'warning'} />
          </>
        )}
      </div>

      {uncertaintyDefinition ? (
        <Card>
          <CardHeader
            title="Orçamento de incerteza (GUM)"
            description="u_i = valor/divisor; u_c = √Σ(c_i·u_i)²; ν_eff por Welch–Satterthwaite; U = k·u_c."
            icon={<Sigma className="h-4 w-4" />}
            action={
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={addItem} disabled={locked}>
                  <Plus className="h-3.5 w-3.5" /> Fonte
                </Button>
                <Button variant="outline" size="sm" onClick={saveUncertainty} loading={savingUncertainty} disabled={locked}>
                  <Save className="h-3.5 w-3.5" /> Salvar orçamento
                </Button>
              </div>
            }
          />
          <CardBody className="space-y-3">
          {items.length === 0 ? (
            <Alert tone="info" title="Nenhuma fonte de incerteza">
              Sem orçamento, o parâmetro “{uncertaintyDefinition.label}” permanece não avaliado.
              Adicione fontes Tipo A (repetição) e Tipo B (certificados, especificações,
              experiência etc.).
            </Alert>
          ) : (
            <div className="table-wrap">
              <table className="data-table min-w-[980px]">
                <thead>
                  <tr>
                    <th>Fonte</th>
                    <th>Tipo</th>
                    <th>Distribuição</th>
                    <th className="text-right">Valor</th>
                    <th className="text-right">Divisor</th>
                    <th className="text-right">c_i</th>
                    <th className="text-right">u_i</th>
                    <th className="text-right">ν</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const divisor = item.divisor > 0 ? item.divisor : defaultDivisor(item.distribution);
                    return (
                      <tr key={item.id}>
                        <td className="min-w-[190px]">
                          <input
                            className="w-full rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs dark:border-ink-700 dark:bg-ink-900"
                            value={item.source}
                            disabled={locked}
                            placeholder="Ex.: calibração da balança"
                            onChange={(e) => patchItem(item.id, { source: e.target.value })}
                          />
                          <input
                            className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-500 dark:border-ink-700 dark:bg-ink-900"
                            value={item.notes}
                            disabled={locked}
                            placeholder="Nota / certificado"
                            onChange={(e) => patchItem(item.id, { notes: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            className="rounded-lg border border-ink-200 bg-white px-1.5 py-1 text-xs dark:border-ink-700 dark:bg-ink-900"
                            value={item.type}
                            disabled={locked}
                            onChange={(e) => patchItem(item.id, { type: e.target.value as UncertaintyType })}
                          >
                            <option value="A">A</option>
                            <option value="B">B</option>
                          </select>
                        </td>
                        <td>
                          <select
                            className="rounded-lg border border-ink-200 bg-white px-1.5 py-1 text-xs dark:border-ink-700 dark:bg-ink-900"
                            value={item.distribution}
                            disabled={locked}
                            onChange={(e) =>
                              patchItem(item.id, {
                                distribution: e.target.value as UncertaintyDistribution,
                              })
                            }
                          >
                            {Object.entries(DISTRIBUTION_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            step="any"
                            className="w-20 rounded-lg border border-ink-200 bg-white px-1.5 py-1 text-right text-xs dark:border-ink-700 dark:bg-ink-900"
                            value={item.value}
                            disabled={locked}
                            onChange={(e) => patchItem(item.id, { value: Number(e.target.value) })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="any"
                            className="w-20 rounded-lg border border-ink-200 bg-white px-1.5 py-1 text-right text-xs dark:border-ink-700 dark:bg-ink-900"
                            value={item.divisor}
                            disabled={locked}
                            onChange={(e) => patchItem(item.id, { divisor: Number(e.target.value) })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="any"
                            className="w-16 rounded-lg border border-ink-200 bg-white px-1.5 py-1 text-right text-xs dark:border-ink-700 dark:bg-ink-900"
                            value={item.sensitivity}
                            disabled={locked}
                            onChange={(e) => patchItem(item.id, { sensitivity: Number(e.target.value) })}
                          />
                        </td>
                        <td className="text-right font-mono text-xs">{fmt(item.value / divisor)}</td>
                        <td>
                          <input
                            type="number"
                            step="any"
                            className="w-16 rounded-lg border border-ink-200 bg-white px-1.5 py-1 text-right text-xs dark:border-ink-700 dark:bg-ink-900"
                            value={item.dof ?? ''}
                            disabled={locked}
                            placeholder="∞"
                            onChange={(e) => patchItem(item.id, { dof: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </td>
                        <td>
                          <Button variant="ghost" size="icon" disabled={locked} onClick={() => setItems((prev) => prev.filter((row) => row.id !== item.id))} title="Remover fonte">
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {items.length ? (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Resultado GUM</p>
                <p className="mt-1 font-mono text-xs leading-relaxed text-ink-700 dark:text-ink-200">
                  u_c = {fmt(uncertaintyPreview.combined)}
                  <br />
                  ν_eff = {uncertaintyPreview.effectiveDof === null ? '—' : uncertaintyPreview.effectiveDof.toFixed(2)}
                  <br />
                  k = {fmt(uncertaintyPreview.coverageFactor)}
                  <br />
                  U = {fmt(uncertaintyPreview.expanded)}
                </p>
              </div>
              <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800 lg:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Contribuições</p>
                <div className="mt-1 space-y-1">
                  {uncertaintyPreview.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-xs">
                      <span className="w-48 truncate text-ink-600 dark:text-ink-300" title={item.source}>
                        {item.source || '—'}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, item.percentContribution)}%` }} />
                      </div>
                      <span className="w-14 text-right font-mono text-[11px]">{item.percentContribution.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {uncertaintyPreview.warnings.length ? (
            <div className="space-y-1">
              {uncertaintyPreview.warnings.map((warning) => (
                <p key={warning} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}
                </p>
              ))}
            </div>
          ) : null}
          </CardBody>
        </Card>
      ) : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="section-title">Resultados por parâmetro</h3>
            <p className="muted">Cada tabela mostra a métrica, a fórmula, o critério cadastrado e o veredito.</p>
          </div>
          <Badge tone="outline">{analysis.parameters.length} parâmetro(s) selecionado(s)</Badge>
        </div>
        {analysis.parameters.length === 0 ? (
          <Alert tone="warning" title="Nenhum parâmetro selecionado">
            Volte à etapa de Parâmetros e selecione ao menos um parâmetro.
          </Alert>
        ) : (
          analysis.parameters.map((parameter) => (
            <ParameterResultCard key={parameter.key} analysis={parameter} />
          ))
        )}
      </div>

      {attribute ? (
        <Card>
          <CardHeader
            title="Diagnóstico do estudo de atributo"
            description="Itens, avaliadores, referências e concordância observada. Nenhuma classificação é removida automaticamente."
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <CardBody className="space-y-3">
            {attributeQc?.error ? (
              <Alert tone="danger" title="Estudo de atributo não avaliado">
                {attributeQc.error}
              </Alert>
            ) : null}
            {attributeData ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                    <p className="text-[10px] uppercase tracking-wide text-ink-400">Itens (amostras)</p>
                    <p className="font-mono text-lg">{attributeData.items.length}</p>
                  </div>
                  <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                    <p className="text-[10px] uppercase tracking-wide text-ink-400">Avaliadores</p>
                    <p className="font-mono text-lg">{attributeData.raters.length}</p>
                  </div>
                  <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                    <p className="text-[10px] uppercase tracking-wide text-ink-400">Categorias</p>
                    <p className="font-mono text-lg">{attributeData.categories.length}</p>
                  </div>
                  <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                    <p className="text-[10px] uppercase tracking-wide text-ink-400">Classificações válidas</p>
                    <p className="font-mono text-lg">{attributeData.validRows}</p>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Cobertura e referência</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-ink-500">Itens com referência</span>
                      <span className="font-mono">{attributeData.items.length - attributeData.itemsWithoutReference} / {attributeData.items.length}</span>
                      <span className="text-ink-500">Cobertura</span>
                      <span className="font-mono">{attributeStudy ? `${fmt(attributeStudy.referenceCoveragePct)}%` : '—'}</span>
                      <span className="text-ink-500">Sem referência</span>
                      <span className="font-mono">{attributeData.missingReference}</span>
                      <span className="text-ink-500">Referências conflitantes</span>
                      <span className="font-mono">{attributeData.referenceConflicts.length}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Qualidade dos registros</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-ink-500">Sem categoria</span>
                      <span className="font-mono">{attributeData.missingCategory}</span>
                      <span className="text-ink-500">Sem amostra</span>
                      <span className="font-mono">{attributeData.missingItem}</span>
                      <span className="text-ink-500">Sem avaliador</span>
                      <span className="font-mono">{attributeData.missingRater}</span>
                      <span className="text-ink-500">Duplicidades</span>
                      <span className="font-mono">{attributeData.duplicateCells}</span>
                      <span className="text-ink-500">Réplicas inválidas</span>
                      <span className="font-mono">{attributeData.invalidReplicates}</span>
                    </div>
                  </div>
                </div>
                {attributeStudy ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                      <p className="text-[10px] uppercase tracking-wide text-ink-400">κ interavaliadores</p>
                      <p className="font-mono text-lg">{fmt(attributeStudy.interRater.kappa)}</p>
                      <p className="text-[11px] text-ink-500">IC {fmt(attributeStudy.interRater.ciLow)}–{fmt(attributeStudy.interRater.ciHigh)}</p>
                    </div>
                    <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                      <p className="text-[10px] uppercase tracking-wide text-ink-400">Pior κ intra-avaliador</p>
                      <p className="font-mono text-lg">{fmt(worstIntra)}</p>
                      <p className="text-[11px] text-ink-500">{attributeStudy.intraRater.length} avaliador(es)</p>
                    </div>
                    <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                      <p className="text-[10px] uppercase tracking-wide text-ink-400">Pior κ com a referência</p>
                      <p className="font-mono text-lg">{fmt(worstReference)}</p>
                      <p className="text-[11px] text-ink-500">{attributeStudy.vsReference.length} avaliador(es)</p>
                    </div>
                  </div>
                ) : null}
                {attributeData.warnings.length ? (
                  <ul className="list-disc space-y-1 pl-4 text-xs text-ink-500">
                    {attributeData.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-ink-500">Sem dados de atributo mapeados.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {!attribute ? (
      <Card>
        <CardHeader
          title="Controle de qualidade dos dados"
          description="Testes exploratórios usados como diagnóstico; não substituem a decisão registrada."
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <CardBody className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Descritiva</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-ink-500">n</span><span className="font-mono">{descriptive.n}</span>
              <span className="text-ink-500">Média</span><span className="font-mono">{fmt(descriptive.mean)}</span>
              <span className="text-ink-500">s</span><span className="font-mono">{fmt(descriptive.sd)}</span>
              <span className="text-ink-500">CV</span><span className="font-mono">{descriptive.cv === null ? '—' : `${descriptive.cv.toFixed(2)}%`}</span>
              <span className="text-ink-500">Mín / máx</span><span className="font-mono">{fmt(descriptive.min)} / {fmt(descriptive.max)}</span>
              <span className="text-ink-500">Q1 / mediana / Q3</span><span className="font-mono">{fmt(descriptive.q1)} / {fmt(descriptive.median)} / {fmt(descriptive.q3)}</span>
              <span className="text-ink-500">Assimetria / curtose</span><span className="font-mono">{fmt(descriptive.skewness)} / {fmt(descriptive.kurtosis)}</span>
            </div>
          </div>

          <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Outliers (Grubbs bilateral)</p>
            {analysis.qc.outliers ? (
              <div className="mt-2 space-y-1 text-xs">
                <p className="font-mono">G = {fmt(analysis.qc.outliers.g)} (crítico {fmt(analysis.qc.outliers.gCrit)})</p>
                <p>p = {fmt(analysis.qc.outliers.pValue)}</p>
                <p className={analysis.qc.outliers.outlier ? 'font-medium text-rose-600' : 'font-medium text-emerald-700'}>
                  {analysis.qc.outliers.outlier
                    ? `Outlier(s) sinalizado(s): ${analysis.qc.outliers.flags.filter((flag) => flag.outlier).map((flag) => flag.value).join(', ')}`
                    : 'Nenhum outlier sinalizado.'}
                </p>
                <p className="text-ink-400">Nenhum ponto é removido automaticamente.</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-500">Dados insuficientes (n &lt; 3).</p>
            )}
          </div>

          <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Normalidade dos resíduos</p>
            {analysis.qc.normality ? (
              <div className="mt-2 space-y-1 text-xs">
                <p className="font-mono">{analysis.qc.normality.method}</p>
                <p className="font-mono">W = {fmt(analysis.qc.normality.statistic)}; p = {fmt(analysis.qc.normality.pValue)}</p>
                <p className={analysis.qc.normality.normal ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
                  {analysis.qc.normality.interpretation}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-500">Resíduos insuficientes.</p>
            )}
          </div>

          <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Homogeneidade de variâncias</p>
            {analysis.qc.homogeneity ? (
              <div className="mt-2 space-y-1 text-xs">
                <p className="font-mono">{analysis.qc.homogeneity.method}</p>
                <p className="font-mono">p = {fmt(analysis.qc.homogeneity.pValue)}</p>
                <p className={analysis.qc.homogeneity.homogeneous ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
                  {analysis.qc.homogeneity.interpretation}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-500">São necessários ao menos dois níveis com réplicas.</p>
            )}
          </div>

          {analysis.qc.anova ? (
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">ANOVA de um fator (nível)</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="text-left text-ink-500">
                      <th className="border-b border-ink-200 px-2 py-1">Fonte</th>
                      <th className="border-b border-ink-200 px-2 py-1 text-right">gl</th>
                      <th className="border-b border-ink-200 px-2 py-1 text-right">SQ</th>
                      <th className="border-b border-ink-200 px-2 py-1 text-right">QM</th>
                      <th className="border-b border-ink-200 px-2 py-1 text-right">F</th>
                      <th className="border-b border-ink-200 px-2 py-1 text-right">p</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.qc.anova.rows.map((row) => (
                      <tr key={row.source}>
                        <td className="border-b border-ink-100 px-2 py-1">{row.source}</td>
                        <td className="border-b border-ink-100 px-2 py-1 text-right font-mono">{row.df}</td>
                        <td className="border-b border-ink-100 px-2 py-1 text-right font-mono">{fmt(row.ss)}</td>
                        <td className="border-b border-ink-100 px-2 py-1 text-right font-mono">{fmt(row.ms)}</td>
                        <td className="border-b border-ink-100 px-2 py-1 text-right font-mono">{fmt(row.f)}</td>
                        <td className="border-b border-ink-100 px-2 py-1 text-right font-mono">{fmt(row.p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-ink-500">{analysis.qc.anova.interpretation}</p>
            </div>
          ) : null}

          {analysis.qc.iso5725 ? (
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">ISO 5725-2 — precisão entre laboratórios</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-5">
                <div><p className="text-[10px] uppercase text-ink-400">s_r</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.sr)}</p></div>
                <div><p className="text-[10px] uppercase text-ink-400">s_L</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.sL)}</p></div>
                <div><p className="text-[10px] uppercase text-ink-400">s_R</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.sR)}</p></div>
                <div><p className="text-[10px] uppercase text-ink-400">r</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.repeatabilityLimit)}</p></div>
                <div><p className="text-[10px] uppercase text-ink-400">R</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.reproducibilityLimit)}</p></div>
              </div>
              <p className="mt-2 text-[11px] text-ink-500">{analysis.qc.iso5725.interpretation}</p>
            </div>
          ) : null}

          {calibration ? (
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Regressão linear</p>
              <p className="mt-1 font-mono text-xs">
                y = {fmt(calibration.intercept)} + {fmt(calibration.slope)}·x · R² = {fmt(calibration.r2)} · s_yx = {fmt(calibration.syx)}
              </p>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                {analysis.qc.calibrationChart ? (
                  <ScatterPlot
                    data={analysis.qc.calibrationChart.data
                      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
                      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))}
                    xLabel={analysis.qc.calibrationChart.xLabel}
                    yLabel={analysis.qc.calibrationChart.yLabel}
                    height={210}
                  />
                ) : null}
                {analysis.qc.residualChart ? (
                  <ResidualPlot
                    data={analysis.qc.residualChart.data
                      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
                      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))}
                    height={210}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>
      ) : null}

      {!attribute ? (
      <Card>
        <CardHeader title="Por nível" description="Médias e dispersões observadas em cada nível." />
        <div className="max-h-[360px] overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nível</th>
                <th className="text-right">n</th>
                <th className="text-right">Média</th>
                <th className="text-right">s</th>
                <th className="text-right">CV</th>
                <th className="text-right">Mín</th>
                <th className="text-right">Máx</th>
              </tr>
            </thead>
            <tbody>
              {analysis.qc.byLevel.map((group) => (
                <tr key={group.group}>
                  <td className="font-medium">{group.group}</td>
                  <td className="text-right font-mono text-xs">{group.stats.n}</td>
                  <td className="text-right font-mono text-xs">{fmt(group.stats.mean)}</td>
                  <td className="text-right font-mono text-xs">{fmt(group.stats.sd)}</td>
                  <td className="text-right font-mono text-xs">{group.stats.cv === null ? '—' : `${group.stats.cv.toFixed(2)}%`}</td>
                  <td className="text-right font-mono text-xs">{fmt(group.stats.min)}</td>
                  <td className="text-right font-mono text-xs">{fmt(group.stats.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      ) : null}

      <Card>
        <CardHeader title="Pressupostos da análise" />
        <CardBody>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-500">
            {analysis.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </StepShell>
  );
}
