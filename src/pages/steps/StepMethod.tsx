import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, FlaskConical, Plus, Save, Sparkles } from 'lucide-react';
import type {
  AcceptanceCriterion,
  Method,
  MethodFamily,
  MethodType,
  ParamKey,
  Validation,
  ValidationType,
} from '../../lib/types';
import {
  METHOD_FAMILY_LABELS,
  METHOD_TYPE_LABELS,
  VALIDATION_TYPE_LABELS,
} from '../../lib/types';
import { saveMethod, updateValidation } from '../../lib/repository';
import { getProfileForFamily } from '../../profiles/index';
import { parseNumber } from '../../lib/utils';
import { CriteriaTable } from '../../components/CriteriaTable';
import { StepShell } from '../../components/wizard';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
} from '../../components/ui';
import type { StepProps } from './types';

export function StepMethod({ bundle, goTo, reload }: StepProps) {
  const toast = useToast();
  const locked = bundle.validation.locked;
  const [method, setMethod] = useState<Method>(bundle.method);
  const [validation, setValidation] = useState<Validation>(bundle.validation);
  const profile = getProfileForFamily(method.family);
  const [criteriaParameter, setCriteriaParameter] = useState<ParamKey>(
    profile.defaultMethodCriteria[0]?.parameter ?? profile.parameters[0]!.key,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMethod(bundle.method);
    setValidation(bundle.validation);
  }, [bundle.method, bundle.validation]);

  useEffect(() => {
    if (!profile.parameters.some((parameter) => parameter.key === criteriaParameter)) {
      setCriteriaParameter(
        profile.defaultMethodCriteria[0]?.parameter ?? profile.parameters[0]!.key,
      );
    }
  }, [profile, criteriaParameter]);

  const methodCriteria = useMemo(
    () => method.criteria.filter((criterion) => criterion.parameter === criteriaParameter),
    [method.criteria, criteriaParameter],
  );

  const showTolerance = method.family !== 'analytical' && method.family !== 'attribute';
  const tolerance =
    method.lsl !== null &&
    method.usl !== null &&
    method.usl > method.lsl
      ? method.usl - method.lsl
      : null;

  const setCriteria = (criteria: AcceptanceCriterion[]) => {
    setMethod((prev) => ({
      ...prev,
      criteria: [...prev.criteria.filter((c) => c.parameter !== criteriaParameter), ...criteria],
    }));
  };

  const addSuggestedCriteria = () => {
    const existing = new Set(methodCriteria.map((criterion) => criterion.metric));
    const additions = (profile.defaultCriteria[criteriaParameter] ?? []).filter(
      (criterion) => !existing.has(criterion.metric),
    );
    if (!additions.length) {
      toast.push('As métricas sugeridas para este parâmetro já estão cadastradas.');
      return;
    }
    setCriteria([...methodCriteria, ...additions]);
  };

  const persist = (): boolean => {
    if (locked) return false;
    if (!method.code.trim() || !method.name.trim()) {
      toast.push('Informe o código e o nome do método.', 'danger');
      return false;
    }
    if (!validation.title.trim()) {
      toast.push('Informe o título da validação.', 'danger');
      return false;
    }
    setSaving(true);
    try {
      saveMethod(method);
      updateValidation({
        ...validation,
        status: validation.status === 'draft' ? 'in_progress' : validation.status,
        objective: validation.objective,
        scope: validation.scope,
      });
      toast.push('Método e identificação salvos.');
      reload();
      return true;
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao salvar.', 'danger');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepShell
      step={0}
      title="Método e identificação"
      description="Registre o método analítico, a faixa declarada, as referências normativas e os critérios globais de aceitação. Esses dados aparecem no relatório e alimentam a avaliação."
      locked={locked}
      help={
        <>
          <p>
            Os critérios cadastrados aqui valem para todas as validações do método. Você pode
            adicionar critérios específicos por validação na etapa de Parâmetros.
          </p>
          <p className="mt-1">
            Sem critério cadastrado, o resultado correspondente será exibido como “não avaliado”.
          </p>
        </>
      }
      footer={
        <>
          <Button variant="ghost" disabled={locked} onClick={() => goTo(0)}>
            <ArrowLeft className="h-4 w-4" /> Início
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={persist} disabled={locked} loading={saving}>
              <Save className="h-4 w-4" /> Salvar
            </Button>
            <Button
              onClick={() => {
                if (persist()) goTo(1);
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
      {locked ? (
        <Alert tone="warning" title="Somente leitura">
          A validação está aprovada e bloqueada. Crie uma nova versão na etapa de Auditoria para
          editar.
        </Alert>
      ) : null}

      {method.family === 'dimensional' ? (
        <Alert tone="info" title="Perfil dimensional: o que preencher">
          <p>
            <strong>LSL</strong> e <strong>USL</strong> são os limites de tolerância da peça
            (menor e maior valor aceitável). A tolerância é{' '}
            <strong>T = USL − LSL</strong>
            {tolerance === null ? '; informe os dois limites para calculá-la.' : ` = ${tolerance}.`}
          </p>
          <p className="mt-1">
            A <strong>resolução</strong> é a menor diferença que o instrumento consegue mostrar
            (por exemplo, 0,01 mm). Ela deve ser no máximo 10% da tolerância; caso contrário, o
            sistema não distingue peças conformes de não conformes com segurança.
          </p>
          <p className="mt-1">
            A <strong>unidade</strong> deve ser a mesma de LSL, USL, resolução e das medições
            (por exemplo, mm). O relatório usa essa unidade em todas as tabelas.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Identificação do método"
          description="Dados usados no cabeçalho do relatório e nos exports."
          icon={<FlaskConical className="h-4 w-4" />}
        />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Código"
            required
            value={method.code}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, code: e.target.value })}
            placeholder="HPLC-CAF-01"
          />
          <Input
            label="Nome do método"
            required
            className="sm:col-span-1 lg:col-span-3"
            value={method.name}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, name: e.target.value })}
            placeholder="Cafeína em bebidas por HPLC-UV"
          />
          <Field label="Tipo de método">
            <Select
              value={method.type}
              disabled={locked}
              onChange={(e) => setMethod({ ...method, type: e.target.value as MethodType })}
            >
              {Object.entries(METHOD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Família de ensaio"
            hint="Define o perfil estatístico aplicado. Validações antigas permanecem analíticas."
          >
            <Select
              value={method.family}
              disabled={locked}
              onChange={(e) =>
                setMethod({ ...method, family: e.target.value as MethodFamily })
              }
            >
              {Object.entries(METHOD_FAMILY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de validação">
            <Select
              value={method.validationType}
              disabled={locked}
              onChange={(e) =>
                setMethod({ ...method, validationType: e.target.value as ValidationType })
              }
            >
              {Object.entries(VALIDATION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Input
            label="Unidade"
            value={method.unit}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, unit: e.target.value })}
            placeholder="mg/L"
            hint={
              method.family === 'dimensional'
                ? 'Use a mesma unidade de LSL, USL, resolução e medições (ex.: mm).'
                : undefined
            }
          />
          <Input
            label="Equipamento principal"
            value={method.equipment}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, equipment: e.target.value })}
            placeholder="HPLC, coluna C18…"
          />
          <Input
            label="Faixa mínima"
            type="number"
            step="any"
            value={method.rangeMin ?? ''}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, rangeMin: parseNumber(e.target.value) })}
          />
          <Input
            label="Faixa máxima"
            type="number"
            step="any"
            value={method.rangeMax ?? ''}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, rangeMax: parseNumber(e.target.value) })}
          />
          <Input
            label="Mensurando"
            value={method.measurand}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, measurand: e.target.value })}
            placeholder="Diâmetro externo, resistência à tração…"
          />
          {showTolerance ? (
            <>
              <Input
                label="LSL — limite inferior"
                type="number"
                step="any"
                value={method.lsl ?? ''}
                disabled={locked}
                onChange={(e) => setMethod({ ...method, lsl: parseNumber(e.target.value) })}
                hint={
                  method.family === 'dimensional'
                    ? 'Menor valor aceitável da peça. Deve ser menor que o USL.'
                    : 'Deve ser menor que o USL.'
                }
              />
              <Input
                label="USL — limite superior"
                type="number"
                step="any"
                value={method.usl ?? ''}
                disabled={locked}
                onChange={(e) => setMethod({ ...method, usl: parseNumber(e.target.value) })}
                hint={
                  method.family === 'dimensional'
                    ? `Maior valor aceitável da peça. T = USL − LSL${tolerance === null ? '' : ` = ${tolerance}`}.`
                    : undefined
                }
              />
              <Input
                label="Resolução"
                type="number"
                step="any"
                value={method.resolution ?? ''}
                disabled={locked}
                onChange={(e) =>
                  setMethod({ ...method, resolution: parseNumber(e.target.value) })
                }
                hint={
                  method.family === 'dimensional'
                    ? 'Menor incremento mostrado pelo instrumento; deve ser ≤ 10% de T.'
                    : 'Menor incremento distinguível do instrumento.'
                }
              />
              <Input
                label="Unidade da tolerância"
                value={method.toleranceUnit}
                disabled={locked}
                onChange={(e) => setMethod({ ...method, toleranceUnit: e.target.value })}
                placeholder="mm, N, °C…"
              />
            </>
          ) : null}
          <Input
            label="Norma / referência"
            className="sm:col-span-2 lg:col-span-4"
            value={method.referenceNorm}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, referenceNorm: e.target.value })}
            placeholder="ISO/IEC 17025:2017; ICH Q2(R2)"
          />
          <Textarea
            label="Descrição do método"
            className="sm:col-span-2 lg:col-span-4"
            value={method.description}
            disabled={locked}
            onChange={(e) => setMethod({ ...method, description: e.target.value })}
            placeholder="Princípio analítico, matriz, analito e faixa de aplicação."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Validação e responsáveis"
          description="Objetivo, escopo e nomes que constam no relatório."
        />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Título da validação"
            required
            className="sm:col-span-2"
            value={validation.title}
            disabled={locked}
            onChange={(e) => setValidation({ ...validation, title: e.target.value })}
          />
          <Textarea
            label="Objetivo"
            className="sm:col-span-2"
            value={validation.objective}
            disabled={locked}
            onChange={(e) => setValidation({ ...validation, objective: e.target.value })}
            hint="Descreva a finalidade e o que será demonstrado."
          />
          <Textarea
            label="Escopo"
            className="sm:col-span-2"
            value={validation.scope}
            disabled={locked}
            onChange={(e) => setValidation({ ...validation, scope: e.target.value })}
            hint="Matriz, analito, faixa e limitações de aplicação."
          />
          <Input
            label="Responsável pela elaboração"
            value={validation.responsible}
            disabled={locked}
            onChange={(e) => setValidation({ ...validation, responsible: e.target.value })}
          />
          <Input
            label="Revisor"
            value={validation.reviewer}
            disabled={locked}
            onChange={(e) => setValidation({ ...validation, reviewer: e.target.value })}
          />
          <Input
            label="Aprovador"
            value={validation.approver}
            disabled={locked}
            onChange={(e) => setValidation({ ...validation, approver: e.target.value })}
          />
          <div className="hidden sm:block" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Critérios de aceitação do método"
          description="Parâmetros e limites usados para julgar a adequação ao uso. Podem ser complementados por validação."
          action={
            <Button variant="outline" size="sm" disabled={locked} onClick={addSuggestedCriteria}>
              <Sparkles className="h-3.5 w-3.5" /> Sugerir métricas
            </Button>
          }
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {profile.parameters.map((parameter) => {
              const count = method.criteria.filter((c) => c.parameter === parameter.key).length;
              return (
                <button
                  key={parameter.key}
                  type="button"
                  onClick={() => setCriteriaParameter(parameter.key)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    criteriaParameter === parameter.key
                      ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                      : 'border-ink-200 text-ink-500 hover:border-brand-300 dark:border-ink-700 dark:text-ink-400'
                  }`}
                >
                  {parameter.label}
                  {count ? <span className="rounded-full bg-ink-100 px-1.5 text-[10px] dark:bg-ink-800">{count}</span> : null}
                </button>
              );
            })}
          </div>
          <CriteriaTable
            profile={profile}
            parameter={criteriaParameter}
            criteria={methodCriteria}
            onChange={setCriteria}
            disabled={locked}
          />
          <p className="flex items-center gap-1.5 text-[11px] text-ink-400">
            <Plus className="h-3 w-3" /> Ao adicionar um critério sem limite definido, ajuste o valor e o operador.
          </p>
        </CardBody>
      </Card>
    </StepShell>
  );
}
