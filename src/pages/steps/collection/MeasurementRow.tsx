import React from 'react';
import { Trash2 } from 'lucide-react';
import type { Measurement } from '../../../lib/types';
import { parseNumber } from '../../../lib/utils';
import { Button } from '../../../components/ui';

export interface MeasurementRowProps {
  row: Measurement;
  idx: number;
  locked: boolean;
  attribute: boolean;
  showPartColumn: boolean;
  showSpecimenColumn: boolean;
  showsReference: boolean;
  onPatch: (id: string, value: Partial<Measurement>) => void;
  onRemove: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, colKey: string, rowIndex: number) => void;
  inputClass: string;
}

export const MeasurementRow = React.memo(function MeasurementRow({
  row,
  idx,
  locked,
  attribute,
  showPartColumn,
  showSpecimenColumn,
  showsReference,
  onPatch,
  onRemove,
  onKeyDown,
  inputClass,
}: MeasurementRowProps) {
  return (
    <tr
      key={row.id}
      className="odd:bg-white even:bg-ink-50/40 dark:odd:bg-ink-900 dark:even:bg-ink-950/40"
      style={{ height: 44 }}
    >
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          type="number"
          data-col="runOrder"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'runOrder', idx)}
          className={`${inputClass} w-16`}
          value={row.runOrder}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { runOrder: Number(e.target.value) })}
        />
      </td>
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          data-col="level"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'level', idx)}
          className={`${inputClass} w-24`}
          value={row.level}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { level: e.target.value })}
          placeholder={attribute ? 'conforme' : '5'}
        />
      </td>
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          data-col="analyst"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'analyst', idx)}
          className={`${inputClass} w-28`}
          value={row.analyst}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { analyst: e.target.value })}
          placeholder="Ana"
        />
      </td>
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          data-col="day"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'day', idx)}
          className={`${inputClass} w-16`}
          value={row.day}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { day: e.target.value })}
          placeholder="D1"
        />
      </td>
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          data-col="equipment"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'equipment', idx)}
          className={`${inputClass} w-20`}
          value={row.equipment}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { equipment: e.target.value })}
          placeholder="HPLC-1"
        />
      </td>
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          data-col="lot"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'lot', idx)}
          className={`${inputClass} w-24`}
          value={row.lot}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { lot: e.target.value })}
        />
      </td>
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          data-col="sample"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'sample', idx)}
          className={`${inputClass} w-28`}
          value={row.sample}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { sample: e.target.value })}
        />
      </td>
      {showPartColumn ? (
        <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
          <input
            data-col="partId"
            data-row={idx}
            onKeyDown={(e) => onKeyDown(e, 'partId', idx)}
            className={`${inputClass} w-20 font-mono`}
            value={row.partId ?? ''}
            disabled={locked}
            onChange={(e) => onPatch(row.id, { partId: e.target.value })}
            placeholder="P-01"
          />
        </td>
      ) : null}
      {showSpecimenColumn ? (
        <>
          <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
            <input
              data-col="specimen"
              data-row={idx}
              onKeyDown={(e) => onKeyDown(e, 'specimen', idx)}
              className={`${inputClass} w-24 font-mono ${
                (row.destructive ?? true) && !(row.specimen ?? '').trim()
                  ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20'
                  : ''
              }`}
              value={row.specimen ?? ''}
              disabled={locked}
              onChange={(e) => onPatch(row.id, { specimen: e.target.value })}
              placeholder="CP-001"
            />
          </td>
          <td className="border-b border-ink-100 px-1.5 py-1 text-center dark:border-ink-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              checked={row.destructive ?? true}
              disabled={locked}
              onChange={(e) => onPatch(row.id, { destructive: e.target.checked })}
              aria-label={`Linha ${row.runOrder} é destrutiva`}
            />
          </td>
        </>
      ) : null}
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          type="number"
          data-col="replicate"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'replicate', idx)}
          className={`${inputClass} w-14 text-center`}
          value={row.replicate}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { replicate: Number(e.target.value) })}
        />
      </td>
      {attribute ? (
        <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
          <input
            data-col="category"
            data-row={idx}
            onKeyDown={(e) => onKeyDown(e, 'category', idx)}
            className={`${inputClass} w-32 ${
              (row.category ?? '').trim() === '' &&
              row.textValue.trim() === '' &&
              row.value === null
                ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20'
                : ''
            }`}
            value={row.category ?? ''}
            disabled={locked}
            onChange={(e) => onPatch(row.id, { category: e.target.value })}
            placeholder="conforme"
          />
        </td>
      ) : (
        <>
          <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
            <input
              type="number"
              step="any"
              data-col="value"
              data-row={idx}
              onKeyDown={(e) => onKeyDown(e, 'value', idx)}
              className={`${inputClass} w-24 ${row.value === null && row.textValue === '' ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20' : ''}`}
              value={row.value ?? ''}
              disabled={locked}
              onChange={(e) => onPatch(row.id, { value: parseNumber(e.target.value) })}
            />
          </td>
          <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
            <input
              type="number"
              step="any"
              data-col="referenceValue"
              data-row={idx}
              onKeyDown={(e) => onKeyDown(e, 'referenceValue', idx)}
              className={`${inputClass} w-24`}
              value={row.referenceValue ?? ''}
              disabled={locked}
              onChange={(e) => onPatch(row.id, { referenceValue: parseNumber(e.target.value) })}
              placeholder="—"
            />
          </td>
        </>
      )}
      {showsReference ? (
        <>
          <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
            <input
              type="number"
              step="any"
              data-col="refValue"
              data-row={idx}
              onKeyDown={(e) => onKeyDown(e, 'refValue', idx)}
              className={`${inputClass} w-24`}
              value={row.refValue ?? ''}
              disabled={locked}
              onChange={(e) => onPatch(row.id, { refValue: parseNumber(e.target.value) })}
              placeholder="—"
            />
          </td>
          <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
            <input
              type="number"
              step="any"
              data-col="refUncertainty"
              data-row={idx}
              onKeyDown={(e) => onKeyDown(e, 'refUncertainty', idx)}
              className={`${inputClass} w-24`}
              value={row.refUncertainty ?? ''}
              disabled={locked}
              onChange={(e) =>
                onPatch(row.id, { refUncertainty: parseNumber(e.target.value) })
              }
              placeholder="U_ref"
            />
          </td>
        </>
      ) : null}
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          data-col="textValue"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'textValue', idx)}
          className={`${inputClass} w-32`}
          value={row.textValue}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { textValue: e.target.value })}
          placeholder="positivo/negativo"
        />
      </td>
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <input
          data-col="notes"
          data-row={idx}
          onKeyDown={(e) => onKeyDown(e, 'notes', idx)}
          className={`${inputClass} w-40`}
          value={row.notes}
          disabled={locked}
          onChange={(e) => onPatch(row.id, { notes: e.target.value })}
        />
      </td>
      <td className="border-b border-ink-100 px-1.5 py-1 dark:border-ink-800">
        <Button
          variant="ghost"
          size="icon"
          disabled={locked}
          onClick={() => onRemove(row.id)}
          title="Remover linha"
        >
          <Trash2 className="h-4 w-4 text-rose-500" />
        </Button>
      </td>
    </tr>
  );
});
