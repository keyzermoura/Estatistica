import { describe, expect, it } from 'vitest';
import {
  assertMeasurementIdentities,
  assertMethodTolerance,
  normalizeMethodFamily,
  validateMeasurementIdentities,
  validateMethodTolerance,
} from '../validation';

describe('validações do modelo de dados', () => {
  it('exige part_id na família dimensional', () => {
    const issues = validateMeasurementIdentities(
      [
        { runOrder: 1, partId: 'P-1', specimen: '', destructive: false },
        { runOrder: 2, partId: '  ', specimen: '', destructive: false },
      ],
      'dimensional',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('part_id');
    expect(issues[0]).toContain('Linha 2');
    expect(() =>
      assertMeasurementIdentities([{ runOrder: 1, partId: '' }], 'dimensional'),
    ).toThrow(/part_id/);
    expect(() =>
      assertMeasurementIdentities([{ runOrder: 1, partId: '' }], 'analytical'),
    ).not.toThrow();
  });

  it('exige specimen quando destructive = 1', () => {
    const issues = validateMeasurementIdentities(
      [
        { runOrder: 1, partId: 'P-1', specimen: 'CP-1', destructive: true },
        { runOrder: 2, partId: 'P-2', specimen: '', destructive: 1 },
      ],
      'physical-destructive',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('corpo de prova');
    expect(issues[0]).toContain('Linha 2');
    expect(() =>
      assertMeasurementIdentities(
        [{ runOrder: 1, specimen: 'CP-1', destructive: true }],
        'physical-destructive',
      ),
    ).not.toThrow();
  });

  it('exige LSL menor que USL quando ambos existem', () => {
    expect(validateMethodTolerance({ lsl: 1, usl: 2 })).toEqual([]);
    expect(validateMethodTolerance({ lsl: null, usl: 2 })).toEqual([]);
    expect(validateMethodTolerance({ lsl: 2, usl: 2 })[0]).toContain('LSL');
    expect(validateMethodTolerance({ lsl: 3, usl: 2 })[0]).toContain('USL');
    expect(() => assertMethodTolerance({ lsl: 10, usl: 9 })).toThrow(/LSL/);
  });

  it('normaliza famílias antigas/desconhecidas para analytical', () => {
    expect(normalizeMethodFamily(undefined)).toBe('analytical');
    expect(normalizeMethodFamily('')).toBe('analytical');
    expect(normalizeMethodFamily('DIMENSIONAL')).toBe('dimensional');
    expect(normalizeMethodFamily('physical-destructive')).toBe('physical-destructive');
    expect(normalizeMethodFamily('inexistente')).toBe('analytical');
  });
});
