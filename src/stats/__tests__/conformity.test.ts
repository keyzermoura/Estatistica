/**
 * Referências dos testes:
 *
 * - Probabilidade de conformidade condicional, sob X_verdadeiro ~ N(x, u²):
 *   P = ∫_{LSL}^{USL} φ(t; x, u) dt. Os riscos específicos são comparados com
 *   uma integração numérica independente (Simpson) da densidade normal,
 *   tolerância 1e-6, sem reutilizar `normalCdf` no integrador.
 * - Valores exatos: Φ(2,5) = 0,9937903346742238; Φ(5) = 0,9999997133484281;
 *   Φ(4/3) = 0,9087887802741321; Φ(2,5) − Φ(−2,5) = 0,9875806693484477.
 * - TUR/TAR = T/(2U), %P/T = 100·U/T e U/T = U/T.
 * - JCGM 106:2012 (risco específico) e ILAC-G8:09/2019 (regra de decisão).
 * - Bordas: x exatamente no limite, u = 0 e banda de guarda maior que T/2
 *   (zona de aceitação vazia, nenhuma aceitação possível).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFORMITY_CRITERIA,
  conformityDecision,
  probabilityOfConformity,
  type ConformityInput,
} from '../index';

const close = (actual: number | null, expected: number, tol = 1e-9) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tol);
};

const base = (overrides: Partial<ConformityInput> = {}): ConformityInput => ({
  value: 10,
  standardUncertainty: 0.2,
  coverageFactor: 2,
  lsl: 9.5,
  usl: 10.5,
  rule: 'simple_acceptance',
  ...overrides,
});

function normalPdf(t: number, mean: number, sd: number): number {
  const z = (t - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

function simpson(
  f: (t: number) => number,
  a: number,
  b: number,
  intervals = 200_000,
): number {
  const n = intervals % 2 === 0 ? intervals : intervals + 1;
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) {
    sum += (i % 2 === 0 ? 2 : 4) * f(a + i * h);
  }
  return (h / 3) * sum;
}

function integrateNormal(
  mean: number,
  sd: number,
  a: number,
  b: number,
): number {
  if (a === b) return 0;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return simpson((t) => normalPdf(t, mean, sd), low, high);
}

describe('probabilidade de conformidade', () => {
  it('reproduz Φ(2,5) − Φ(−2,5) e os limites unilaterais', () => {
    close(probabilityOfConformity(10, 0.2, 9.5, 10.5), 0.9875806693484477, 1e-6);
    close(probabilityOfConformity(10, 0.3, null, 10.4), 0.9087887802741321, 1e-6);
    close(probabilityOfConformity(10, 0.3, 9.6, null), 0.9087887802741321, 1e-6);
  });

  it('trata u = 0 e x exatamente no limite com distribuição degenerada', () => {
    expect(probabilityOfConformity(10, 0, 9, 11)).toBe(1);
    expect(probabilityOfConformity(9, 0, 9, 11)).toBe(1);
    expect(probabilityOfConformity(11, 0, 9, 11)).toBe(1);
    expect(probabilityOfConformity(12, 0, 9, 11)).toBe(0);
    expect(probabilityOfConformity(10, 0, 9, null)).toBe(1);
    expect(probabilityOfConformity(8, 0, 9, null)).toBe(0);
  });
});

describe('riscos específicos contra integração numérica independente', () => {
  const cases: Array<{
    value: number;
    u: number;
    lsl: number | null;
    usl: number | null;
  }> = [
    { value: 10, u: 0.2, lsl: 9.5, usl: 10.5 },
    { value: 9.7, u: 0.6, lsl: 9, usl: 11 },
    { value: 10, u: 0.3, lsl: null, usl: 10.4 },
    { value: 10, u: 0.3, lsl: 9.6, usl: null },
  ];

  for (const item of cases) {
    it(`confere P, falso aceite e falso rejeite para x=${item.value}, u=${item.u}`, () => {
      const result = conformityDecision(
        base({
          value: item.value,
          standardUncertainty: item.u,
          lsl: item.lsl,
          usl: item.usl,
        }),
      );
      const span = 12 * item.u;
      const inside =
        item.lsl !== null && item.usl !== null
          ? integrateNormal(item.value, item.u, item.lsl, item.usl)
          : item.usl !== null
            ? integrateNormal(item.value, item.u, item.value - span, item.usl)
            : integrateNormal(item.value, item.u, item.lsl!, item.value + span);
      const outsideLow =
        item.lsl !== null
          ? integrateNormal(item.value, item.u, item.value - span, item.lsl)
          : 0;
      const outsideHigh =
        item.usl !== null
          ? integrateNormal(item.value, item.u, item.usl, item.value + span)
          : 0;
      const outside = outsideLow + outsideHigh;

      expect(Math.abs((result.probabilityConform ?? NaN) - inside)).toBeLessThanOrEqual(
        1e-6,
      );
      expect(Math.abs((result.falseRejectRisk ?? NaN) - inside)).toBeLessThanOrEqual(
        1e-6,
      );
      expect(Math.abs((result.falseAcceptRisk ?? NaN) - outside)).toBeLessThanOrEqual(
        1e-6,
      );
      expect(
        Math.abs((result.falseAcceptRisk ?? NaN) + (result.falseRejectRisk ?? NaN) - 1),
      ).toBeLessThanOrEqual(1e-12);
    });
  }
});

describe('aceitação simples', () => {
  it('aceita x exatamente nos limites e rejeita fora', () => {
    const lower = conformityDecision(base({ value: 9.5 }));
    expect(lower.decision).toBe('conform');
    expect(lower.verdict).toBe('pass');
    close(lower.probabilityConform, 0.4999997133484281, 1e-6);
    close(lower.falseAcceptRisk, 0.5000002866515719, 1e-6);
    expect(lower.alerts.some((alert) => alert.includes('limite de decisão'))).toBe(true);

    const upper = conformityDecision(base({ value: 10.5 }));
    expect(upper.decision).toBe('conform');
    close(upper.probabilityConform, 0.4999997133484281, 1e-6);

    expect(conformityDecision(base({ value: 9.4999 })).decision).toBe('nonconform');
    expect(conformityDecision(base({ value: 10.5001 })).decision).toBe('nonconform');
  });

  it('calcula U, TUR, U/T, %P/T e os alertas padrão', () => {
    const result = conformityDecision(base());
    close(result.expandedUncertainty, 0.4);
    close(result.tolerance, 1);
    close(result.tur, 1.25);
    close(result.uOverT, 0.4);
    close(result.pctPT, 40);
    expect(result.alerts.some((alert) => alert.startsWith('TUR/TAR'))).toBe(true);
    expect(result.alerts.some((alert) => alert.startsWith('U/T'))).toBe(true);
    expect(result.alerts.some((alert) => alert.startsWith('%P/T'))).toBe(true);
  });

  it('permite editar os limiares de alerta', () => {
    const result = conformityDecision(base(), {
      criteria: { turMinimum: 1.2, maxUOverT: 0.5, maxPctPT: 50 },
    });
    expect(result.alerts.some((alert) => alert.startsWith('TUR/TAR'))).toBe(false);
    expect(result.alerts.some((alert) => alert.startsWith('U/T'))).toBe(false);
    expect(result.alerts.some((alert) => alert.startsWith('%P/T'))).toBe(false);
  });

  it('aceita limites unilaterais e deixa TUR não avaliado', () => {
    const upper = conformityDecision(
      base({ lsl: null, usl: 10.4, standardUncertainty: 0.3 }),
    );
    expect(upper.decision).toBe('conform');
    expect(upper.tolerance).toBeNull();
    expect(upper.tur).toBeNull();
    expect(upper.uOverT).toBeNull();
    expect(upper.pctPT).toBeNull();
    expect(upper.notes.some((note) => note.includes('unilateral'))).toBe(true);

    const lower = conformityDecision(
      base({ lsl: 9.6, usl: null, standardUncertainty: 0.3 }),
    );
    expect(lower.decision).toBe('conform');
    close(lower.probabilityConform, 0.9087887802741321, 1e-6);
  });
});

describe('banda de guarda', () => {
  it('usa w = r·U e decide nas bordas fechadas', () => {
    const result = conformityDecision(base({ rule: 'guard_band' }));
    close(result.guardBand, 0.4);
    close(result.effectiveLower, 9.9);
    close(result.effectiveUpper, 10.1);
    close(result.rejectionLower, 9.1);
    close(result.rejectionUpper, 10.9);
    expect(result.decision).toBe('conform');

    expect(
      conformityDecision(base({ rule: 'guard_band', value: 9.9 })).decision,
    ).toBe('conform');
    expect(
      conformityDecision(base({ rule: 'guard_band', value: 10.1 })).decision,
    ).toBe('conform');
    expect(
      conformityDecision(base({ rule: 'guard_band', value: 9.8999 })).decision,
    ).toBe('indeterminate');
    expect(
      conformityDecision(base({ rule: 'guard_band', value: 10.1001 })).decision,
    ).toBe('indeterminate');
    expect(
      conformityDecision(base({ rule: 'guard_band', value: 9.1 })).decision,
    ).toBe('indeterminate');
    expect(
      conformityDecision(base({ rule: 'guard_band', value: 10.9 })).decision,
    ).toBe('indeterminate');
    expect(
      conformityDecision(base({ rule: 'guard_band', value: 9.0999 })).decision,
    ).toBe('nonconform');
    expect(
      conformityDecision(base({ rule: 'guard_band', value: 10.9001 })).decision,
    ).toBe('nonconform');
  });

  it('alerta quando a banda deixa a zona de aceitação vazia', () => {
    const result = conformityDecision(
      base({ rule: 'guard_band', guardBandFactor: 1.5 }),
    );
    expect(result.decision).toBe('indeterminate');
    close(result.guardBand, 0.6);
    expect(result.effectiveLower!).toBeGreaterThan(result.effectiveUpper!);
    expect(
      result.alerts.some((alert) => alert.includes('nenhuma aceitação é possível')),
    ).toBe(true);
  });

  it('alerta quando a banda excede a tolerância', () => {
    const result = conformityDecision(
      base({ rule: 'guard_band', guardBandFactor: 3 }),
    );
    expect(result.decision).toBe('indeterminate');
    expect(
      result.alerts.some((alert) => alert.includes('excede a tolerância')),
    ).toBe(true);
  });

  it('reduz à aceitação simples quando w = 0', () => {
    const result = conformityDecision(
      base({ rule: 'guard_band', guardBandFactor: 0 }),
    );
    expect(result.decision).toBe('conform');
    expect(result.guardBand).toBe(0);
    expect(result.alerts.some((alert) => alert.includes('banda de guarda é nula'))).toBe(
      true,
    );
  });
});

describe('probabilidade de conformidade como regra', () => {
  it('decide pelo limiar editável', () => {
    const accepted = conformityDecision(base({ rule: 'probability' }));
    expect(accepted.decision).toBe('conform');
    expect(accepted.verdict).toBe('pass');
    close(accepted.probabilityConform, 0.9875806693484477, 1e-6);

    const rejected = conformityDecision(
      base({ rule: 'probability', probabilityThreshold: 0.99 }),
    );
    expect(rejected.decision).toBe('nonconform');
    expect(rejected.verdict).toBe('fail');
    close(rejected.falseRejectRisk, 0.9875806693484477, 1e-6);
  });

  it('mantém a borda exata coerente com o limiar', () => {
    const result = conformityDecision(
      base({ rule: 'probability', value: 10.5, probabilityThreshold: 0.5 }),
    );
    close(result.probabilityConform, 0.4999997133484281, 1e-6);
    expect(result.decision).toBe('nonconform');
  });
});

describe('u = 0 e estados de decisão', () => {
  it('produz riscos degenerados e TUR nulo', () => {
    const result = conformityDecision(
      base({ value: 10, standardUncertainty: 0, lsl: 9, usl: 11 }),
    );
    expect(result.expandedUncertainty).toBe(0);
    expect(result.probabilityConform).toBe(1);
    expect(result.falseAcceptRisk).toBe(0);
    expect(result.falseRejectRisk).toBe(1);
    expect(result.tur).toBeNull();
    expect(result.uOverT).toBe(0);
    expect(result.pctPT).toBe(0);
    expect(result.decision).toBe('conform');
    expect(result.alerts.some((alert) => alert.includes('u = 0'))).toBe(true);
  });

  it('mapeia conform/nonconform/indeterminate para pass/fail/warning', () => {
    expect(conformityDecision(base()).verdict).toBe('pass');
    expect(conformityDecision(base({ value: 12 })).verdict).toBe('fail');
    expect(
      conformityDecision(base({ rule: 'guard_band', value: 9.5 })).verdict,
    ).toBe('warning');
  });
});

describe('resultado para o relatório', () => {
  it('expõe regra, valor, U, k, limites efetivos e veredito', () => {
    const result = conformityDecision(
      base({ rule: 'guard_band', guardBandFactor: 1, coverageFactor: 3 }),
      { unit: 'mm' },
    );
    expect(result.report.rule).toBe('guard_band');
    expect(result.report.ruleLabel).toContain('Banda de guarda');
    close(result.report.value, 10);
    close(result.report.standardUncertainty, 0.2);
    close(result.report.coverageFactor, 3);
    close(result.report.expandedUncertainty, 0.6);
    close(result.report.guardBand, 0.6);
    close(result.report.effectiveLower, 10.1);
    close(result.report.effectiveUpper, 9.9);
    expect(result.report.decision).toBe('indeterminate');
    expect(result.report.decisionLabel).toBe('indeterminado');
    expect(result.report.reference).toContain('JCGM 106:2012');
    expect(result.report.reference).toContain('ILAC-G8:09/2019');
    expect(result.summary).toContain('indeterminado');
    expect(result.metrics.some((metric) => metric.key === 'conformity')).toBe(true);
    expect(result.tables.map((table) => table.title)).toEqual([
      'Regra de decisão e limites efetivos',
      'Riscos e métricas relativas à tolerância',
    ]);
    for (const metric of result.metrics) {
      expect(metric.criterionText.length).toBeGreaterThan(0);
      expect(metric.formula?.length).toBeGreaterThan(0);
    }
  });

  it('mantém os padrões documentados', () => {
    expect(DEFAULT_CONFORMITY_CRITERIA).toMatchObject({
      guardBandFactor: 1,
      probabilityThreshold: 0.95,
      turMinimum: 4,
      maxUOverT: 0.25,
      maxPctPT: 10,
    });
  });
});

describe('validação de entrada', () => {
  it('rejeita entradas inválidas', () => {
    expect(() => conformityDecision(base({ standardUncertainty: -0.1 }))).toThrow(
      /não negativo/,
    );
    expect(() => conformityDecision(base({ coverageFactor: 0 }))).toThrow(/positivo/);
    expect(() => conformityDecision(base({ lsl: null, usl: null }))).toThrow(
      /pelo menos um limite/,
    );
    expect(() => conformityDecision(base({ lsl: 10.5, usl: 9.5 }))).toThrow(
      /LSL < USL/,
    );
    expect(() =>
      conformityDecision(base({ rule: 'guard_band', guardBandFactor: -1 })),
    ).toThrow(/não negativo/);
    expect(() =>
      conformityDecision(base({ rule: 'probability', probabilityThreshold: 0 })),
    ).toThrow(/entre 0/);
    expect(() =>
      conformityDecision(base({ rule: 'probability', probabilityThreshold: 1.01 })),
    ).toThrow(/entre 0/);
    expect(() => conformityDecision(base({ value: Number.NaN }))).toThrow(/finito/);
  });
});
