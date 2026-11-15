import { useState } from 'react';
import { CheckCircle2, HelpCircle, Save } from 'lucide-react';
import type { ConformityRule, TargetUncertaintyResult, ConformityResult } from '../../../stats/conformity';
import { fmt } from '../../../stats/distributions';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  VerdictBadge,
} from '../../../components/ui';
import { ConformityDensityChartPlot } from '../../../components/charts';
import { ExplainableDecisionDrawer, type ExplainableDecisionData } from '../../../components/ExplainableDecisionDrawer';

export function AnalysisConformityTab({
  supportsConformityCard,
  locked,
  savingConformity,
  saveConformityConfig,
  conformityRule,
  setConformityRule,
  guardBandFactor,
  setGuardBandFactor,
  probabilityThreshold,
  setProbabilityThreshold,
  lslInput,
  setLslInput,
  uslInput,
  setUslInput,
  massFractionInput,
  setMassFractionInput,
  processVariationInput,
  setProcessVariationInput,
  individualLslInput,
  setIndividualLslInput,
  toleranceProfile,
  unit,
  targetUncertaintyPreview,
  conformityPreview,
  conformityDensityData,
}: {
  supportsConformityCard: boolean;
  locked: boolean;
  savingConformity: boolean;
  saveConformityConfig: () => void;
  conformityRule: ConformityRule;
  setConformityRule: (rule: ConformityRule) => void;
  guardBandFactor: number;
  setGuardBandFactor: (factor: number) => void;
  probabilityThreshold: number;
  setProbabilityThreshold: (thresh: number) => void;
  lslInput: string;
  setLslInput: (val: string) => void;
  uslInput: string;
  setUslInput: (val: string) => void;
  massFractionInput: string;
  setMassFractionInput: (val: string) => void;
  processVariationInput: string;
  setProcessVariationInput: (val: string) => void;
  individualLslInput: string;
  setIndividualLslInput: (val: string) => void;
  toleranceProfile: boolean;
  unit: string;
  targetUncertaintyPreview: TargetUncertaintyResult | null;
  conformityPreview: ConformityResult | null;
  conformityDensityData: Array<{ x: number; density: number; postDensity?: number }> | null;
}) {
  const [selectedDecision, setSelectedDecision] = useState<ExplainableDecisionData | null>(null);

  if (!supportsConformityCard) {
    return (
      <Alert tone="info" title="Não aplicável">
        O perfil de atributo não utiliza limites numéricos de especificação (LSL/USL).
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Parâmetros de Conformidade, Incerteza-Alvo e Regra de Decisão (Eurachem 2015/2021 · ILAC G8)"
          description="Configure a regra de decisão, banda de guarda, limites de especificação (LSL/USL), fração mássica e verificação de limites."
          icon={<CheckCircle2 className="h-4 w-4" />}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={saveConformityConfig}
              loading={savingConformity}
              disabled={locked}
            >
              <Save className="h-3.5 w-3.5" /> Salvar regra
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Field label="Regra de decisão" className="lg:col-span-2">
              <Select
                value={conformityRule}
                disabled={locked}
                onChange={(e) => setConformityRule(e.target.value as ConformityRule)}
              >
                <option value="simple_acceptance">Aceitação simples (risco compartilhado)</option>
                <option value="guard_band">Banda de guarda (w = g · U)</option>
                <option value="probability_threshold">
                  Limiar de probabilidade P(conforme) ≥ p*
                </option>
              </Select>
            </Field>

            {conformityRule === 'guard_band' ? (
              <Input
                label="Fator g (banda de guarda)"
                type="number"
                step="any"
                min="0"
                disabled={locked}
                value={guardBandFactor}
                onChange={(e) => setGuardBandFactor(Number(e.target.value))}
                hint="Típico: g = 1 (w = U, ILAC G8 / Eurachem)"
              />
            ) : conformityRule === 'probability' ? (
              <Input
                label="Limiar p* (0 a 1)"
                type="number"
                step="any"
                min="0.5"
                max="0.999"
                disabled={locked}
                value={probabilityThreshold}
                onChange={(e) => setProbabilityThreshold(Number(e.target.value))}
                hint="Típico: 0,95 (95% de probabilidade)"
              />
            ) : null}

            <Input
              label={`LSL (${unit || 'unid.'})`}
              type="number"
              step="any"
              disabled={locked}
              value={lslInput}
              onChange={(e) => setLslInput(e.target.value)}
              placeholder="Ex.: 95"
              hint="Limite inferior de espec."
            />
            <Input
              label={`USL (${unit || 'unid.'})`}
              type="number"
              step="any"
              disabled={locked}
              value={uslInput}
              onChange={(e) => setUslInput(e.target.value)}
              placeholder="Ex.: 105"
              hint="Limite superior de espec."
            />
            <Input
              label="Fração mássica C (Horwitz)"
              type="number"
              step="any"
              min="0"
              disabled={locked}
              value={massFractionInput}
              onChange={(e) => setMassFractionInput(e.target.value)}
              placeholder="Ex.: 0,01 ou 1e-6"
              hint="Opcional: 1% = 0,01; 1 ppm = 1e-6"
            />
          </div>

          {toleranceProfile ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                label={`Variação do processo 6σ_p (${unit || 'unid.'})`}
                type="number"
                step="any"
                disabled={locked}
                value={processVariationInput}
                onChange={(e) => setProcessVariationInput(e.target.value)}
                placeholder="Automático (6·s)"
                hint="Vazio = inferido da coleta"
              />
              <Input
                label={`LSL individual (${unit || 'unid.'})`}
                type="number"
                step="any"
                disabled={locked}
                value={individualLslInput}
                onChange={(e) => setIndividualLslInput(e.target.value)}
                placeholder="Ex.: 13,4"
                hint="Mín. por amostra (compendial)"
              />
            </div>
          ) : null}

          {targetUncertaintyPreview || conformityPreview ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {targetUncertaintyPreview ? (
                <div className="rounded-xl border border-ink-200 p-3 text-xs dark:border-ink-800">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold uppercase tracking-wide text-ink-500">
                      Incerteza-Alvo (Eurachem 2015)
                    </p>
                    {targetUncertaintyPreview.meetsStrictSpec !== null ? (
                      <Badge
                        tone={
                          targetUncertaintyPreview.meetsStrictSpec
                            ? 'success'
                            : targetUncertaintyPreview.meetsModerateSpec
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {targetUncertaintyPreview.meetsStrictSpec
                          ? 'U ≤ T/8 (Rigoroso)'
                          : targetUncertaintyPreview.meetsModerateSpec
                            ? 'U ≤ T/4 (Moderado)'
                            : 'Excede U^tg (T/4)'}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1.5 space-y-1 font-mono text-ink-700 dark:text-ink-200">
                    {targetUncertaintyPreview.tolerance !== null ? (
                      <p>
                        T = {fmt(targetUncertaintyPreview.tolerance)} · U^tg moderada (T/4) ={' '}
                        {fmt(targetUncertaintyPreview.expandedTargetSpecModerate)} · U^tg rigorosa (T/8, TUR ≥ 4) ={' '}
                        {fmt(targetUncertaintyPreview.expandedTargetSpecStrict)}
                      </p>
                    ) : null}
                    {targetUncertaintyPreview.horwitzSigma !== null ? (
                      <p>
                        Horwitz–Thompson: σ_H = {fmt(targetUncertaintyPreview.horwitzSigma)} (RSD_H ={' '}
                        {targetUncertaintyPreview.horwitzRsdPct?.toFixed(2)}%)
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {conformityPreview ? (
                <div className="rounded-xl border border-ink-200 p-3 text-xs dark:border-ink-800">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold uppercase tracking-wide text-ink-500">
                      Conformidade e Banda de Guarda (Eurachem 2021)
                    </p>
                    <div className="flex items-center gap-1.5">
                      <VerdictBadge verdict={conformityPreview.verdict} />
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDecision({
                            title: 'Declaração de Conformidade & Risco',
                            parameterLabel: 'Regra de Decisão Eurachem 2021 / ILAC G8',
                            verdict: conformityPreview.verdict,
                            formulaText:
                              conformityRule === 'guard_band'
                                ? 'w = g · U,   Zona de Aceitação = [LSL + w, USL - w]'
                                : conformityRule === 'probability'
                                  ? 'P(LSL ≤ Y ≤ USL | x) ≥ p*'
                                  : 'LSL ≤ x̄ ≤ USL  (Aceitação simples)',
                            observedValueText: `x̄ = ${fmt(conformityPreview.value)} ${unit || ''},  U = ${fmt(conformityPreview.expandedUncertainty)}`,
                            criterionText: conformityPreview.criteriaText || `Regra: ${conformityRule}`,
                            stepByStepText: [
                              `Média observada x̄ = ${fmt(conformityPreview.value)}`,
                              `Incerteza expandida U = ${fmt(conformityPreview.expandedUncertainty)} (k = ${conformityPreview.coverageFactor})`,
                              `Banda de guarda w = ${fmt(conformityPreview.guardBand)}`,
                              `Limites efetivos aceitação: [${fmt(conformityPreview.effectiveLower)}; ${fmt(conformityPreview.effectiveUpper)}]`,
                              `Probabilidade de conformidade P = ${((conformityPreview.probabilityConform ?? 0) * 100).toFixed(2)}%`,
                              `Risco de falso aceite = ${((conformityPreview.falseAcceptRisk ?? 0) * 100).toFixed(2)}%`,
                            ],
                            normativeReference:
                              'Eurachem / CITAC Guide: Use of uncertainty information in compliance assessment (2021); ILAC-G8:09/2019; JCGM 106:2012',
                            interpretationText:
                              conformityPreview.verdict === 'pass'
                                ? `O resultado x̄ = ${fmt(conformityPreview.value)} situa-se inteiramente dentro dos limites com banda de guarda, garantindo risco controlado de falso aceite (< 5%).`
                                : conformityPreview.verdict === 'fail'
                                  ? `O resultado x̄ = ${fmt(conformityPreview.value)} ultrapassa os limites aceitáveis. Não é possível declarar conformidade sob a regra selecionada.`
                                  : `O resultado x̄ = ${fmt(conformityPreview.value)} encontra-se na zona de guarda indeterminada. O veredito requer avaliação de risco ou redução da incerteza.`,
                          })
                        }
                        className="rounded-lg p-1 text-ink-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/50 dark:hover:text-brand-300 transition"
                        title="Ver demonstração da decisão de conformidade"
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 space-y-1 font-mono text-ink-700 dark:text-ink-200">
                    <p>
                      x̄ = {fmt(conformityPreview.value)} · U = {fmt(conformityPreview.expandedUncertainty)} · w ={' '}
                      {fmt(conformityPreview.guardBand)} · limites efetivos [{fmt(conformityPreview.effectiveLower)};{' '}
                      {fmt(conformityPreview.effectiveUpper)}]
                    </p>
                    <p>
                      P(conformidade|x) = {((conformityPreview.probabilityConform ?? 0) * 100).toFixed(2)}% · Risco falso aceite ={' '}
                      {((conformityPreview.falseAcceptRisk ?? 0) * 100).toFixed(2)}%
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {conformityPreview && conformityDensityData ? (
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Distribuição de Probabilidade e Zonas de Decisão (JCGM 106 · Eurachem 2021)
              </p>
              <div className="mt-2">
                <ConformityDensityChartPlot
                  data={conformityDensityData}
                  result={conformityPreview}
                  height={230}
                />
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <ExplainableDecisionDrawer
        isOpen={Boolean(selectedDecision)}
        onClose={() => setSelectedDecision(null)}
        data={selectedDecision}
      />
    </>
  );
}
