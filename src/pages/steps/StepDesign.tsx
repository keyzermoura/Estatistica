import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Beaker,
  Calculator,
  Dices,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';
import type { DesignInput, DesignPlan } from '../../lib/types';
import { DEFAULT_DESIGN_INPUT } from '../../lib/types';
import { getProfileForMethod } from '../../profiles/index';
import { buildDesign, rerandomize, sigmaFromRange } from '../../stats/design';
import { saveDesign, updateValidation } from '../../lib/repository';
import { fmt } from '../../stats/distributions';
import { PowerCurveChart } from '../../components/charts';
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
  Switch,
  Textarea,
  useToast,
} from '../../components/ui';
import { nowIso, uid } from '../../lib/utils';
import type { StepProps } from './types';

function parseList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function StepDesign({ bundle, goTo, reload }: StepProps) {
  const toast = useToast();
  const locked = bundle.validation.locked;
  const profile = getProfileForMethod(bundle.method);
  const defaultInput = (): DesignInput => ({
    ...DEFAULT_DESIGN_INPUT,
    confidence: profile.defaultAssumptions.confidence,
    power: profile.defaultAssumptions.power,
    alpha: profile.defaultAssumptions.alpha,
    sigma: profile.defaultAssumptions.sigma,
    effect: profile.defaultAssumptions.minimumEffect,
    margin: profile.defaultAssumptions.tostMargin,
    seed: Date.now() % 1000000,
  });
  const [input, setInput] = useState<DesignInput>(
    () => bundle.design?.input ?? defaultInput(),
  );
  const [levelsText, setLevelsText] = useState(() => input.levels.join(', '));
  const [factorsText, setFactorsText] = useState(() => input.factors.join(', '));
  const [plan, setPlan] = useState<DesignPlan>(
    () =>
      bundle.design?.plan ??
      buildDesign(input, {
        selected: bundle.parameters.filter((parameter) => parameter.selected).map((parameter) => parameter.key),
      }),
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const nextInput = bundle.design?.input ?? defaultInput();
    setInput(nextInput);
    setLevelsText(nextInput.levels.join(', '));
    setFactorsText(nextInput.factors.join(', '));
    setPlan(
      bundle.design?.plan ??
        buildDesign(nextInput, {
          selected: bundle.parameters
            .filter((parameter) => parameter.selected)
            .map((parameter) => parameter.key),
        }),
    );
    setDirty(false);
    // O perfil define os pressupostos iniciais; suas instâncias são estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.design, bundle.parameters]);

  const selectedKeys = useMemo(
    () => bundle.parameters.filter((parameter) => parameter.selected).map((parameter) => parameter.key),
    [bundle.parameters],
  );

  const update = <K extends keyof DesignInput>(key: K, value: DesignInput[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const normalizedInput = (): DesignInput => {
    const levels = parseList(levelsText);
    const factors = parseList(factorsText);
    return {
      ...input,
      levels: levels.length ? levels : ['baixo', 'médio', 'alto'],
      factors: factors.length ? factors : ['analista', 'dia'],
      nLevels: levels.length || input.nLevels,
    };
  };

  const recalculate = () => {
    const normalized = normalizedInput();
    setInput(normalized);
    setPlan(buildDesign(normalized, { selected: selectedKeys }));
    setDirty(true);
    toast.push('Plano recalculado. Salve para registrar esta versão.');
  };

  const applyRangeSigma = () => {
    const sigma = sigmaFromRange(
      bundle.method.rangeMin,
      bundle.method.rangeMax,
      profile.defaultAssumptions.sigmaFromRangeDivisor,
    );
    if (sigma === null) {
      toast.push('Informe a faixa mínima e máxima do método para estimar σ.', 'danger');
      return;
    }
    update('sigma', Number(sigma.toPrecision(4)));
    toast.push(`σ estimado pela faixa: ${fmt(sigma)}. Recalcule o plano.`);
  };

  const persist = (): boolean => {
    if (locked) return false;
    const normalized = normalizedInput();
    const nextPlan = buildDesign(normalized, { selected: selectedKeys });
    setSaving(true);
    try {
      saveDesign(
        {
          id: bundle.design?.id ?? uid('design'),
          validationId: bundle.validation.id,
          input: normalized,
          plan: nextPlan,
          seed: normalized.seed,
          createdAt: bundle.design?.createdAt ?? nowIso(),
        },
        'sistema',
        'Delineamento atualizado',
      );
      if (bundle.validation.status === 'draft') {
        updateValidation({ ...bundle.validation, status: 'in_progress' });
      }
      setInput(normalized);
      setPlan(nextPlan);
      setDirty(false);
      toast.push('Delineamento salvo.');
      reload();
      return true;
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao salvar delineamento.', 'danger');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepShell
      step={2}
      title="Delineamento e tamanho de amostra"
      description="Converta o objetivo estatístico em um plano executável: confiança, poder, σ, efeito mínimo, margem, fatores, níveis e aleatorização reprodutível."
      locked={locked}
      help={
        <>
          <p>
            σ é o desvio-padrão esperado do método. Se ainda não houver dado piloto, use faixa/6 e
            registre essa suposição no relatório.
          </p>
          <p className="mt-1">
            O cálculo usa poder para teste t bilateral, precisão do IC da média, TOST, razão de
            variâncias e ISO 5725-2, conforme o parâmetro.
          </p>
        </>
      }
      aside={
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">{plan.recommended.total} medições</Badge>
          <Badge tone="outline">{plan.runs.length} execuções</Badge>
          {dirty ? <Badge tone="warning">não salvo</Badge> : null}
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => goTo(1)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={recalculate}>
              <RefreshCw className="h-4 w-4" /> Recalcular
            </Button>
            <Button variant="outline" onClick={persist} disabled={locked} loading={saving}>
              <Save className="h-4 w-4" /> Salvar
            </Button>
            <Button
              onClick={() => {
                if (persist()) goTo(3);
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total recomendado" value={plan.recommended.total} hint="maior exigência entre parâmetros" icon={<Calculator className="h-5 w-5" />} />
        <Stat label="Execuções" value={plan.runs.length} hint="ordem aleatorizada" icon={<Dices className="h-5 w-5" />} tone="neutral" />
        <Stat label="Níveis" value={plan.recommended.levels} hint={levelsText || '—'} icon={<Beaker className="h-5 w-5" />} />
        <Stat label="Semente" value={<span className="font-mono text-lg">{input.seed}</span>} hint="reproduz a ordem de execução" icon={<Sparkles className="h-5 w-5" />} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Parâmetros do delineamento"
            description="Os padrões são recomendações; qualquer alteração fica registrada."
            icon={<Calculator className="h-4 w-4" />}
            action={
              <Button variant="outline" size="sm" onClick={applyRangeSigma}>
                σ = faixa/{profile.defaultAssumptions.sigmaFromRangeDivisor}
              </Button>
            }
          />
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Tipo de delineamento" className="sm:col-span-2">
              <Select
                value={input.designType}
                disabled={locked}
                onChange={(e) => update('designType', e.target.value as DesignInput['designType'])}
              >
                {profile.designTemplates.map((template) => (
                  <option key={template.id} value={template.designType}>
                    {template.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Input label="Semente" type="number" value={input.seed} disabled={locked} onChange={(e) => update('seed', Number(e.target.value))} />
            <Input label="Confiança" type="number" step="0.01" min="0.5" max="0.999" value={input.confidence} disabled={locked} onChange={(e) => update('confidence', Number(e.target.value))} />
            <Input label="Poder" type="number" step="0.01" min="0.5" max="0.99" value={input.power} disabled={locked} onChange={(e) => update('power', Number(e.target.value))} />
            <Input label="α (bilateral)" type="number" step="0.01" min="0.001" max="0.2" value={input.alpha} disabled={locked} onChange={(e) => update('alpha', Number(e.target.value))} />
            <Input label="σ esperado" type="number" step="any" value={input.sigma} disabled={locked} onChange={(e) => update('sigma', Number(e.target.value))} />
            <Input label="Efeito mínimo detectável" type="number" step="any" value={input.effect} disabled={locked} onChange={(e) => update('effect', Number(e.target.value))} />
            <Input label="Margem de equivalência (TOST)" type="number" step="any" value={input.margin} disabled={locked} onChange={(e) => update('margin', Number(e.target.value))} />
            <Input label="Precisão alvo (semi-amplitude)" type="number" step="any" value={input.targetPrecision} disabled={locked} onChange={(e) => update('targetPrecision', Number(e.target.value))} />
            <Input label="Erro relativo admitido em s" type="number" step="0.01" value={input.relativeSdError} disabled={locked} onChange={(e) => update('relativeSdError', Number(e.target.value))} />
            <Input label="Razão de variâncias" type="number" step="0.1" value={input.varianceRatio} disabled={locked} onChange={(e) => update('varianceRatio', Number(e.target.value))} />
            <Input label="Razão entre laboratórios" type="number" step="0.1" value={input.betweenLabRatio} disabled={locked} onChange={(e) => update('betweenLabRatio', Number(e.target.value))} />
            <Input label="Níveis (n)" type="number" min="2" value={input.nLevels} disabled={locked} onChange={(e) => update('nLevels', Number(e.target.value))} />
            <Input label="Analistas" type="number" min="1" value={input.nAnalysts} disabled={locked} onChange={(e) => update('nAnalysts', Number(e.target.value))} />
            <Input label="Dias" type="number" min="1" value={input.nDays} disabled={locked} onChange={(e) => update('nDays', Number(e.target.value))} />
            <Input label="Equipamentos" type="number" min="1" value={input.nEquipments} disabled={locked} onChange={(e) => update('nEquipments', Number(e.target.value))} />
            <Input label="Lotes" type="number" min="1" value={input.nLots} disabled={locked} onChange={(e) => update('nLots', Number(e.target.value))} />
            <Input label="Réplicas" type="number" min="2" value={input.nReplicates} disabled={locked} onChange={(e) => update('nReplicates', Number(e.target.value))} />
            <Input label="Laboratórios" type="number" min="2" value={input.nLabs} disabled={locked} onChange={(e) => update('nLabs', Number(e.target.value))} />
            <Input label="Amostras (aninhado)" type="number" min="2" value={input.nSamples} disabled={locked} onChange={(e) => update('nSamples', Number(e.target.value))} />
            <Textarea
              label="Níveis experimentais"
              className="min-h-[64px]"
              value={levelsText}
              disabled={locked}
              onChange={(e) => {
                setLevelsText(e.target.value);
                setDirty(true);
              }}
              hint="Separe por vírgula. Use valores numéricos quando o parâmetro exigir níveis quantitativos."
            />
            <Textarea
              label="Fatores (fatorial)"
              className="min-h-[64px]"
              value={factorsText}
              disabled={locked}
              onChange={(e) => {
                setFactorsText(e.target.value);
                setDirty(true);
              }}
              hint="Ex.: temperatura, pH, fluxo."
            />
            <Textarea
              label="Notas do delineamento"
              className="min-h-[64px] sm:col-span-2 lg:col-span-3"
              value={input.notes}
              disabled={locked}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Restrições práticas, equipamentos disponíveis, cronograma…"
            />
            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Switch
                checked={input.manualOverride}
                disabled={locked}
                onChange={(checked) => update('manualOverride', checked)}
                label="Sobrescrever o total calculado"
                description="Use somente com justificativa; o relatório registra o total manual."
              />
              {input.manualOverride ? (
                <Input
                  label="Total manual de medições"
                  type="number"
                  min="2"
                  value={input.manualTotal ?? ''}
                  disabled={locked}
                  onChange={(e) => update('manualTotal', e.target.value ? Number(e.target.value) : null)}
                />
              ) : null}
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Resumo leigo" icon={<Sparkles className="h-4 w-4" />} />
            <CardBody className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
              <p>{plan.summary}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60">
                  <p className="text-ink-400">Analistas</p>
                  <p className="font-semibold">{plan.recommended.analysts}</p>
                </div>
                <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60">
                  <p className="text-ink-400">Dias</p>
                  <p className="font-semibold">{plan.recommended.days}</p>
                </div>
                <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60">
                  <p className="text-ink-400">Réplicas</p>
                  <p className="font-semibold">{plan.recommended.replicates}</p>
                </div>
                <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60">
                  <p className="text-ink-400">Laboratórios</p>
                  <p className="font-semibold">{plan.recommended.labs}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={recalculate}>
                <RefreshCw className="h-3.5 w-3.5" /> Recalcular plano
              </Button>
            </CardBody>
          </Card>

          {plan.warnings.length ? (
            <Alert tone="warning" title="Avisos do delineamento">
              <ul className="list-disc space-y-1 pl-4">
                {plan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <Card>
            <CardHeader title="Pressupostos registrados" />
            <CardBody>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-ink-500">
                {plan.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Curva de poder"
          description="Probabilidade de detectar o efeito mínimo em função do n por grupo."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const nextSeed = Math.floor(Math.random() * 1_000_000);
                const next = { ...plan, input: { ...plan.input, seed: nextSeed } };
                setPlan(rerandomize(next, nextSeed));
                setInput((prev) => ({ ...prev, seed: nextSeed }));
                setDirty(true);
                toast.push(`Nova ordem aleatorizada com semente ${nextSeed}.`);
              }}
            >
              <Dices className="h-3.5 w-3.5" /> Realeatorizar
            </Button>
          }
        />
        <CardBody>
          <PowerCurveChart data={plan.powerCurve} targetPower={input.power} recommended={input.nReplicates} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Cálculo por parâmetro" description="O maior total define o n recomendado do estudo." />
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Parâmetro</th>
                <th>Método</th>
                <th className="text-right">n / grupo</th>
                <th className="text-right">Grupos</th>
                <th className="text-right">Total</th>
                <th className="text-right">Poder</th>
                <th className="text-right">Precisão</th>
                <th>Fórmula</th>
              </tr>
            </thead>
            <tbody>
              {plan.parameterPlans.map((parameter) => {
                const label =
                  profile.parameters.find((definition) => definition.key === parameter.key)?.label ??
                  parameter.key;
                return (
                  <tr key={parameter.key}>
                    <td className="font-medium">{label}</td>
                    <td className="text-xs text-ink-500">{parameter.method}</td>
                    <td className="text-right font-mono text-xs">{parameter.nPerGroup ?? '—'}</td>
                    <td className="text-right font-mono text-xs">{parameter.groups ?? '—'}</td>
                    <td className="text-right font-mono text-xs font-semibold">{parameter.total}</td>
                    <td className="text-right font-mono text-xs">{parameter.achievedPower === null ? '—' : `${(parameter.achievedPower * 100).toFixed(1)}%`}</td>
                    <td className="text-right font-mono text-xs">{parameter.achievedPrecision === null ? '—' : fmt(parameter.achievedPrecision)}</td>
                    <td className="max-w-[260px] font-mono text-[10px] text-ink-500">{parameter.formula}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Plano de execução"
          description={`Primeiras ${Math.min(plan.runs.length, 60)} de ${plan.runs.length} execuções na ordem aleatorizada.`}
          action={
            <Badge tone="outline">
              semente {plan.input.seed}
            </Badge>
          }
        />
        <div className="max-h-[420px] overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nível</th>
                <th>Analista</th>
                <th>Dia</th>
                <th>Equipamento</th>
                <th>Lote</th>
                <th>Amostra</th>
                <th>Réplica</th>
                <th>Combinação</th>
              </tr>
            </thead>
            <tbody>
              {plan.runs.slice(0, 60).map((run) => (
                <tr key={run.runOrder}>
                  <td className="font-mono text-xs">{run.runOrder}</td>
                  <td>{run.level || '—'}</td>
                  <td>{run.analyst || '—'}</td>
                  <td>{run.day || '—'}</td>
                  <td>{run.equipment || '—'}</td>
                  <td>{run.lot || '—'}</td>
                  <td>{run.sample || '—'}</td>
                  <td className="text-center font-mono text-xs">{run.replicate || '—'}</td>
                  <td className="max-w-[360px] truncate text-xs text-ink-500" title={run.combination}>{run.combination}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </StepShell>
  );
}
