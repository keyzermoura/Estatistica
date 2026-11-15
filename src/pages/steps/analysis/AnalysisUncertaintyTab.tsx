import type { Dispatch, SetStateAction } from 'react';
import { Info, Plus, Save, Sigma, Trash2 } from 'lucide-react';
import type {
  UncertaintyDistribution,
  UncertaintyItem,
  UncertaintyType,
} from '../../../lib/types';
import type { UncertaintyResult } from '../../../stats/uncertainty';
import { defaultDivisor } from '../../../stats/uncertainty';
import type { MonteCarloResult } from '../../../stats/monteCarlo';
import { fmt } from '../../../stats/distributions';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input } from '../../../components/ui';

const DISTRIBUTION_LABELS: Record<UncertaintyDistribution, string> = {
  normal: 'Normal',
  rectangular: 'Retangular',
  triangular: 'Triangular',
  u_shaped: 'Forma U',
  none: 'Sem distribuição',
};

export function AnalysisUncertaintyTab({
  items,
  locked,
  uncertaintyDefinition,
  toleranceProfile,
  profileId,
  uncertaintyPreview,
  mcResult,
  mcTrials,
  setMcTrials,
  mcSeed,
  setMcSeed,
  measurandExpr,
  setMeasurandExpr,
  nominalEstimates,
  setNominalEstimates,
  patchItem,
  addItem,
  removeItem,
  saveUncertainty,
  savingUncertainty,
  loadProfileModelBudget,
  synthesizeTopDown,
  applySymbolicDerivatives,
  runMonteCarlo,
}: {
  items: UncertaintyItem[];
  locked: boolean;
  uncertaintyDefinition?: { label: string };
  toleranceProfile: boolean;
  profileId: string;
  uncertaintyPreview: UncertaintyResult;
  mcResult: MonteCarloResult | null;
  mcTrials: number;
  setMcTrials: Dispatch<SetStateAction<number>>;
  mcSeed: number;
  setMcSeed: Dispatch<SetStateAction<number>>;
  measurandExpr: string;
  setMeasurandExpr: Dispatch<SetStateAction<string>>;
  nominalEstimates: Record<string, string>;
  setNominalEstimates: Dispatch<SetStateAction<Record<string, string>>>;
  patchItem: (id: string, patch: Partial<UncertaintyItem>) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  saveUncertainty: () => void;
  savingUncertainty: boolean;
  loadProfileModelBudget: () => void;
  synthesizeTopDown: () => void;
  applySymbolicDerivatives: () => void;
  runMonteCarlo: () => void;
}) {
  if (!uncertaintyDefinition) {
    return (
      <Alert tone="info" title="Sem orçamento de incerteza">
        O método ativo não prevê avaliação de incerteza de medição.
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Orçamento de incerteza (GUM)"
        description="u_i = valor/divisor; u_c = √Σ(c_i·u_i)²; ν_eff por Welch–Satterthwaite; U = k·u_c."
        icon={<Sigma className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap gap-1.5">
            {toleranceProfile ? (
              <Button
                variant="outline"
                size="sm"
                onClick={loadProfileModelBudget}
                disabled={locked}
                title="Carregar fontes típicas editáveis do perfil dimensional ou físico (resolução, calibração, repetibilidade, reprodutibilidade, condições)"
              >
                <Sigma className="h-3.5 w-3.5" /> Orçamento-modelo (
                {profileId === 'dimensional' ? 'Dimensional' : 'Físico'})
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={synthesizeTopDown}
              disabled={locked}
              title="Gerar fontes u(Rw) + u(bias) da precisão intermediária e exatidão (Eurachem 2026 / ISO 11352)"
            >
              <Sigma className="h-3.5 w-3.5" /> Sintetizar Top-Down (Eurachem)
            </Button>
            <Button variant="outline" size="sm" onClick={addItem} disabled={locked}>
              <Plus className="h-3.5 w-3.5" /> Fonte
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={saveUncertainty}
              loading={savingUncertainty}
              disabled={locked}
            >
              <Save className="h-3.5 w-3.5" /> Salvar orçamento
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-4">
        {items.length === 0 ? (
          <Alert tone="info" title="Nenhuma fonte de incerteza">
            Sem orçamento, o parâmetro “{uncertaintyDefinition.label}” permanece não avaliado.
            Adicione fontes Tipo A (repetição) e Tipo B (certificados, especificações, experiência
            etc.).
          </Alert>
        ) : (
          <div className="table-wrap">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Var.</th>
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
                {items.map((item, idx) => {
                  const divisor =
                    item.divisor > 0 ? item.divisor : defaultDivisor(item.distribution);
                  return (
                    <tr key={item.id}>
                      <td className="font-mono text-[11px] font-semibold text-brand-700 dark:text-brand-300">
                        {`X${idx + 1}`}
                      </td>
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
                          onChange={(e) =>
                            patchItem(item.id, { type: e.target.value as UncertaintyType })
                          }
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
                            <option key={value} value={value}>
                              {label}
                            </option>
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
                          onChange={(e) =>
                            patchItem(item.id, { sensitivity: Number(e.target.value) })
                          }
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
                          onChange={(e) =>
                            patchItem(item.id, {
                              dof: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={locked}
                          onClick={() => removeItem(item.id)}
                          title="Remover fonte"
                        >
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
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Resultado GUM
              </p>
              <p className="mt-1 font-mono text-xs leading-relaxed text-ink-700 dark:text-ink-200">
                u_c = {fmt(uncertaintyPreview.combined)}
                <br />
                ν_eff ={' '}
                {uncertaintyPreview.effectiveDof === null
                  ? '—'
                  : uncertaintyPreview.effectiveDof.toFixed(2)}
                <br />
                k = {fmt(uncertaintyPreview.coverageFactor)}
                <br />
                U = {fmt(uncertaintyPreview.expanded)}
              </p>
            </div>
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Contribuições
              </p>
              <div className="mt-1 space-y-1">
                {uncertaintyPreview.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-48 truncate text-ink-600 dark:text-ink-300"
                      title={item.source}
                    >
                      {item.source || '—'}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.min(100, item.percentContribution)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right font-mono text-[11px]">
                      {item.percentContribution.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {uncertaintyPreview.warnings.length ? (
          <div className="space-y-1">
            {uncertaintyPreview.warnings.map((warning) => (
              <p
                key={warning}
                className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}
              </p>
            ))}
          </div>
        ) : null}

        {items.length ? (
          <div className="space-y-3 rounded-xl border border-ink-200 p-3 dark:border-ink-800">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-[260px] flex-1">
                <Input
                  label="Equação do Mensurando Y = f(X1, X2, ...) — opcional"
                  placeholder="Ex.: X1 + X2 ou X1 / (0.25 * pi * X2^2)"
                  value={measurandExpr}
                  disabled={locked}
                  onChange={(e) => setMeasurandExpr(e.target.value)}
                  hint="Use X1, X2, ... conforme a coluna Var. para derivadas automáticas (c_i = ∂Y/∂X_i) e Monte Carlo não linear."
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={applySymbolicDerivatives}
                disabled={locked || !measurandExpr.trim()}
              >
                <Sigma className="h-3.5 w-3.5" /> Calcular c_i (∂Y/∂X_i)
              </Button>
            </div>
            {measurandExpr.trim() ? (
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {items.map((item, idx) => {
                  const varKey = `X${idx + 1}`;
                  return (
                    <Input
                      key={item.id}
                      label={`${varKey} nominal`}
                      type="number"
                      step="any"
                      placeholder="1"
                      value={nominalEstimates[varKey] ?? '1'}
                      disabled={locked}
                      onChange={(e) =>
                        setNominalEstimates((prev) => ({
                          ...prev,
                          [varKey]: e.target.value,
                        }))
                      }
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {items.length ? (
          <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Validação por Monte Carlo (JCGM 101 / GUM Supl. 1)
                </p>
                <p className="text-xs text-ink-500">
                  Propagação de distribuições empíricas via pseudorandom com semente fixada.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Iterações Monte Carlo"
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs dark:border-ink-700 dark:bg-ink-900"
                  value={mcTrials}
                  onChange={(e) => setMcTrials(Number(e.target.value))}
                >
                  <option value={20000}>20.000 iterações</option>
                  <option value={50000}>50.000 iterações</option>
                  <option value={100000}>100.000 iterações</option>
                </select>
                <input
                  aria-label="Semente Monte Carlo"
                  type="number"
                  className="w-24 rounded-lg border border-ink-200 bg-white px-2 py-1 text-right text-xs dark:border-ink-700 dark:bg-ink-900"
                  value={mcSeed}
                  onChange={(e) => setMcSeed(Number(e.target.value) || 17025)}
                  title="Semente PRNG"
                />
                <Button size="sm" variant="outline" onClick={runMonteCarlo}>
                  <Sigma className="h-3.5 w-3.5" /> Simular Monte Carlo
                </Button>
              </div>
            </div>

            {mcResult ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg bg-ink-50 p-2.5 text-xs dark:bg-ink-900/60">
                  <span className="text-ink-500">u_c (Monte Carlo)</span>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-ink-900 dark:text-ink-100">
                    {fmt(mcResult.standardUncertainty)}
                  </p>
                  <span className="text-[11px] text-ink-500">
                    GUM: {fmt(mcResult.gumCombinedUncertainty)}
                  </span>
                </div>
                <div className="rounded-lg bg-ink-50 p-2.5 text-xs dark:bg-ink-900/60">
                  <span className="text-ink-500">Intervalo de menor amplitude (95%)</span>
                  <p className="mt-0.5 font-mono text-xs font-semibold text-ink-900 dark:text-ink-100">
                    [{fmt(mcResult.shortestInterval[0])}; {fmt(mcResult.shortestInterval[1])}]
                  </p>
                  <span className="text-[11px] text-ink-500">
                    U_MC = {fmt((mcResult.shortestInterval[1] - mcResult.shortestInterval[0]) / 2)}
                  </span>
                </div>
                <div className="rounded-lg bg-ink-50 p-2.5 text-xs dark:bg-ink-900/60">
                  <span className="text-ink-500">Intervalo simétrico (95%)</span>
                  <p className="mt-0.5 font-mono text-xs font-semibold text-ink-900 dark:text-ink-100">
                    [{fmt(mcResult.symmetricInterval[0])}; {fmt(mcResult.symmetricInterval[1])}]
                  </p>
                  <span className="text-[11px] text-ink-500">
                    M = {mcResult.trials.toLocaleString('pt-BR')} · seed {mcResult.seed}
                  </span>
                </div>
                <div className="flex flex-col justify-between rounded-lg bg-ink-50 p-2.5 text-xs dark:bg-ink-900/60">
                  <span className="text-ink-500">Validação GUM (§8 JCGM 101)</span>
                  <div className="mt-1">
                    <Badge tone={mcResult.gumCompatible ? 'success' : 'warning'}>
                      {mcResult.gumCompatible ? 'Compatível com GUM' : 'Divergência detectada'}
                    </Badge>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
