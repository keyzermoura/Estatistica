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
import type {
  ReportConfig,
  UncertaintyDistribution,
  UncertaintyItem,
  UncertaintyType,
} from '../../lib/types';
import { clearAnalyses, replaceUncertainty, saveAnalysis, updateValidation } from '../../lib/repository';
import { getProfileForMethod } from '../../profiles/index';
import { resolveCriteria } from '../../lib/criteria';
import {
  computeTopDownUncertainty,
  computeUncertainty,
  defaultDivisor,
} from '../../stats/uncertainty';
import { dimensionalUncertaintyBudget } from '../../stats/parameters/dimensional';
import { physicalUncertaintyBudget } from '../../stats/parameters/physical';
import {
  buildConformityDensityData,
  computeTargetUncertainty,
  conformityDecision,
} from '../../stats/conformity';
import { referenceOf } from '../../stats/analysis-utils';
import {
  numericalSensitivity,
  runMonteCarloUncertainty,
  type MonteCarloResult,
  type MonteCarloVariableInput,
} from '../../stats/monteCarlo';
import { fmt } from '../../stats/distributions';
import { buildMandelCharts, mandelHCritical, mandelKCritical } from '../../stats/iso5725';
import {
  computeHistogramWithNormalCurve,
  computeNormalProbabilityPlot,
} from '../../stats/normality';
import { objectHash, uid } from '../../lib/utils';
import { ParameterResultCard } from '../../components/ParameterResultCard';
import {
  ConformityDensityChartPlot,
  HistogramWithNormalCurveChart,
  MandelConsistencyPlotChart,
  NormalProbabilityPlotChart,
  ResidualPlot,
  ScatterPlot,
} from '../../components/charts';
import { StepShell } from '../../components/wizard';
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
  const toleranceProfile =
    profile.id === 'dimensional' ||
    profile.id === 'physical-destructive' ||
    profile.id === 'physical-nondestructive';
  const supportsConformityCard = !attribute;
  const attributeQc = analysis.qc.attribute;
  const uncertaintyDefinition = profile.parameters.find((parameter) => parameter.key === 'uncertainty');
  const [items, setItems] = useState<UncertaintyItem[]>(bundle.uncertainty);
  const [savingUncertainty, setSavingUncertainty] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [conformityRule, setConformityRule] = useState<NonNullable<ReportConfig['conformityRule']>>(
    bundle.validation.reportConfig.conformityRule ?? 'guard_band',
  );
  const [guardBandFactor, setGuardBandFactor] = useState<number>(
    bundle.validation.reportConfig.guardBandFactor ?? 1,
  );
  const [probabilityThreshold, setProbabilityThreshold] = useState<number>(
    bundle.validation.reportConfig.probabilityThreshold ?? 0.95,
  );
  const [processVariationInput, setProcessVariationInput] = useState<string>(
    bundle.validation.reportConfig.processVariation !== null &&
      bundle.validation.reportConfig.processVariation !== undefined
      ? String(bundle.validation.reportConfig.processVariation)
      : '',
  );
  const [individualLslInput, setIndividualLslInput] = useState<string>(
    bundle.validation.reportConfig.individualLsl !== null &&
      bundle.validation.reportConfig.individualLsl !== undefined
      ? String(bundle.validation.reportConfig.individualLsl)
      : '',
  );
  const [lslInput, setLslInput] = useState<string>(
    bundle.method.lsl !== null && bundle.method.lsl !== undefined
      ? String(bundle.method.lsl)
      : bundle.validation.reportConfig.individualLsl !== null &&
          bundle.validation.reportConfig.individualLsl !== undefined
        ? String(bundle.validation.reportConfig.individualLsl)
        : '',
  );
  const [uslInput, setUslInput] = useState<string>(
    bundle.method.usl !== null && bundle.method.usl !== undefined
      ? String(bundle.method.usl)
      : '',
  );
  const [massFractionInput, setMassFractionInput] = useState<string>('');
  const [savingConformity, setSavingConformity] = useState(false);
  const [mcTrials, setMcTrials] = useState(20000);
  const [mcSeed, setMcSeed] = useState(17025);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [measurandExpr, setMeasurandExpr] = useState('');
  const [nominalEstimates, setNominalEstimates] = useState<Record<string, string>>({});

  useEffect(() => {
    setItems(bundle.uncertainty);
  }, [bundle.uncertainty]);

  useEffect(() => {
    setConformityRule(bundle.validation.reportConfig.conformityRule ?? 'guard_band');
    setGuardBandFactor(bundle.validation.reportConfig.guardBandFactor ?? 1);
    setProbabilityThreshold(bundle.validation.reportConfig.probabilityThreshold ?? 0.95);
    setProcessVariationInput(
      bundle.validation.reportConfig.processVariation !== null &&
        bundle.validation.reportConfig.processVariation !== undefined
        ? String(bundle.validation.reportConfig.processVariation)
        : '',
    );
    setIndividualLslInput(
      bundle.validation.reportConfig.individualLsl !== null &&
        bundle.validation.reportConfig.individualLsl !== undefined
        ? String(bundle.validation.reportConfig.individualLsl)
        : '',
    );
    setLslInput(
      bundle.method.lsl !== null && bundle.method.lsl !== undefined
        ? String(bundle.method.lsl)
        : bundle.validation.reportConfig.individualLsl !== null &&
            bundle.validation.reportConfig.individualLsl !== undefined
          ? String(bundle.validation.reportConfig.individualLsl)
          : '',
    );
    setUslInput(
      bundle.method.usl !== null && bundle.method.usl !== undefined
        ? String(bundle.method.usl)
        : '',
    );
  }, [bundle.validation.reportConfig, bundle.method.lsl, bundle.method.usl]);

  const saveConformityConfig = () => {
    if (locked) return;
    if (!Number.isFinite(guardBandFactor) || guardBandFactor < 0) {
      toast.push('O fator de banda de guarda (r) deve ser ≥ 0.', 'danger');
      return;
    }
    if (!Number.isFinite(probabilityThreshold) || probabilityThreshold <= 0 || probabilityThreshold >= 1) {
      toast.push('O limiar de probabilidade deve estar entre 0 e 1 (ex.: 0,95).', 'danger');
      return;
    }
    const pv = processVariationInput.trim() === '' ? null : Number(processVariationInput);
    if (pv !== null && (!Number.isFinite(pv) || pv <= 0)) {
      toast.push('A variação do processo (6σ_p) deve ser um número positivo.', 'danger');
      return;
    }
    const indLsl = individualLslInput.trim() === '' ? null : Number(individualLslInput);
    if (indLsl !== null && !Number.isFinite(indLsl)) {
      toast.push('O LSL individual deve ser um número válido.', 'danger');
      return;
    }
    setSavingConformity(true);
    try {
      const actor = bundle.validation.responsible.trim() || 'sistema';
      updateValidation(
        {
          ...bundle.validation,
          reportConfig: {
            ...bundle.validation.reportConfig,
            conformityRule,
            guardBandFactor,
            probabilityThreshold,
            processVariation: pv,
            individualLsl: indLsl,
          },
        },
        actor,
        'Parâmetros de conformidade e processo',
      );
      toast.push('Parâmetros de conformidade salvos.');
      reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao salvar configuração.', 'danger');
    } finally {
      setSavingConformity(false);
    }
  };

  const uncertaintyPreview = useMemo(
    () => computeUncertainty(items.map((item) => ({ ...item, id: item.id }))),
    [items],
  );

  const parsedLsl = useMemo(() => {
    if (lslInput.trim() === '') return null;
    const n = Number(lslInput);
    return Number.isFinite(n) ? n : null;
  }, [lslInput]);

  const parsedUsl = useMemo(() => {
    if (uslInput.trim() === '') return null;
    const n = Number(uslInput);
    return Number.isFinite(n) ? n : null;
  }, [uslInput]);

  const parsedMassFraction = useMemo(() => {
    if (massFractionInput.trim() === '') return null;
    const n = Number(massFractionInput);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [massFractionInput]);

  const targetUncertaintyPreview = useMemo(() => {
    const currentU = items.length ? uncertaintyPreview.expanded : null;
    if (parsedLsl === null && parsedUsl === null && parsedMassFraction === null) {
      return null;
    }
    return computeTargetUncertainty({
      lsl: parsedLsl,
      usl: parsedUsl,
      massFraction: parsedMassFraction,
      coverageFactor: items.length ? uncertaintyPreview.coverageFactor : 2,
      currentExpandedUncertainty: currentU,
    });
  }, [parsedLsl, parsedUsl, parsedMassFraction, items.length, uncertaintyPreview.expanded, uncertaintyPreview.coverageFactor]);

  const conformityPreview = useMemo(() => {
    const xVal = analysis.qc.descriptive.mean;
    if (xVal === null || !Number.isFinite(xVal)) return null;
    if (parsedLsl === null && parsedUsl === null) return null;
    if (parsedLsl !== null && parsedUsl !== null && parsedLsl >= parsedUsl) return null;
    const stdU = items.length
      ? uncertaintyPreview.combined
      : (analysis.qc.descriptive.sd ?? 0);
    const covK = items.length ? uncertaintyPreview.coverageFactor : 2;
    try {
      return conformityDecision(
        {
          value: xVal,
          standardUncertainty: stdU,
          coverageFactor: covK,
          lsl: parsedLsl,
          usl: parsedUsl,
          rule: conformityRule,
          guardBandFactor,
          probabilityThreshold,
        },
        { unit: bundle.method.unit },
      );
    } catch {
      return null;
    }
  }, [
    analysis.qc.descriptive.mean,
    analysis.qc.descriptive.sd,
    parsedLsl,
    parsedUsl,
    items.length,
    uncertaintyPreview.combined,
    uncertaintyPreview.coverageFactor,
    conformityRule,
    guardBandFactor,
    probabilityThreshold,
    bundle.method.unit,
  ]);

  const conformityDensityData = useMemo(() => {
    if (!conformityPreview) return null;
    return buildConformityDensityData(conformityPreview);
  }, [conformityPreview]);

  const measurementValues = useMemo(() => {
    return bundle.measurements
      .map((m) => m.value)
      .filter((v): v is number => v !== null && Number.isFinite(v));
  }, [bundle.measurements]);

  const histogramResult = useMemo(() => {
    if (measurementValues.length < 3) return null;
    return computeHistogramWithNormalCurve(measurementValues);
  }, [measurementValues]);

  const qqResult = useMemo(() => {
    if (measurementValues.length < 3) return null;
    return computeNormalProbabilityPlot(measurementValues);
  }, [measurementValues]);

  const outlierIndices = useMemo(() => {
    return new Set(
      (analysis.qc.outliers?.flags ?? [])
        .filter((f) => f.outlier)
        .map((f) => f.index),
    );
  }, [analysis.qc.outliers]);

  const mandelCharts = useMemo(() => {
    if (!analysis.qc.iso5725) return null;
    return buildMandelCharts(analysis.qc.iso5725);
  }, [analysis.qc.iso5725]);

  const synthesizeTopDown = () => {
    if (locked) return;
    const ipParam = analysis.parameters.find((p) => p.key === 'intermediate_precision');
    const repParam = analysis.parameters.find((p) => p.key === 'repeatability');
    const sIp =
      ipParam?.rawMetrics.sd ??
      repParam?.rawMetrics.sr ??
      analysis.qc.iso5725?.pooled.sR ??
      analysis.qc.descriptive.sd;
    if (sIp === null || !Number.isFinite(sIp) || sIp < 0) {
      toast.push(
        'Não há dados numéricos suficientes para estimar a precisão intermediária s_IP (u(Rw)).',
        'danger',
      );
      return;
    }
    const pooledDf = ipParam?.results?.pooledDf;
    const dofIp =
      typeof pooledDf === 'number' && Number.isFinite(pooledDf) && pooledDf > 0
        ? pooledDf
        : analysis.qc.descriptive.n > 1
          ? analysis.qc.descriptive.n - 1
          : null;

    const measuredValues: number[] = [];
    const referenceValues: number[] = [];
    const referenceUncertainties: number[] = [];
    for (const m of bundle.measurements) {
      const ref = referenceOf(m);
      if (m.value !== null && Number.isFinite(m.value) && ref !== null) {
        measuredValues.push(m.value);
        referenceValues.push(ref);
        if (
          m.refUncertainty !== null &&
          m.refUncertainty !== undefined &&
          Number.isFinite(m.refUncertainty) &&
          m.refUncertainty > 0
        ) {
          referenceUncertainties.push(m.refUncertainty);
        }
      }
    }

    const td = computeTopDownUncertainty({
      intermediatePrecisionSd: sIp,
      intermediatePrecisionDof: dofIp,
      measuredValues,
      referenceValues,
      referenceUncertainties,
      confidence: bundle.design?.input.confidence ?? 0.95,
    });
    const manualItems = items.filter((item) => !item.source.includes('Eurachem Top-Down'));
    const topDownItems: UncertaintyItem[] = td.items.map((src) => ({
      id: uid('u'),
      validationId: bundle.validation.id,
      source: src.source,
      type: src.type,
      distribution: src.distribution,
      value: Number(src.value.toPrecision(6)),
      divisor: src.divisor ?? 1,
      sensitivity: src.sensitivity ?? 1,
      stdUncertainty: Number((src.value / (src.divisor ?? 1)).toPrecision(6)),
      dof: src.dof ?? null,
      notes: src.notes ?? '',
    }));
    setItems([...topDownItems, ...manualItems]);
    toast.push(
      `Orçamento Top-Down Eurachem sintetizado: u_c = ${fmt(td.combined)}; U = ${fmt(td.expanded)} (u(Rw)=${fmt(td.uRw)}, u(bias)=${fmt(td.uBias)}). Clique em "Salvar orçamento" para persistir.`,
    );
  };

  const loadProfileModelBudget = () => {
    if (locked || !toleranceProfile) return;
    const repParam = analysis.parameters.find((p) => p.key === 'repeatability');
    const reproParam = analysis.parameters.find((p) => p.key === 'reproducibility');
    const resolution =
      bundle.method.resolution ??
      (bundle.method.lsl !== null &&
      bundle.method.usl !== null &&
      bundle.method.usl > bundle.method.lsl
        ? (bundle.method.usl - bundle.method.lsl) / 100
        : 0.01);
    const calU = resolution * 2;
    const sigmaRep = repParam?.rawMetrics.sigma_rep ?? analysis.qc.descriptive.sd ?? resolution;
    const sigmaOper = reproParam?.rawMetrics.sigma_oper ?? null;

    const modelItems =
      profile.id === 'dimensional'
        ? dimensionalUncertaintyBudget({
            validationId: bundle.validation.id,
            resolution,
            calibrationUncertainty: calU,
            coverageFactor: 2,
            repeatabilitySd: sigmaRep,
            nReplicates: bundle.design?.input.nReplicates ?? 3,
            reproducibilitySd: sigmaOper,
            referenceUncertainty: calU,
          })
        : physicalUncertaintyBudget({
            validationId: bundle.validation.id,
            resolution,
            calibrationUncertainty: calU,
            coverageFactor: 2,
            repeatabilitySd: sigmaRep,
            nReplicates: bundle.design?.input.nReplicates ?? 3,
            reproducibilitySd: sigmaOper,
            alignment: resolution * 5,
            testSpeed: resolution * 2,
            temperatureEffect: resolution * 2,
          });

    setItems(
      modelItems.map((item) => ({
        ...item,
        id: uid('u'),
      })),
    );
    toast.push(
      `Orçamento-modelo (${profile.id === 'dimensional' ? 'Dimensional' : 'Físico'}) carregado. Substitua os valores de exemplo pelos certificados reais e clique em "Salvar orçamento".`,
    );
  };

  const resolveNominalVars = () => {
    const vars: Record<string, number> = {};
    items.forEach((_, idx) => {
      const key = `X${idx + 1}`;
      const raw = nominalEstimates[key];
      const parsed = raw !== undefined && raw.trim() !== '' ? Number(raw) : 1;
      vars[key] = Number.isFinite(parsed) ? parsed : 1;
    });
    return vars;
  };

  const applySymbolicDerivatives = () => {
    const expr = measurandExpr.trim();
    if (!expr) {
      toast.push('Informe a equação do mensurando (ex.: X1 + X2 ou X1 / X2).', 'danger');
      return;
    }
    if (!items.length) return;
    try {
      const vars = resolveNominalVars();
      const updated = items.map((item, idx) => {
        const key = `X${idx + 1}`;
        const ci = numericalSensitivity(expr, vars, key);
        return {
          ...item,
          sensitivity: Number.isFinite(ci) ? Number(ci.toPrecision(6)) : item.sensitivity,
        };
      });
      setItems(updated);
      toast.push('Coeficientes c_i calculados por derivadas parciais numéricas (∂Y/∂X_i). Clique em "Salvar orçamento" para persistir.');
    } catch (error) {
      toast.push(
        error instanceof Error ? error.message : 'Falha ao avaliar a equação do mensurando.',
        'danger',
      );
    }
  };

  const runMonteCarlo = () => {
    if (!items.length) return;
    try {
      const expr = measurandExpr.trim();
      const nominalVars = resolveNominalVars();
      const variables: MonteCarloVariableInput[] = items.map((item, idx) => {
        const div = item.divisor > 0 ? item.divisor : 1;
        const sens = expr ? 1 : item.sensitivity || 1;
        const stdU = Math.abs((item.value / div) * sens);
        const dist = item.distribution === 'none' ? 'normal' : item.distribution;
        const scaleToHalfWidth =
          dist === 'rectangular'
            ? Math.sqrt(3)
            : dist === 'triangular'
              ? Math.sqrt(6)
              : dist === 'u_shaped'
                ? Math.SQRT2
                : 1;
        const varName = `X${idx + 1}`;
        return {
          name: varName,
          estimate: expr ? nominalVars[varName] : 0,
          halfWidthOrSd: stdU * scaleToHalfWidth,
          distribution: dist,
          dof: item.dof,
        };
      });
      const res = runMonteCarloUncertainty({
        expression: expr || undefined,
        variables,
        trials: mcTrials,
        coverageProbability: bundle.design?.input.confidence ?? 0.95,
        seed: mcSeed,
      });
      setMcResult(res);
      toast.push(`Simulação Monte Carlo concluída (${res.trials.toLocaleString('pt-BR')} iterações).`);
    } catch (error) {
      toast.push(
        error instanceof Error ? error.message : 'Falha na simulação Monte Carlo.',
        'danger',
      );
    }
  };

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
      const actor = bundle.validation.responsible.trim() || 'sistema';
      replaceUncertainty(bundle.validation.id, normalized, actor);
      if (bundle.validation.status === 'draft') {
        updateValidation({ ...bundle.validation, status: 'in_progress' }, actor);
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

      {supportsConformityCard ? (
        <Card>
          <CardHeader
            title="Parâmetros de Conformidade, Incerteza-Alvo e Regra de Decisão (Eurachem 2015/2021 · ILAC G8)"
            description="Configure a regra de decisão, banda de guarda, limites de especificação (LSL/USL) e fração mássica para calcular U^tg e risco de falso aceite/rejeite."
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
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Field label="Regra de decisão">
                <Select
                  value={conformityRule}
                  disabled={locked}
                  onChange={(e) =>
                    setConformityRule(
                      e.target.value as NonNullable<ReportConfig['conformityRule']>,
                    )
                  }
                >
                  <option value="simple_acceptance">Aceitação simples (ILAC-G8 / risco compartilhado)</option>
                  <option value="guard_band">Banda de guarda w = r·U (ILAC-G8 / ISO 14253-1)</option>
                  <option value="probability">Probabilidade de conformidade (JCGM 106)</option>
                </Select>
              </Field>
              <Input
                label="Fator banda de guarda (r)"
                type="number"
                step="0.05"
                min="0"
                disabled={locked || conformityRule !== 'guard_band'}
                value={guardBandFactor}
                onChange={(e) => setGuardBandFactor(Number(e.target.value))}
                hint="Padrão r = 1 (w = U)"
              />
              <Input
                label="Limiar de probabilidade"
                type="number"
                step="0.01"
                min="0.5"
                max="0.999"
                disabled={locked || conformityRule !== 'probability'}
                value={probabilityThreshold}
                onChange={(e) => setProbabilityThreshold(Number(e.target.value))}
                hint="Ex.: 0,95 (95%)"
              />
              <Input
                label={`LSL (${bundle.method.unit || 'unid.'})`}
                type="number"
                step="any"
                disabled={locked}
                value={lslInput}
                onChange={(e) => setLslInput(e.target.value)}
                placeholder="Ex.: 95"
                hint="Limite inferior de espec."
              />
              <Input
                label={`USL (${bundle.method.unit || 'unid.'})`}
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
                  label={`Variação do processo 6σ_p (${bundle.method.unit || 'unid.'})`}
                  type="number"
                  step="any"
                  disabled={locked}
                  value={processVariationInput}
                  onChange={(e) => setProcessVariationInput(e.target.value)}
                  placeholder="Automático (6·s)"
                  hint="Vazio = inferido da coleta"
                />
                <Input
                  label={`LSL individual (${bundle.method.unit || 'unid.'})`}
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

            {(targetUncertaintyPreview || conformityPreview) ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {targetUncertaintyPreview ? (
                  <div className="rounded-xl border border-ink-200 p-3 text-xs dark:border-ink-800">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold uppercase tracking-wide text-ink-500">
                        Incerteza-Alvo (Eurachem 2015)
                      </p>
                      {targetUncertaintyPreview.meetsStrictSpec !== null ? (
                        <Badge tone={targetUncertaintyPreview.meetsStrictSpec ? 'success' : targetUncertaintyPreview.meetsModerateSpec ? 'warning' : 'danger'}>
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
                        <>
                          <p>
                            T = {fmt(targetUncertaintyPreview.tolerance)} · U^tg moderada (T/4) ={' '}
                            {fmt(targetUncertaintyPreview.expandedTargetSpecModerate)} · U^tg rigorosa (T/8, TUR ≥ 4) ={' '}
                            {fmt(targetUncertaintyPreview.expandedTargetSpecStrict)}
                          </p>
                        </>
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
                      <VerdictBadge verdict={conformityPreview.verdict} />
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
      ) : null}

      {uncertaintyDefinition ? (
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
                    <Sigma className="h-3.5 w-3.5" /> Orçamento-modelo ({profile.id === 'dimensional' ? 'Dimensional' : 'Físico'})
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={synthesizeTopDown} disabled={locked} title="Gerar fontes u(Rw) + u(bias) da precisão intermediária e exatidão (Eurachem 2026 / ISO 11352)">
                  <Sigma className="h-3.5 w-3.5" /> Sintetizar Top-Down (Eurachem)
                </Button>
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
                    const divisor = item.divisor > 0 ? item.divisor : defaultDivisor(item.distribution);
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
                    Confronta a aproximação linear GUM contra amostragem estocástica determinística das distribuições de entrada.
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
                    title="Semente PRNG (Mulberry32)"
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
                        {mcResult.gumCompatible
                          ? 'Compatível com GUM'
                          : 'Divergência detectada'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ) : null}
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
