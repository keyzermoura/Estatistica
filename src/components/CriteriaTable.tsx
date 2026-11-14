import { Plus, Trash2 } from 'lucide-react';
import type { AcceptanceCriterion, ParamKey } from '../lib/types';
import { criterionText, makeCriterion } from '../lib/criteria';
import type { MethodProfile } from '../profiles/types';
import { Button, Input, Select } from './ui';

export function CriteriaTable({
  profile,
  parameter,
  criteria,
  onChange,
  disabled,
}: {
  profile: MethodProfile;
  parameter: ParamKey;
  criteria: AcceptanceCriterion[];
  onChange: (criteria: AcceptanceCriterion[]) => void;
  disabled?: boolean;
}) {
  const definitions =
    profile.parameters.find((definition) => definition.key === parameter)?.metrics ?? [];
  const update = (id: string, patch: Partial<AcceptanceCriterion>) => {
    onChange(criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const remove = (id: string) => onChange(criteria.filter((c) => c.id !== id));
  const add = () => {
    const used = new Set(criteria.map((c) => c.metric));
    const definition = definitions.find((d) => !used.has(d.key)) ?? definitions[0];
    if (!definition) return;
    onChange([
      ...criteria,
      makeCriterion(parameter, definition, `${parameter}-${Date.now().toString(36)}`),
    ]);
  };
  return (
    <div className="space-y-2">
      {criteria.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-300 px-3 py-3 text-xs text-ink-500 dark:border-ink-700">
          Nenhum critério cadastrado. Sem critério, o parâmetro será exibido como “não avaliado”.
        </p>
      ) : (
        <div className="space-y-2">
          {criteria.map((criterion) => {
            const definition = definitions.find((d) => d.key === criterion.metric);
            return (
              <div key={criterion.id} className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <Select
                    aria-label="Métrica"
                    className="sm:col-span-4"
                    value={criterion.metric}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = definitions.find((d) => d.key === e.target.value);
                      update(criterion.id, {
                        metric: e.target.value,
                        unit: next?.unit ?? '',
                        limit: next?.suggested?.limit ?? criterion.limit,
                        limit2: next?.suggested?.limit2,
                        operator: next?.suggested?.operator ?? criterion.operator,
                      });
                    }}
                  >
                    {definitions.map((d) => (
                      <option
                        key={d.key}
                        value={d.key}
                        disabled={
                          d.key !== criterion.metric &&
                          criteria.some(
                            (item) => item.id !== criterion.id && item.metric === d.key,
                          )
                        }
                      >
                        {d.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label="Operador"
                    className="sm:col-span-2"
                    value={criterion.operator}
                    disabled={disabled}
                    onChange={(e) =>
                      update(criterion.id, {
                        operator: e.target.value as AcceptanceCriterion['operator'],
                      })
                    }
                  >
                    <option value=">=">≥</option>
                    <option value="<=">≤</option>
                    <option value="between">entre</option>
                  </Select>
                  <Input
                    aria-label="Limite"
                    className="sm:col-span-2"
                    type="number"
                    step="any"
                    value={criterion.limit}
                    disabled={disabled}
                    onChange={(e) => update(criterion.id, { limit: Number(e.target.value) })}
                  />
                  {criterion.operator === 'between' ? (
                    <Input
                      aria-label="Limite superior"
                      className="sm:col-span-2"
                      type="number"
                      step="any"
                      value={criterion.limit2 ?? criterion.limit}
                      disabled={disabled}
                      onChange={(e) => update(criterion.id, { limit2: Number(e.target.value) })}
                    />
                  ) : criterion.operator === '>=' &&
                    criterion.limit2 !== undefined ? (
                    <Input
                      aria-label="Limite de atenção"
                      className="sm:col-span-2"
                      type="number"
                      step="any"
                      value={criterion.limit2}
                      disabled={disabled}
                      onChange={(e) => update(criterion.id, { limit2: Number(e.target.value) })}
                      title="Abaixo deste valor o resultado é não conforme; entre este valor e o limite, é atenção."
                    />
                  ) : (
                    <div className="hidden sm:col-span-2 sm:block" />
                  )}
                  <div className="flex items-center gap-1 sm:col-span-2">
                    <span className="text-xs text-ink-400">{criterion.unit || definition?.unit || ''}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto text-ink-400 hover:text-rose-600"
                      disabled={disabled}
                      onClick={() => remove(criterion.id)}
                      title="Remover critério"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-ink-500">
                    Critério: {definition?.label ?? criterion.metric} {criterionText(criterion)}
                  </p>
                  <Input
                    aria-label="Nota do critério"
                    className="h-8 max-w-xs text-xs"
                    placeholder="Nota / referência do critério"
                    value={criterion.note ?? ''}
                    disabled={disabled}
                    onChange={(e) => update(criterion.id, { note: e.target.value })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled || definitions.length === 0}
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar critério
      </Button>
    </div>
  );
}
