import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  FlaskConical,
  Info,
  LineChart,
  ShieldCheck,
  Sigma,
} from 'lucide-react';
import type {
  ReportConfig,
  UncertaintyItem,
  UncertaintyDistribution,
} from '../../lib/types';
import {
  clearAnalyses,
  replaceUncertainty,
  saveAnalysis,
  updateValidation,
} from '../../lib/repository';
import { validateConformityForm } from '../../lib/conformityValidation';
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
  type MonteCarloResult,
  type MonteCarloVariableInput,
} from '../../stats/monteCarlo';
import { executeMonteCarloAsync } from '../../workers';
import { fmt } from '../../stats/distributions';
import { buildMandelCharts } from '../../stats/iso5725';
import {
  computeHistogramWithNormalCurve,
  computeNormalProbabilityPlot,
} from '../../stats/normality';
import { cn, objectHash, uid } from '../../lib/utils';
import { StepShell } from '../../components/wizard';
import {
  Alert,
  Badge,
  Button,
  Stat,
  VerdictBadge,
  useToast,
} from '../../components/ui';
import type { StepProps } from './types';
import {
  AnalysisAssumptionsTab,
  AnalysisConformityTab,
  AnalysisParametersTab,
  AnalysisQcTab,
  AnalysisUncertaintyTab,
} from './analysis';

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

export type AnalysisTab = 'parameters' | 'qc' | 'uncertainty' | 'conformity' | 'assumptions';

