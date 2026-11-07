import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ListChecks,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import type { ParamKey, ValidationParameter } from '../../lib/types';
import { saveParameters, updateValidation } from '../../lib/repository';
import { getProfileForMethod } from '../../profiles/index';
import { criterionText } from '../../lib/criteria';
import { CriteriaTable } from '../../components/CriteriaTable';
import { StepShell } from '../../components/wizard';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Textarea,
  useToast,
} from '../../components/ui';
import type { StepProps } from './types';

export function StepParameters({ bundle, goTo, reload }: StepProps) {
  const toast = useToast();
  const locked = bundle.validation.locked;
  const profile = getProfileForMethod(bundle.method);
  const parameterDefinitions = useMemo(
    () => new Map(profile.parameters.map((parameter) => [parameter.key, parameter])),
    [profile],
  );
  const [parameters, setParameters] = useState<ValidationParameter[]>(bundle.parameters);
  const [expanded, setExpanded] = useState<ParamKey | null>(
    bundle.parameters.find((parameter) => parameter.selected)?.key ??
      profile.parameters[0]?.key ??
      null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setParameters(bundle.parameters);
  }, [bundle.parameters]);

  const suggested = useMemo(
    () => new Set(profile.suggestedParameters(bundle.method.type, bundle.method.validationType)),
    [profile, bundle.method.type, bundle.method.validationType],
  );
  const selectedCount = parameters.filter((parameter) => parameter.selected).length;

  const patch = (key: ParamKey, value: Partial<ValidationParameter>) => {
    setParameters((prev) =>
      prev.map((parameter) => (parameter.key === key ? { ...parameter, ...value } : parameter)),
    );
  };

  const applySuggestion = () => {
    setParameters((prev) =>
      prev.map((parameter) => ({ ...parameter, selected: suggested.has(parameter.key) })),
    );
    toast.push('Sugestão de parâmetros aplicada. Revise as justificativas.');
  };

  const persist = (): boolean => {
    if (locked) return false;
    if (selectedCount === 0) {
      toast.push('Selecione ao menos um parâmetro para validar.', 'danger');
      return false;
    }
    setSaving(true);
    try {
      saveParameters(bundle.validation.id, parameters);
      if (bundle.validation.status === 'draft') {
        updateValidation({ ...bundle.validation, status: 'in_progress' });
      }
      toast.push('Parâmetros e critérios salvos.');
      reload();
      return true;
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao salvar parâmetros.', 'danger');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepShell
      step={1}
      title="Parâmetros e critérios da validação"
      description="Escolha o que será demonstrado. Para cada parâmetro, registre a justificativa e os critérios de aceitação aplicáveis a esta validação."
      locked={locked}
      help={
        <>
          <p>
            A seleção sugerida depende do tipo de método e do tipo de validação. Ela é apenas um
            ponto de partida: exclua parâmetros não aplicáveis e registre o motivo.
          </p>
          <p className="mt-1">
            Critérios específicos desta validação somam-se aos critérios globais do método.
          </p>
        </>
      }
      aside={
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">{selectedCount} selecionado(s)</Badge>
          <Badge tone="outline">de {parameters.length}</Badge>
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => goTo(0)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={persist} disabled={locked} loading={saving}>
              <Save className="h-4 w-4" /> Salvar
            </Button>
            <Button
              onClick={() => {
                if (persist()) goTo(2);
              }}
              disabled={locked}
              loading={saving}
            >
              Salvar e continuar <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      }
    >
      <Card>
        <CardHeader
          title="Checklist de parâmetros"
          description="Marque os parâmetros aplicáveis. A justificativa fica registrada no relatório."
          icon={<ListChecks className="h-4 w-4" />}
          action={
            <Button variant="outline" size="sm" disabled={locked} onClick={applySuggestion}>
              <RotateCcw className="h-3.5 w-3.5" /> Usar sugestão
            </Button>
          }
        />
        <CardBody className="space-y-2">
          {parameters.map((parameter) => {
            const isOpen = expanded === parameter.key;
            const definition = parameterDefinitions.get(parameter.key);
            const methodCriteria = bundle.method.criteria.filter(
              (criterion) => criterion.parameter === parameter.key,
            );
            const isSuggested = suggested.has(parameter.key);
            return (
              <div
                key={parameter.key}
                className={`rounded-xl border transition ${
                  parameter.selected
                    ? 'border-brand-200 bg-brand-50/30 dark:border-brand-900 dark:bg-brand-950/10'
                    : 'border-ink-200 dark:border-ink-800'
                }`}
              >
                <div className="flex items-start gap-3 p-3">
                  <Checkbox
                    className="mt-1"
                    checked={parameter.selected}
                    disabled={locked}
                    onChange={(e) => patch(parameter.key, { selected: e.target.checked })}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setExpanded(isOpen ? null : parameter.key)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink-900 dark:text-white">
                        {definition?.label ?? parameter.key}
                      </span>
                      {isSuggested ? <Badge tone="info">sugerido</Badge> : null}
                      {parameter.criteria.length ? (
                        <Badge tone="outline">{parameter.criteria.length} critério(s)</Badge>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-500">{definition?.shortDescription}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setExpanded(isOpen ? null : parameter.key)}
                    title={isOpen ? 'Recolher' : 'Expandir'}
                  >
                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
                {isOpen ? (
                  <div className="space-y-3 border-t border-ink-200 p-3 dark:border-ink-800">
                    <Textarea
                      label="Justificativa / decisão"
                      className="min-h-[70px]"
                      value={parameter.justification}
                      disabled={locked}
                      onChange={(e) => patch(parameter.key, { justification: e.target.value })}
                      placeholder="Por que este parâmetro é aplicável? Como será avaliado?"
                    />
                    {methodCriteria.length ? (
                      <div className="rounded-xl border border-ink-200 bg-white p-2.5 dark:border-ink-700 dark:bg-ink-900">
                        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                          <ShieldCheck className="h-3.5 w-3.5" /> Critérios globais do método
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {methodCriteria.map((criterion) => (
                            <span
                              key={criterion.id}
                              className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600 dark:bg-ink-800 dark:text-ink-300"
                            >
                              {criterion.metric}: {criterionText(criterion)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                        Critérios específicos desta validação
                      </p>
                      <CriteriaTable
                        profile={profile}
                        parameter={parameter.key}
                        criteria={parameter.criteria}
                        onChange={(criteria) => patch(parameter.key, { criteria })}
                        disabled={locked}
                      />
                    </div>
                    <p className="text-[11px] text-ink-400">{definition?.reference}</p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardBody>
      </Card>

      {selectedCount === 0 ? (
        <Alert tone="warning" title="Nenhum parâmetro selecionado">
          Sem parâmetros selecionados a análise não poderá concluir sobre a adequação do método.
        </Alert>
      ) : (
        <Alert tone="info" title="Rastreabilidade">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            A seleção, as justificativas e os critérios serão gravados na trilha de auditoria e no
            relatório.
          </span>
        </Alert>
      )}
    </StepShell>
  );
}
