import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FlaskConical, Lock } from 'lucide-react';
import type { ValidationBundle } from '../lib/types';
import { STATUS_LABELS } from '../lib/types';
import { getBundle, setValidationStep } from '../lib/repository';
import { analyzeValidation } from '../stats/analysis';
import { getProfileForMethod } from '../profiles/index';
import { useApp } from '../lib/app-context';
import { formatDate } from '../lib/utils';
import { Stepper, WIZARD_STEPS } from '../components/wizard';
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Progress,
} from '../components/ui';
import { StepMethod } from './steps/StepMethod';
import { StepParameters } from './steps/StepParameters';
import { StepDesign } from './steps/StepDesign';
import { StepCollection } from './steps/StepCollection';
import { StepAnalysis } from './steps/StepAnalysis';
import { StepReport } from './steps/StepReport';
import { StepAudit } from './steps/StepAudit';
import type { StepProps } from './steps/types';

const STATUS_TONE = {
  draft: 'neutral',
  in_progress: 'info',
  in_review: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const;

function clampStep(value: number): number {
  if (!Number.isInteger(value)) return 0;
  return Math.min(WIZARD_STEPS.length - 1, Math.max(0, value));
}

export function ValidationWizard() {
  const { id = '', step } = useParams();
  const navigate = useNavigate();
  const { bumpData } = useApp();
  const [bundle, setBundle] = useState<ValidationBundle | null>(() =>
    id ? getBundle(id) : null,
  );
  const [currentStep, setCurrentStep] = useState(() => {
    const parsed = Number(step);
    if (step !== undefined && Number.isInteger(parsed) && parsed >= 0 && parsed < WIZARD_STEPS.length) {
      return parsed;
    }
    const loaded = id ? getBundle(id) : null;
    return clampStep(loaded?.validation.currentStep ?? 0);
  });

  const reload = useCallback(() => {
    if (!id) return;
    const next = getBundle(id);
    setBundle(next);
    bumpData();
  }, [id, bumpData]);

  useEffect(() => {
    const next = id ? getBundle(id) : null;
    setBundle(next);
    if (!next) return;
    if (step === undefined) {
      setCurrentStep(clampStep(next.validation.currentStep));
      return;
    }
    const parsed = Number(step);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed >= WIZARD_STEPS.length) {
      navigate(`/validation/${next.validation.id}`, { replace: true });
      setCurrentStep(clampStep(next.validation.currentStep));
      return;
    }
    setCurrentStep(parsed);
    if (!next.validation.locked && parsed !== next.validation.currentStep) {
      setValidationStep(next.validation.id, parsed);
      setBundle({ ...next, validation: { ...next.validation, currentStep: parsed } });
    }
    // O id/step definem a navegação; o bundle é recarregado apenas quando a rota muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, step]);

  const analysis = useMemo(() => {
    if (!bundle) return null;
    const profile = getProfileForMethod(bundle.method);
    const dimensional = profile.id === 'dimensional';
    return analyzeValidation(
      bundle.parameters,
      bundle.measurements,
      bundle.method.criteria,
      {
        alpha: bundle.design?.input.alpha ?? 0.05,
        confidence: bundle.design?.input.confidence ?? 0.95,
        margin: bundle.design?.input.margin,
        plans: bundle.design?.plan.parameterPlans,
        uncertaintyItems: bundle.uncertainty,
        rangeMin: bundle.method.rangeMin,
        rangeMax: bundle.method.rangeMax,
        profileId: profile.id,
        lsl: bundle.method.lsl,
        usl: bundle.method.usl,
        resolution: bundle.method.resolution,
        unit: bundle.method.unit,
        conformity: dimensional
          ? {
              rule: 'guard_band',
              coverageFactor: 2,
              guardBandFactor: 1,
              probabilityThreshold: 0.95,
            }
          : undefined,
      },
    );
  }, [bundle]);

  const goTo = (target: number) => {
    if (!bundle) return;
    const nextStep = clampStep(target);
    setCurrentStep(nextStep);
    if (!bundle.validation.locked) {
      setValidationStep(bundle.validation.id, nextStep);
      setBundle({
        ...bundle,
        validation: { ...bundle.validation, currentStep: nextStep },
      });
    }
    navigate(`/validation/${bundle.validation.id}/${nextStep}`);
  };

  if (!bundle) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<FlaskConical className="h-10 w-10" />}
            title="Validação não encontrada"
            description="O processo pode ter sido excluído ou o banco local foi reiniciado."
            action={
              <Button onClick={() => navigate('/')}>
                <ArrowLeft className="h-4 w-4" /> Voltar ao painel
              </Button>
            }
          />
        </CardBody>
      </Card>
    );
  }

  if (!analysis) return null;

  const { validation, method, report } = bundle;
  const progress = Math.round((currentStep / (WIZARD_STEPS.length - 1)) * 100);
  const componentProps: StepProps = {
    bundle,
    analysis,
    reload,
    goTo,
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <StepMethod {...componentProps} />;
      case 1:
        return <StepParameters {...componentProps} />;
      case 2:
        return <StepDesign {...componentProps} />;
      case 3:
        return <StepCollection {...componentProps} />;
      case 4:
        return <StepAnalysis {...componentProps} />;
      case 5:
        return <StepReport {...componentProps} />;
      case 6:
        return <StepAudit {...componentProps} />;
      default:
        return <StepMethod {...componentProps} />;
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[validation.status]}>{STATUS_LABELS[validation.status]}</Badge>
              <Badge tone="outline">v{validation.version}</Badge>
              {validation.locked ? (
                <Badge tone="success">
                  <Lock className="h-3 w-3" /> bloqueada
                </Badge>
              ) : null}
              <span className="text-[11px] text-ink-400">Atualizada em {formatDate(validation.updatedAt)}</span>
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">
              {validation.title}
            </h2>
            <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
              <span className="font-mono text-xs font-semibold text-brand-700 dark:text-brand-300">{method.code}</span>{' '}
              · {method.name} · {method.unit || 'sem unidade'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Progress value={progress} className="max-w-sm" tone={validation.status === 'approved' ? 'success' : 'brand'} />
              <span className="text-xs text-ink-500">{progress}% do fluxo</span>
              {report ? <Badge tone={report.status === 'approved' ? 'success' : report.status === 'in_review' ? 'warning' : 'neutral'}>relatório v{report.version}</Badge> : null}
            </div>
          </div>
          <Button variant="outline" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" /> Painel
          </Button>
        </CardBody>
      </Card>

      <Stepper currentStep={currentStep} onSelect={goTo} />

      {renderStep()}
    </div>
  );
}
