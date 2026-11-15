import { useState } from 'react';
import { BarChart3, HelpCircle } from 'lucide-react';
import type { ValidationAnalysis } from '../../../stats/analysis';
import type { HistogramResult, NormalProbabilityPlotResult } from '../../../stats/normality';
import type { AnalysisChart } from '../../../stats/analysis-types';
import { fmt } from '../../../stats/distributions';
import { mandelHCritical, mandelKCritical } from '../../../stats/iso5725';
import { Alert, Badge, Card, CardBody, CardHeader } from '../../../components/ui';
import {
  HistogramWithNormalCurveChart,
  MandelConsistencyPlotChart,
  NormalProbabilityPlotChart,
  ResidualPlot,
  ScatterPlot,
} from '../../../components/charts';
import {
  ExplainableDecisionDrawer,
  type ExplainableDecisionData,
} from '../../../components/ExplainableDecisionDrawer';

export function AnalysisQcTab({
  analysis,
  attribute,
  measurementValues,
  histogramResult,
  qqResult,
  outlierIndices,
  mandelCharts,
}: {
  analysis: ValidationAnalysis;
  attribute: boolean;
  measurementValues: number[];
  histogramResult: HistogramResult | null;
  qqResult: NormalProbabilityPlotResult | null;
  outlierIndices: Set<number>;
  mandelCharts: { hChart: AnalysisChart | null; kChart: AnalysisChart | null } | null;
}) {
  const [selectedDecision, setSelectedDecision] = useState<ExplainableDecisionData | null>(null);

  const descriptive = analysis.qc.descriptive;
  const calibration = analysis.qc.regression;
  const attributeQc = analysis.qc.attribute;
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
    <>
      {attribute ? (
        <Card>
          <CardHeader
            title="Diagnóstico do estudo de atributo"
            description="Itens, avaliadores, referências e concordância observada. Nenhuma classificação é removida automaticamente."
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <CardBody className="space-y-4">
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
            description="Testes exploratórios usados como diagnóstico estatístico; não substituem a decisão registrada."
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Outliers (Grubbs bilateral)</p>
                {analysis.qc.outliers ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDecision({
                        title: 'Teste de Outliers de Grubbs (ISO 5725-2 / ASTM E178)',
                        parameterLabel: 'Controle de Qualidade',
                        verdict: analysis.qc.outliers?.outlier ? 'warning' : 'pass',
                        formulaText: 'G = max |x_i - x̄| / s,   G_crítico = (n-1)/√n · √[ t²/(n-2+t²) ]',
                        observedValueText: `G = ${fmt(analysis.qc.outliers?.g)} (crítico = ${fmt(analysis.qc.outliers?.gCrit)})`,
                        criterionText: 'G ≤ G_crítico (α = 0,05, bilateral)',
                        stepByStepText: [
                          `n = ${descriptive.n}, média x̄ = ${fmt(descriptive.mean)}, desvio padrão s = ${fmt(descriptive.sd)}`,
                          `Maior desvio absoluto: |x_extremo - x̄|`,
                          `Estatística calculada G = ${fmt(analysis.qc.outliers?.g)}`,
                          `Limiar crítico de Grubbs G_crit = ${fmt(analysis.qc.outliers?.gCrit)} (p-valor = ${fmt(analysis.qc.outliers?.pValue)})`,
                          `Decisão: ${analysis.qc.outliers?.outlier ? 'Outlier detectado com p < 0,05' : 'Nenhum ponto ultrapassa G_crítico'}`,
                        ],
                        normativeReference: 'ISO 5725-2:2019 §7.3; ASTM E178-16a; Grubbs, F. E. (1969)',
                        interpretationText: analysis.qc.outliers?.outlier
                          ? 'Pelo menos um ponto foi sinalizado como inconsistente estatisticamente. Regra de ouro: nenhum ponto deve ser excluído sem causa técnica investigada e justificada.'
                          : 'A amostra não apresenta evidência estatística de valores discrepantes no nível de significância de 5%.',
                      })
                    }
                    className="rounded-lg p-1 text-ink-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/50 dark:hover:text-brand-300 transition"
                    title="Ver demonstração da decisão de Grubbs"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Normalidade dos resíduos</p>
                {analysis.qc.normality ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDecision({
                        title: `Teste de Normalidade (${analysis.qc.normality?.method})`,
                        parameterLabel: 'Controle de Qualidade',
                        verdict: analysis.qc.normality?.normal ? 'pass' : 'warning',
                        formulaText: 'H0: Dados seguem distribuição Normal vs H1: Distribuição não é normal',
                        observedValueText: `Estatística = ${fmt(analysis.qc.normality?.statistic)}, p = ${fmt(analysis.qc.normality?.pValue)}`,
                        criterionText: 'p-valor > 0,05 para não rejeitar H0 (Normalidade)',
                        stepByStepText: [
                          `Método aplicado: ${analysis.qc.normality?.method}`,
                          `Estatística de teste calculada: ${fmt(analysis.qc.normality?.statistic)}`,
                          `p-valor calculado: ${fmt(analysis.qc.normality?.pValue)}`,
                          `Conclusão do teste formal: ${analysis.qc.normality?.normal ? 'Compatível com a curva normal (p > 0,05)' : 'Desvio da normalidade detectado (p ≤ 0,05)'}`,
                        ],
                        normativeReference: analysis.qc.normality?.reference || 'Shapiro & Wilk (1965); Royston (1995); Anderson & Darling (1954)',
                        interpretationText: analysis.qc.normality?.interpretation || '',
                      })
                    }
                    className="rounded-lg p-1 text-ink-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/50 dark:hover:text-brand-300 transition"
                    title="Ver demonstração do teste de normalidade"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
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

            {/* Diagnóstico Visual de Normalidade e Frequência */}
            {measurementValues.length >= 3 && (histogramResult || qqResult) ? (
              <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-2 dark:border-ink-800">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Diagnóstico Visual de Normalidade e Frequência
                    </p>
                    <p className="text-[11px] text-ink-400">
                      Histograma com distribuição normal teórica N(x̄, s²) e Gráfico de Probabilidade Normal (Q-Q) com posições de Blom e bandas de confiança de 95%.
                    </p>
                  </div>
                  {analysis.qc.normality ? (
                    <Badge tone={analysis.qc.normality.normal ? 'success' : 'warning'}>
                      {analysis.qc.normality.normal
                        ? `Normal (${analysis.qc.normality.method.includes('Anderson') ? 'A*' : 'W'} = ${fmt(analysis.qc.normality.statistic)}, p = ${fmt(analysis.qc.normality.pValue)})`
                        : `Não normal (${analysis.qc.normality.method.includes('Anderson') ? 'A*' : 'W'} = ${fmt(analysis.qc.normality.statistic)}, p = ${fmt(analysis.qc.normality.pValue)})`}
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-2 rounded-lg bg-ink-50 p-2.5 text-[11px] text-ink-600 dark:bg-ink-900/60 dark:text-ink-300">
                  <p className="font-medium text-ink-700 dark:text-ink-200">Interpretação conjunta com testes formais (Shapiro-Wilk / Anderson-Darling):</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li>
                      <strong>Hipótese nula (H₀):</strong> Os dados seguem uma distribuição normal.
                    </li>
                    <li>
                      <strong>p-value &gt; 0,05:</strong> Não há evidência estatística para rejeitar a normalidade (os dados são compatíveis com a curva normal).
                    </li>
                    <li>
                      <strong>p-value &le; 0,05:</strong> Rejeita-se a normalidade (investigue desvios, assimetria, caudas pesadas ou outliers).
                    </li>
                    <li>
                      <strong>Gráfico de Probabilidade Normal:</strong> Se os pontos formarem uma linha reta dentro das bandas de confiança de 95%, a distribuição é normal. Pontos que se afastam ou fazem curvas nas extremidades indicam desvio de normalidade.
                    </li>
                  </ul>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {histogramResult ? (
                    <div className="rounded-lg border border-ink-100 p-2 dark:border-ink-800">
                      <HistogramWithNormalCurveChart result={histogramResult} height={240} />
                    </div>
                  ) : null}
                  {qqResult ? (
                    <div className="rounded-lg border border-ink-100 p-2 dark:border-ink-800">
                      <NormalProbabilityPlotChart result={qqResult} outlierIndices={outlierIndices} height={240} />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

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
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  ISO 5725-2 — precisão entre laboratórios / analistas e consistência de Mandel (h e k)
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-5">
                  <div><p className="text-[10px] uppercase text-ink-400">s_r</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.sr)}</p></div>
                  <div><p className="text-[10px] uppercase text-ink-400">s_L</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.sL)}</p></div>
                  <div><p className="text-[10px] uppercase text-ink-400">s_R</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.sR)}</p></div>
                  <div><p className="text-[10px] uppercase text-ink-400">r (2,8·s_r)</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.repeatabilityLimit)}</p></div>
                  <div><p className="text-[10px] uppercase text-ink-400">R (2,8·s_R)</p><p className="font-mono text-xs">{fmt(analysis.qc.iso5725.pooled.reproducibilityLimit)}</p></div>
                </div>
                <p className="mt-2 text-[11px] text-ink-500">{analysis.qc.iso5725.interpretation}</p>
                {analysis.qc.iso5725.levels.some((l) => l.labMeans.length > 0) ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="text-left text-ink-500">
                          <th className="border-b border-ink-200 px-2 py-1">Nível</th>
                          <th className="border-b border-ink-200 px-2 py-1">Lab / Analista</th>
                          <th className="border-b border-ink-200 px-2 py-1 text-right">Média</th>
                          <th className="border-b border-ink-200 px-2 py-1 text-right">DP</th>
                          <th className="border-b border-ink-200 px-2 py-1 text-right">Mandel h</th>
                          <th className="border-b border-ink-200 px-2 py-1 text-right">Mandel k</th>
                          <th className="border-b border-ink-200 px-2 py-1">Consistência</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.qc.iso5725.levels.flatMap((lvl) => {
                          const hCrit05 = lvl.p >= 3 ? mandelHCritical(lvl.p, 0.05) : null;
                          const hCrit01 = lvl.p >= 3 ? mandelHCritical(lvl.p, 0.01) : null;
                          const kCrit05 = lvl.p >= 2 && lvl.n >= 2 ? mandelKCritical(lvl.p, lvl.n, 0.05) : null;
                          const kCrit01 = lvl.p >= 2 && lvl.n >= 2 ? mandelKCritical(lvl.p, lvl.n, 0.01) : null;
                          return lvl.labMeans.map((lm) => {
                            const hOutlier = lm.hFlag || (hCrit01 !== null && Math.abs(lm.h) > hCrit01);
                            const hStraggler = !hOutlier && hCrit05 !== null && Math.abs(lm.h) > hCrit05;
                            const kOutlier = lm.kFlag || (kCrit01 !== null && lm.k > kCrit01);
                            const kStraggler = !kOutlier && kCrit05 !== null && lm.k > kCrit05;
                            const hasOutlier = hOutlier || kOutlier;
                            const hasStraggler = hStraggler || kStraggler;
                            const tags = [
                              hOutlier
                                ? `|h| > ${hCrit01 !== null ? fmt(hCrit01, 2) : '2'} (1%)`
                                : hStraggler && hCrit05 !== null
                                  ? `|h| > ${fmt(hCrit05, 2)} (5%)`
                                  : '',
                              kOutlier
                                ? `k > ${kCrit01 !== null ? fmt(kCrit01, 2) : '2'} (1%)`
                                : kStraggler && kCrit05 !== null
                                  ? `k > ${fmt(kCrit05, 2)} (5%)`
                                  : '',
                            ].filter(Boolean);
                            return (
                              <tr key={`${lvl.level}-${lm.lab}`}>
                                <td className="border-b border-ink-100 px-2 py-1">{lvl.level}</td>
                                <td className="border-b border-ink-100 px-2 py-1 font-medium">{lm.lab}</td>
                                <td className="border-b border-ink-100 px-2 py-1 text-right font-mono">{fmt(lm.mean)}</td>
                                <td className="border-b border-ink-100 px-2 py-1 text-right font-mono">{fmt(lm.sd)}</td>
                                <td
                                  className={`border-b border-ink-100 px-2 py-1 text-right font-mono ${
                                    hOutlier
                                      ? 'font-semibold text-rose-700 dark:text-rose-300'
                                      : hStraggler
                                        ? 'font-semibold text-amber-700 dark:text-amber-300'
                                        : ''
                                  }`}
                                >
                                  {fmt(lm.h)}
                                </td>
                                <td
                                  className={`border-b border-ink-100 px-2 py-1 text-right font-mono ${
                                    kOutlier
                                      ? 'font-semibold text-rose-700 dark:text-rose-300'
                                      : kStraggler
                                        ? 'font-semibold text-amber-700 dark:text-amber-300'
                                        : ''
                                  }`}
                                >
                                  {fmt(lm.k)}
                                </td>
                                <td className="border-b border-ink-100 px-2 py-1">
                                  {hasOutlier || hasStraggler ? (
                                    <Badge tone={hasOutlier ? 'danger' : 'warning'}>{tags.join(' · ')}</Badge>
                                  ) : (
                                    <Badge tone="success">Consistente</Badge>
                                  )}
                                </td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {analysis.qc.iso5725.warnings.length ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-amber-700 dark:text-amber-300">
                    {analysis.qc.iso5725.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                {mandelCharts ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-lg border border-ink-100 p-2 dark:border-ink-800">
                      <MandelConsistencyPlotChart chart={mandelCharts.hChart} height={220} />
                    </div>
                    <div className="rounded-lg border border-ink-100 p-2 dark:border-ink-800">
                      <MandelConsistencyPlotChart chart={mandelCharts.kChart} height={220} />
                    </div>
                  </div>
                ) : null}
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

      <ExplainableDecisionDrawer
        isOpen={Boolean(selectedDecision)}
        onClose={() => setSelectedDecision(null)}
        data={selectedDecision}
      />
    </>
  );
}