export function StepAnalysis({ bundle, analysis, goTo, reload }: StepProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<AnalysisTab>('parameters');
  const tablistRef = useRef<HTMLDivElement>(null);
  const locked = bundle.validation.locked;

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    if (!buttons.length) return;
    const found = buttons.findIndex((button) => button.dataset.tab === activeTab);
    const current = found < 0 ? 0 : found;
    let nextIndex = current;
    if (event.key === 'ArrowRight') nextIndex = (current + 1) % buttons.length;
    if (event.key === 'ArrowLeft') nextIndex = (current - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;
    const next = buttons[nextIndex];
    if (!next) return;
    next.focus();
    setActiveTab(next.dataset.tab as AnalysisTab);
  };

  const profile = getProfileForMethod(bundle.method);
  const attribute = profile.id === 'attribute';
  const toleranceProfile =
    profile.id === 'dimensional' ||
    profile.id === 'physical-destructive' ||
    profile.id === 'physical-nondestructive';
  const supportsConformityCard = !attribute;
  const attributeQc = analysis.qc.attribute;
  const uncertaintyDefinition = profile.parameters.find(
    (parameter) => parameter.key === 'uncertainty',
  );

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
  const [mcRunning, setMcRunning] = useState(false);
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
  }, [bundle.method.lsl, bundle.method.usl, bundle.validation.reportConfig]);

  const saveConformityConfig = () => {
    if (locked) return;
    const validation = validateConformityForm({
      lslInput,
      uslInput,
      rule: conformityRule,
      guardBandFactor,
      probabilityThreshold,
      massFractionInput,
      processVariationInput,
      individualLslInput,
    });
    if (!validation.isValid) {
      toast.push(validation.firstError ?? 'Corrija os parâmetros de conformidade.', 'danger');
      return;
    }
    const pv =
      processVariationInput.trim() === '' ? null : Number(processVariationInput);
    const indLsl =
      individualLslInput.trim() === '' ? null : Number(individualLslInput);
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
  }, [
    parsedLsl,
    parsedUsl,
    parsedMassFraction,
    items.length,
    uncertaintyPreview.expanded,
    uncertaintyPreview.coverageFactor,
  ]);

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

    const mixedAnova =
      (repParam?.results?.mixedAnova as any) ??
      (reproParam?.results?.mixedAnova as any) ??
      null;

    const repDof =
      mixedAnova?.budget?.repeatability?.df ??
      (typeof repParam?.rawMetrics?.df_rep === 'number' && repParam.rawMetrics.df_rep > 0
        ? repParam.rawMetrics.df_rep
        : ((repParam?.results?.gageRR as any)?.components?.find((c: any) => c.key === 'repeatability')?.df ??
          null));

    const reproDof =
      mixedAnova?.budget?.analyst?.df ??
      (typeof reproParam?.rawMetrics?.df_oper === 'number' && reproParam.rawMetrics.df_oper > 0
        ? reproParam.rawMetrics.df_oper
        : ((reproParam?.results?.gageRR as any)?.components?.find((c: any) => c.key === 'operator')?.df ??
          (reproParam?.results?.gageRR as any)?.components?.find((c: any) => c.key === 'operator')?.interval?.df ??
          null));

    const daySd =
      mixedAnova?.budget?.day?.sd ??
      (typeof reproParam?.rawMetrics?.sigma_day === 'number' ? reproParam.rawMetrics.sigma_day : null);

    const dayDof =
      mixedAnova?.budget?.day?.df ??
      (typeof reproParam?.rawMetrics?.df_day === 'number' ? reproParam.rawMetrics.df_day : null);

    const modelItems =
      profile.id === 'dimensional'
        ? dimensionalUncertaintyBudget({
            validationId: bundle.validation.id,
            resolution,
            calibrationUncertainty: calU,
            coverageFactor: 2,
            repeatabilitySd: sigmaRep,
            repeatabilityDof: repDof,
            nReplicates: bundle.design?.input.nReplicates ?? 3,
            reproducibilitySd: sigmaOper,
            reproducibilityDof: reproDof,
            daySd,
            dayDof,
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
      toast.push(
        'Coeficientes c_i calculados por derivadas parciais numéricas (∂Y/∂X_i). Clique em "Salvar orçamento" para persistir.',
      );
    } catch (error) {
      toast.push(
        error instanceof Error ? error.message : 'Falha ao avaliar a equação do mensurando.',
        'danger',
      );
    }
  };

  const runMonteCarlo = async () => {
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

      setMcRunning(true);
      const res = await executeMonteCarloAsync({
        expression: expr || undefined,
        variables,
        trials: mcTrials,
        coverageProbability: bundle.design?.input.confidence ?? 0.95,
        seed: mcSeed,
      });
      setMcResult(res);
      toast.push(`Simulação Monte Carlo concluída (${res.trials.toLocaleString('pt-BR')} iterações via Web Worker).`);
    } catch (error) {
      toast.push(
        error instanceof Error ? error.message : 'Falha na simulação Monte Carlo.',
        'danger',
      );
    } finally {
      setMcRunning(false);
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

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((row) => row.id !== id));
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
  const attributeData = attributeQc?.data ?? null;

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
              categorias observadas.
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
            <Button
              variant="outline"
              onClick={() => void freezeResults()}
              loading={freezing}
              disabled={locked}
            >
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

      {/* 5 Cards de Resumo Executivo */}
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
              value={
                analysis.overallVerdict === 'pass'
                  ? 'Conforme'
                  : analysis.overallVerdict === 'fail'
                    ? 'Não conforme'
                    : analysis.overallVerdict === 'warning'
                      ? 'Atenção'
                      : 'Não avaliado'
              }
              hint={`${analysis.parameters.length} parâmetro(s)`}
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone={
                analysis.overallVerdict === 'pass'
                  ? 'success'
                  : analysis.overallVerdict === 'fail'
                    ? 'danger'
                    : 'warning'
              }
            />
          </>
        ) : (
          <>
            <Stat
              label="n usado"
              value={analysis.nUsed}
              hint={`${analysis.nTotal} registros`}
              icon={<Sigma className="h-5 w-5" />}
            />
            <Stat
              label="Média"
              value={fmt(descriptive.mean)}
              hint={`IC ${((descriptive.confidence ?? 0.95) * 100).toFixed(0)}%: ${fmt(descriptive.ciLow)} – ${fmt(descriptive.ciHigh)}`}
              icon={<BarChart3 className="h-5 w-5" />}
              tone="neutral"
            />
            <Stat
              label="s"
              value={fmt(descriptive.sd)}
              hint={`variância ${fmt(descriptive.variance)}`}
              icon={<LineChart className="h-5 w-5" />}
              tone="neutral"
            />
            <Stat
              label="CV"
              value={descriptive.cv === null ? '—' : `${fmt(descriptive.cv, 2)}%`}
              hint={`mediana ${fmt(descriptive.median)}`}
              icon={<FlaskConical className="h-5 w-5" />}
              tone={descriptive.cv !== null && descriptive.cv > 10 ? 'warning' : 'success'}
            />
            <Stat
              label="Veredito global"
              value={
                analysis.overallVerdict === 'pass'
                  ? 'Conforme'
                  : analysis.overallVerdict === 'fail'
                    ? 'Não conforme'
                    : analysis.overallVerdict === 'warning'
                      ? 'Atenção'
                      : 'Não avaliado'
              }
              hint={`${analysis.parameters.length} parâmetro(s)`}
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone={
                analysis.overallVerdict === 'pass'
                  ? 'success'
                  : analysis.overallVerdict === 'fail'
                    ? 'danger'
                    : 'warning'
              }
            />
          </>
        )}
      </div>

      {/* Barra de Navegação por Abas Especializadas */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Abas da análise estatística"
        onKeyDown={handleTabKeyDown}
        className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-ink-200 bg-ink-100/60 p-1.5 dark:border-ink-800 dark:bg-ink-900/60"
      >
        <button
          type="button"
          role="tab"
          data-tab="parameters"
          aria-selected={activeTab === 'parameters'}
          onClick={() => setActiveTab('parameters')}
          className={cn(
            'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition',
            activeTab === 'parameters'
              ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white font-semibold'
              : 'text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white',
          )}
        >
          <CheckCircle2 className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          <span>Parâmetros</span>
          <Badge
            tone={
              analysis.overallVerdict === 'pass'
                ? 'success'
                : analysis.overallVerdict === 'fail'
                  ? 'danger'
                  : 'neutral'
            }
            className="text-[10px] px-1.5 py-0"
          >
            {analysis.parameters.length}
          </Badge>
        </button>

        <button
          type="button"
          role="tab"
          data-tab="qc"
          aria-selected={activeTab === 'qc'}
          onClick={() => setActiveTab('qc')}
          className={cn(
            'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition',
            activeTab === 'qc'
              ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white font-semibold'
              : 'text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white',
          )}
        >
          <BarChart3 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <span>Controle de Qualidade</span>
          {analysis.qc.outliers?.outlier ? (
            <Badge tone="danger" className="text-[10px] px-1.5 py-0">
              Outlier
            </Badge>
          ) : analysis.qc.normality ? (
            <Badge
              tone={analysis.qc.normality.normal ? 'success' : 'warning'}
              className="text-[10px] px-1.5 py-0"
            >
              {analysis.qc.normality.normal ? 'Normal' : 'Não normal'}
            </Badge>
          ) : null}
        </button>

        {uncertaintyDefinition ? (
          <button
            type="button"
            role="tab"
            data-tab="uncertainty"
            aria-selected={activeTab === 'uncertainty'}
            onClick={() => setActiveTab('uncertainty')}
            className={cn(
              'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition',
              activeTab === 'uncertainty'
                ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white font-semibold'
                : 'text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white',
            )}
          >
            <Sigma className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span>Incerteza GUM</span>
            <Badge tone="neutral" className="text-[10px] px-1.5 py-0">
              {items.length} {items.length === 1 ? 'fonte' : 'fontes'}
            </Badge>
          </button>
        ) : null}

        {supportsConformityCard ? (
          <button
            type="button"
            role="tab"
            data-tab="conformity"
            aria-selected={activeTab === 'conformity'}
            onClick={() => setActiveTab('conformity')}
            className={cn(
              'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition',
              activeTab === 'conformity'
                ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white font-semibold'
                : 'text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white',
            )}
          >
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Conformidade & Regra</span>
            {conformityPreview ? (
              <Badge
                tone={
                  conformityPreview.verdict === 'pass'
                    ? 'success'
                    : conformityPreview.verdict === 'fail'
                      ? 'danger'
                      : 'warning'
                }
                className="text-[10px] px-1.5 py-0"
              >
                {conformityPreview.decision}
              </Badge>
            ) : null}
          </button>
        ) : null}

        <button
          type="button"
          role="tab"
          data-tab="assumptions"
          aria-selected={activeTab === 'assumptions'}
          onClick={() => setActiveTab('assumptions')}
          className={cn(
            'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition',
            activeTab === 'assumptions'
              ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white font-semibold'
              : 'text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white',
          )}
        >
          <Info className="h-4 w-4 text-ink-500" />
          <span>Pressupostos</span>
          <Badge tone="outline" className="text-[10px] px-1.5 py-0">
            {analysis.assumptions.length}
          </Badge>
        </button>
      </div>

      {/* Conteúdo Renderizado por Aba Desacoplada */}
      {activeTab === 'parameters' ? (
        <AnalysisParametersTab parameters={analysis.parameters} />
      ) : null}

      {activeTab === 'qc' ? (
        <AnalysisQcTab
          analysis={analysis}
          attribute={attribute}
          measurementValues={measurementValues}
          histogramResult={histogramResult}
          qqResult={qqResult}
          outlierIndices={outlierIndices}
          mandelCharts={mandelCharts}
        />
      ) : null}

      {activeTab === 'uncertainty' ? (
        <AnalysisUncertaintyTab
          items={items}
          locked={locked}
          uncertaintyDefinition={uncertaintyDefinition}
          toleranceProfile={toleranceProfile}
          profileId={profile.id}
          uncertaintyPreview={uncertaintyPreview}
          mcResult={mcResult}
          mcTrials={mcTrials}
          setMcTrials={setMcTrials}
          mcSeed={mcSeed}
          setMcSeed={setMcSeed}
          measurandExpr={measurandExpr}
          setMeasurandExpr={setMeasurandExpr}
          nominalEstimates={nominalEstimates}
          setNominalEstimates={setNominalEstimates}
          patchItem={patchItem}
          addItem={addItem}
          removeItem={removeItem}
          saveUncertainty={saveUncertainty}
          savingUncertainty={savingUncertainty}
          loadProfileModelBudget={loadProfileModelBudget}
          synthesizeTopDown={synthesizeTopDown}
          applySymbolicDerivatives={applySymbolicDerivatives}
          runMonteCarlo={runMonteCarlo}
          mcRunning={mcRunning}
        />
      ) : null}

      {activeTab === 'conformity' ? (
        <AnalysisConformityTab
          supportsConformityCard={supportsConformityCard}
          locked={locked}
          savingConformity={savingConformity}
          saveConformityConfig={saveConformityConfig}
          conformityRule={conformityRule}
          setConformityRule={setConformityRule}
          guardBandFactor={guardBandFactor}
          setGuardBandFactor={setGuardBandFactor}
          probabilityThreshold={probabilityThreshold}
          setProbabilityThreshold={setProbabilityThreshold}
          lslInput={lslInput}
          setLslInput={setLslInput}
          uslInput={uslInput}
          setUslInput={setUslInput}
          massFractionInput={massFractionInput}
          setMassFractionInput={setMassFractionInput}
          processVariationInput={processVariationInput}
          setProcessVariationInput={setProcessVariationInput}
          individualLslInput={individualLslInput}
          setIndividualLslInput={setIndividualLslInput}
          toleranceProfile={toleranceProfile}
          unit={bundle.method.unit}
          targetUncertaintyPreview={targetUncertaintyPreview}
          conformityPreview={conformityPreview}
          conformityDensityData={conformityDensityData}
        />
      ) : null}

      {activeTab === 'assumptions' ? (
        <AnalysisAssumptionsTab assumptions={analysis.assumptions} />
      ) : null}
    </StepShell>
  );
}
