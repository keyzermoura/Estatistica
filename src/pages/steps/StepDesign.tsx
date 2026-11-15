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
import {
  buildDesign,
  rerandomize,
  sigmaFromRange,
  sigmaFromTolerance,
} from '../../stats/design';
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
  const attribute = profile.id === 'attribute';
  const physicalDestructive = profile.id === 'physical-destructive';
  const physicalNonDestructive = profile.id === 'physical-nondestructive';
  const physical = physicalDestructive || physicalNonDestructive;
  const defaultInput = (): DesignInput => {
    const template = profile.defaultDesignType
      ? profile.designTemplates.find(
          (candidate) => candidate.designType === profile.defaultDesignType,
        )
      : undefined;
    return {
      ...DEFAULT_DESIGN_INPUT,
      ...(template?.defaults ?? {}),
      ...(profile.defaultDesignType
        ? { designType: profile.defaultDesignType }
        : {}),
      confidence: profile.defaultAssumptions.confidence,
      power: profile.defaultAssumptions.power,
      alpha: profile.defaultAssumptions.alpha,
      sigma: profile.defaultAssumptions.sigma,
      effect: profile.defaultAssumptions.minimumEffect,
      margin: profile.defaultAssumptions.tostMargin,
      seed: Date.now() % 1000000,
    };
  };
  const storedInput = (): DesignInput => {
    const stored = bundle.design?.input;
    return stored ? { ...DEFAULT_DESIGN_INPUT, ...stored } : defaultInput();
  };
  const [input, setInput] = useState<DesignInput>(storedInput);
  const [levelsText, setLevelsText] = useState(() => input.levels.join(', '));
  const [factorsText, setFactorsText] = useState(() => input.factors.join(', '));
  const [plan, setPlan] = useState<DesignPlan>(
    () =>
      bundle.design?.plan ??
      buildDesign(input, {
        selected: bundle.parameters.filter((parameter) => parameter.selected).map((parameter) => parameter.key),
        profileId: profile.id,
      }),
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const nextInput = storedInput();
    setInput(nextInput);
    setLevelsText(nextInput.levels.join(', '));
    setFactorsText(nextInput.factors.join(', '));
    setPlan(
      bundle.design?.plan ??
        buildDesign(nextInput, {
          selected: bundle.parameters
            .filter((parameter) => parameter.selected)
            .map((parameter) => parameter.key),
          profileId: profile.id,
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

  const changeDesignType = (designType: DesignInput['designType']) => {
    const template = profile.designTemplates.find(
      (candidate) => candidate.designType === designType,
    );
    const defaults = template?.defaults ?? {};
    setInput((prev) => ({ ...prev, designType, ...defaults }));
    if (defaults.levels) setLevelsText(defaults.levels.join(', '));
    if (defaults.factors) setFactorsText(defaults.factors.join(', '));
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
    setPlan(buildDesign(normalized, { selected: selectedKeys, profileId: profile.id }));
    setDirty(true);
    toast.push('Plano recalculado. Salve para registrar esta versão.');
  };

  const applyRangeSigma = () => {
    const divisor = profile.defaultAssumptions.sigmaFromRangeDivisor;
    const sigma = sigmaFromRange(
      bundle.method.rangeMin,
      bundle.method.rangeMax,
      divisor,
    );
    if (sigma === null) {
      toast.push('Informe a faixa mínima e máxima do método para estimar σ.', 'danger');
      return;
    }
    setInput((prev) => ({
      ...prev,
      sigma: Number(sigma.toPrecision(4)),
      sigmaSource: `faixa/${divisor} (${fmt(bundle.method.rangeMin)} – ${fmt(bundle.method.rangeMax)} ${bundle.method.unit})`,
    }));
    setDirty(true);
    toast.push(`σ estimado pela faixa: ${fmt(sigma)}. Recalcule o plano.`);
  };

  const applyToleranceSigma = () => {
    const divisor = profile.sigmaFromToleranceDivisor ?? 6;
    const sigma = sigmaFromTolerance(bundle.method.lsl, bundle.method.usl, divisor);
    if (sigma === null) {
      toast.push('Informe LSL e USL (com USL > LSL) para estimar σ = T/6.', 'danger');
      return;
    }
    setInput((prev) => ({
      ...prev,
      sigma: Number(sigma.toPrecision(4)),
      sigmaSource: `T/${divisor} (T = ${fmt((bundle.method.usl ?? 0) - (bundle.method.lsl ?? 0))} ${bundle.method.unit})`,
    }));
    setDirty(true);
    toast.push(`σ estimado pela tolerância: ${fmt(sigma)}. Recalcule o plano.`);
  };

  const persist = (): boolean => {
    if (locked) return false;
    const normalized = normalizedInput();
    const nextPlan = buildDesign(normalized, {
      selected: selectedKeys,
      profileId: profile.id,
    });
    setSaving(true);
    try {
      const actor = bundle.validation.responsible.trim() || 'sistema';
      saveDesign(
        {
          id: bundle.design?.id ?? uid('design'),
          validationId: bundle.validation.id,
          input: normalized,
          plan: nextPlan,
          seed: normalized.seed,
          createdAt: bundle.design?.createdAt ?? nowIso(),
        },
        actor,
        'Delineamento atualizado',
      );
      if (bundle.validation.status === 'draft') {
        updateValidation({ ...bundle.validation, status: 'in_progress' }, actor);
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
      description={
        attribute
          ? 'Defina itens, avaliadores, réplicas e categorias de referência; a ordem e os códigos das amostras são aleatorizados por uma semente reproduzível.'
          : physicalDestructive
            ? 'Planeje operadores, amostras por operador e corpos de prova por amostra; cada corpo de prova é consumido uma única vez e a ordem é aleatorizada por uma semente reproduzível.'
            : physicalNonDestructive
              ? 'Planeje peças, operadores e réplicas do Gage R&R cruzado; as peças são reutilizadas e a ordem é aleatorizada por uma semente reproduzível.'
              : 'Converta o objetivo estatístico em um plano executável: confiança, poder, σ, efeito mínimo, margem, fatores, níveis e aleatorização reprodutível.'
      }
      locked={locked}
      help={
        profile.id === 'dimensional' ? (
          <>
            <p>
              O delineamento recomendado é o <strong>Gage R&amp;R cruzado</strong>: as mesmas peças
              são medidas por todos os operadores, com réplicas independentes e ordem
              aleatorizada pela semente.
            </p>
            <p className="mt-1">
              Use <strong>10 peças</strong> cobrindo a variação real do processo, 3 operadores e
              2–3 réplicas. Se ainda não houver dado piloto, estime σ por{' '}
              <strong>T/6</strong> — a suposição fica registrada no relatório.
            </p>
          </>
        ) : attribute ? (
          <>
            <p>
              O delineamento recomendado é o de <strong>concordância de atributo</strong>: todos os
              avaliadores classificam os mesmos itens, sem conhecer a referência, em réplicas
              independentes. A ordem e os códigos das amostras são aleatorizados pela semente.
            </p>
            <p className="mt-1">
              O padrão AIAG MSA sugere <strong>30 itens</strong>, <strong>3 avaliadores</strong> e
              2–3 réplicas, incluindo itens limítrofes. O total é o produto
              itens × avaliadores × réplicas; a precisão do κ depende também da prevalência das
              categorias.
            </p>
          </>
        ) : physicalDestructive ? (
          <>
            <p>
              O delineamento recomendado é o <strong>estudo aninhado destrutivo</strong>:
              operadores medem amostras do mesmo lote e cada corpo de prova é consumido uma
              única vez. O modelo é Operador &gt; Amostra(Operador) &gt; Corpo de prova.
            </p>
            <p className="mt-1">
              O padrão é <strong>3 operadores × 10 amostras × 3 corpos de prova</strong> = 90
              corpos de prova. A repetibilidade inclui a variação entre corpos de prova; a
              homogeneidade do lote é um pressuposto crítico.
            </p>
          </>
        ) : physicalNonDestructive ? (
          <>
            <p>
              O delineamento recomendado é o <strong>Gage R&amp;R cruzado</strong>: as mesmas
              peças são medidas por todos os operadores, com réplicas independentes e ordem
              aleatorizada pela semente. Não há consumo de corpos de prova.
            </p>
            <p className="mt-1">
              Use <strong>10 peças</strong> cobrindo a variação real do processo, 3 operadores e
              2–3 réplicas. Se ainda não houver dado piloto, estime σ por <strong>T/6</strong>.
            </p>
          </>
        ) : (
          <>
            <p>
              σ é o desvio-padrão esperado do método. Se ainda não houver dado piloto, use
              faixa/6 e registre essa suposição no relatório.
            </p>
            <p className="mt-1">
              O cálculo usa poder para teste t bilateral, precisão do IC da média, TOST, razão de
              variâncias e ISO 5725-2, conforme o parâmetro.
            </p>
          </>
        )
      }
      aside={
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">
            {plan.recommended.total} {attribute ? 'classificações' : 'medições'}
          </Badge>
          <Badge tone="outline">{plan.runs.length} execuções</Badge>
          {plan.specimenConsumption ? (
            <Badge tone="warning">
              {plan.specimenConsumption.total} corpos de prova
            </Badge>
          ) : null}
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
        {attribute ? (
          <>
            <Stat
              label="Classificações"
              value={plan.recommended.total}
              hint="itens × avaliadores × réplicas"
              icon={<Calculator className="h-5 w-5" />}
            />
            <Stat
              label="Itens"
              value={plan.recommended.samples}
              hint={`${plan.recommended.borderlineSamples ?? 0} limítrofes`}
              icon={<Beaker className="h-5 w-5" />}
              tone="neutral"
            />
            <Stat
              label="Avaliadores"
              value={plan.recommended.analysts}
              hint={`${plan.recommended.replicates} réplicas por avaliador`}
              icon={<Dices className="h-5 w-5" />}
              tone="neutral"
            />
            <Stat
              label="Semente"
              value={<span className="font-mono text-lg">{input.seed}</span>}
              hint="reproduz códigos e ordem"
              icon={<Sparkles className="h-5 w-5" />}
              tone="warning"
            />
          </>
        ) : (
          <>
            <Stat label="Total recomendado" value={plan.recommended.total} hint="maior exigência entre parâmetros" icon={<Calculator className="h-5 w-5" />} />
            <Stat label="Execuções" value={plan.runs.length} hint="ordem aleatorizada" icon={<Dices className="h-5 w-5" />} tone="neutral" />
            <Stat label="Níveis" value={plan.recommended.levels} hint={levelsText || '—'} icon={<Beaker className="h-5 w-5" />} />
            <Stat label="Semente" value={<span className="font-mono text-lg">{input.seed}</span>} hint="reproduz a ordem de execução" icon={<Sparkles className="h-5 w-5" />} tone="warning" />
          </>
        )}
        {input.designType === 'gage_rr' ? (
          <Stat
            label="Peças"
            value={plan.recommended.samples}
            hint={`${plan.recommended.analysts} operadores · ${plan.recommended.replicates} réplicas`}
            icon={<Beaker className="h-5 w-5" />}
            tone="neutral"
          />
        ) : null}
        {plan.specimenConsumption ? (
          <Stat
            label="Corpos de prova"
            value={plan.specimenConsumption.total}
            hint="total a retirar do lote"
            icon={<Beaker className="h-5 w-5" />}
            tone="neutral"
          />
        ) : null}
      </div>

      {plan.specimenConsumption ? (
        <Alert tone="info" title="Ensaio destrutivo: consumo de corpos de prova">
          Este plano consome <strong>{plan.specimenConsumption.total}</strong> corpos de prova
          ({plan.specimenConsumption.operators} operadores ×{' '}
          {plan.specimenConsumption.samplesPerOperator} amostras ×{' '}
          {plan.specimenConsumption.replicates} corpos de prova por amostra). Identifique cada
          corpo de prova antes da coleta; o mesmo corpo não pode ser medido duas vezes.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Parâmetros do delineamento"
            description="Os padrões são recomendações; qualquer alteração fica registrada."
            icon={<Calculator className="h-4 w-4" />}
            action={
              attribute ? undefined : (
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={applyRangeSigma}>
                    σ = faixa/{profile.defaultAssumptions.sigmaFromRangeDivisor}
                  </Button>
                  {profile.sigmaFromToleranceDivisor ? (
                    <Button variant="outline" size="sm" onClick={applyToleranceSigma}>
                      σ = T/{profile.sigmaFromToleranceDivisor}
                    </Button>
                  ) : null}
                </div>
              )
            }
          />
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Tipo de delineamento" className="sm:col-span-2">
              <Select
                value={input.designType}
                disabled={locked}
                onChange={(e) =>
                  changeDesignType(e.target.value as DesignInput['designType'])
                }
              >
                {profile.designTemplates.map((template) => (
                  <option key={template.id} value={template.designType}>
                    {template.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Input label="Semente" type="number" value={input.seed} disabled={locked} onChange={(e) => update('seed', Number(e.target.value))} />
            <Input label="Confiança" type="number" step="0.01" min="0.5" max="0.999" value={input.confidence} disabled={locked} onChange={(e) => update('confidence', Number(e.target.value))} hint={attribute ? 'Usada nos intervalos de κ.' : undefined} />
            {attribute ? (
              <>
                <Input label="Avaliadores" type="number" min="2" value={input.nAnalysts} disabled={locked} onChange={(e) => update('nAnalysts', Number(e.target.value))} hint="AIAG MSA recomenda pelo menos 3." />
                <Input label="Réplicas por avaliador" type="number" min="2" value={input.nReplicates} disabled={locked} onChange={(e) => update('nReplicates', Number(e.target.value))} hint="Permite estimar a concordância intra-avaliador." />
                <Input
                  label="Itens (amostras)"
                  type="number"
                  min="2"
                  value={input.nSamples}
                  disabled={locked}
                  onChange={(e) => update('nSamples', Number(e.target.value))}
                  hint="Inclua casos claros de cada categoria e itens limítrofes."
                />
                <Input
                  label="Itens limítrofes (incluídos no total)"
                  type="number"
                  min="0"
                  max={input.nSamples}
                  value={input.nBorderlineSamples}
                  disabled={locked}
                  onChange={(e) => update('nBorderlineSamples', Number(e.target.value))}
                  hint="Itens próximos do limite entre categorias."
                />
                <Textarea
                  label="Categorias de referência"
                  className="min-h-[64px]"
                  value={levelsText}
                  disabled={locked}
                  onChange={(e) => {
                    setLevelsText(e.target.value);
                    setDirty(true);
                  }}
                  hint="Separe por vírgula. Ex.: conforme, não conforme. A referência de cada item será registrada na coleta."
                />
              </>
            ) : (
              <>
                <Input label="Poder" type="number" step="0.01" min="0.5" max="0.99" value={input.power} disabled={locked} onChange={(e) => update('power', Number(e.target.value))} />
                <Input label="α (bilateral)" type="number" step="0.01" min="0.001" max="0.2" value={input.alpha} disabled={locked} onChange={(e) => update('alpha', Number(e.target.value))} />
                <Input label="σ esperado" type="number" step="any" value={input.sigma} disabled={locked} onChange={(e) => update('sigma', Number(e.target.value))} hint={input.sigmaSource ? `Origem: ${input.sigmaSource}` : 'Dado piloto; sem piloto use T/6 ou faixa/6 e registre.'} />
                <Input label="Efeito mínimo detectável" type="number" step="any" value={input.effect} disabled={locked} onChange={(e) => update('effect', Number(e.target.value))} />
                <Input label="Margem de equivalência (TOST)" type="number" step="any" value={input.margin} disabled={locked} onChange={(e) => update('margin', Number(e.target.value))} />
                <Input label="Precisão alvo (semi-amplitude)" type="number" step="any" value={input.targetPrecision} disabled={locked} onChange={(e) => update('targetPrecision', Number(e.target.value))} />
                <Input label="Erro relativo admitido em s" type="number" step="0.01" value={input.relativeSdError} disabled={locked} onChange={(e) => update('relativeSdError', Number(e.target.value))} />
                <Input label="Razão de variâncias" type="number" step="0.1" value={input.varianceRatio} disabled={locked} onChange={(e) => update('varianceRatio', Number(e.target.value))} />
                <Input label="Razão entre laboratórios" type="number" step="0.1" value={input.betweenLabRatio} disabled={locked} onChange={(e) => update('betweenLabRatio', Number(e.target.value))} />
                <Input label="Níveis (n)" type="number" min="2" value={input.nLevels} disabled={locked} onChange={(e) => update('nLevels', Number(e.target.value))} />
                <Input label={physical ? 'Operadores' : 'Analistas'} type="number" min="1" value={input.nAnalysts} disabled={locked} onChange={(e) => update('nAnalysts', Number(e.target.value))} hint={physical ? 'O estudo de precisão exige pelo menos 2 operadores.' : undefined} />
                <Input label="Dias" type="number" min="1" value={input.nDays} disabled={locked} onChange={(e) => update('nDays', Number(e.target.value))} />
                <Input label="Equipamentos" type="number" min="1" value={input.nEquipments} disabled={locked} onChange={(e) => update('nEquipments', Number(e.target.value))} />
                <Input label="Lotes" type="number" min="1" value={input.nLots} disabled={locked} onChange={(e) => update('nLots', Number(e.target.value))} />
                <Input label={physicalDestructive ? 'Corpos de prova por amostra' : 'Réplicas'} type="number" min="2" value={input.nReplicates} disabled={locked} onChange={(e) => update('nReplicates', Number(e.target.value))} hint={physicalDestructive ? 'Cada corpo de prova é consumido uma única vez.' : undefined} />
                <Input label="Laboratórios" type="number" min="2" value={input.nLabs} disabled={locked} onChange={(e) => update('nLabs', Number(e.target.value))} />
                <Input
                  label={
                    physicalDestructive
                      ? 'Amostras por operador (aninhado)'
                      : input.designType === 'gage_rr'
                        ? 'Peças (Gage R&R)'
                        : 'Amostras (aninhado)'
                  }
                  type="number"
                  min={physicalDestructive ? '1' : '2'}
                  value={input.nSamples}
                  disabled={locked}
                  onChange={(e) => update('nSamples', Number(e.target.value))}
                  hint={
                    physicalDestructive
                      ? 'Cada operador avalia o mesmo número de amostras; cada amostra gera vários corpos de prova.'
                      : input.designType === 'gage_rr'
                        ? 'Use 10 peças cobrindo a variação real do processo, não só a tolerância.'
                        : undefined
                  }
                />
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
              </>
            )}
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
                  label={attribute ? 'Total manual de classificações' : 'Total manual de medições'}
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
                {attribute ? (
                  <>
                    <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60">
                      <p className="text-ink-400">Avaliadores</p>
                      <p className="font-semibold">{plan.recommended.analysts}</p>
                    </div>
                    <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60">
                      <p className="text-ink-400">Itens</p>
                      <p className="font-semibold">{plan.recommended.samples}</p>
                    </div>
                    <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60">
                      <p className="text-ink-400">Limítrofes</p>
                      <p className="font-semibold">{plan.recommended.borderlineSamples ?? 0}</p>
                    </div>
                    <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60">
                      <p className="text-ink-400">Réplicas</p>
                      <p className="font-semibold">{plan.recommended.replicates}</p>
                    </div>
                    <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/60 col-span-2">
                      <p className="text-ink-400">Categorias de referência</p>
                      <p className="font-semibold">{levelsText || '—'}</p>
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
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
          title={attribute ? 'Aleatorização e cegamento' : 'Curva de poder'}
          description={
            attribute
              ? 'A semente reproduz os códigos das amostras e a ordem de apresentação. O avaliador não deve ver a referência.'
              : 'Probabilidade de detectar o efeito mínimo em função do n por grupo.'
          }
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const nextSeed = Math.floor(Math.random() * 1_000_000);
                const next = { ...plan, input: { ...plan.input, seed: nextSeed } };
                setPlan(rerandomize(next, nextSeed, profile.id));
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
          {attribute ? (
            <div className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
              <p>
                Cada avaliador recebe os itens em ordem aleatória, identificados apenas pelo
                código cego. A referência de cada item é registrada separadamente pelo
                responsável pelo estudo e não é exibida durante a classificação.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-ink-500">
                <li>Não use o mesmo código para itens diferentes entre avaliadores.</li>
                <li>Mantenha as réplicas do mesmo avaliador separadas no tempo.</li>
                <li>Registre a categoria observada sem consultar a referência.</li>
                <li>Se a semente mudar, salve o delineamento para preservar a rastreabilidade.</li>
              </ul>
            </div>
          ) : (
            <PowerCurveChart data={plan.powerCurve} targetPower={input.power} recommended={input.nReplicates} />
          )}
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
                <th className="text-right">{attribute ? 'Itens' : 'n / grupo'}</th>
                <th className="text-right">{attribute ? 'Avaliadores × réplicas' : 'Grupos'}</th>
                <th className="text-right">Total</th>
                {!attribute ? (
                  <>
                    <th className="text-right">Poder</th>
                    <th className="text-right">Precisão</th>
                  </>
                ) : null}
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
                    <td className="text-xs text-ink-500">
                      {parameter.method === 'attribute_agreement'
                        ? 'concordância de atributo'
                        : parameter.method}
                    </td>
                    <td className="text-right font-mono text-xs">{parameter.nPerGroup ?? '—'}</td>
                    <td className="text-right font-mono text-xs">{parameter.groups ?? '—'}</td>
                    <td className="text-right font-mono text-xs font-semibold">{parameter.total}</td>
                    {!attribute ? (
                      <>
                        <td className="text-right font-mono text-xs">{parameter.achievedPower === null ? '—' : `${(parameter.achievedPower * 100).toFixed(1)}%`}</td>
                        <td className="text-right font-mono text-xs">{parameter.achievedPrecision === null ? '—' : fmt(parameter.achievedPrecision)}</td>
                      </>
                    ) : null}
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
                {!attribute ? (
                  <>
                    <th>Nível</th>
                    <th>Analista</th>
                    <th>Dia</th>
                    <th>Equipamento</th>
                    <th>Lote</th>
                  </>
                ) : null}
                <th>Amostra</th>
                {attribute ? <th>Avaliador</th> : null}
                {plan.runs.some((run) => run.partId) ? <th>Peça</th> : null}
                {plan.runs.some((run) => run.specimen) ? <th>Corpo de prova</th> : null}
                <th>Réplica</th>
                <th>Combinação</th>
              </tr>
            </thead>
            <tbody>
              {plan.runs.slice(0, 60).map((run) => (
                <tr key={run.runOrder}>
                  <td className="font-mono text-xs">{run.runOrder}</td>
                  {!attribute ? (
                    <>
                      <td>{run.level || '—'}</td>
                      <td>{run.analyst || '—'}</td>
                      <td>{run.day || '—'}</td>
                      <td>{run.equipment || '—'}</td>
                      <td>{run.lot || '—'}</td>
                    </>
                  ) : null}
                  <td>{run.sample || '—'}</td>
                  {attribute ? <td>{run.analyst || '—'}</td> : null}
                  {plan.runs.some((item) => item.partId) ? (
                    <td className="font-mono text-xs">{run.partId || '—'}</td>
                  ) : null}
                  {plan.runs.some((item) => item.specimen) ? (
                    <td className="font-mono text-xs">{run.specimen || '—'}</td>
                  ) : null}
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
