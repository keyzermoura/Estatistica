/**
 * Propagação de Incerteza por Simulação de Monte Carlo (JCGM 101:2008 / GUM Supl. 1).
 *
 * Permite avaliar modelos de mensurando Y = f(X_1, ..., X_k) com parser
 * matemático seguro (Shunting-Yard sem eval/Function), amostragem
 * determinística e validação comparativa contra a aproximação linear GUM.
 *
 * Referência: JCGM 101:2008 — Evaluation of measurement data — Supplement 1 to the GUM.
 */

import { mean, quantile, sd } from './descriptive';
import { tInv } from './distributions';
import type { UncertaintyDistribution } from '../lib/types';

export interface MonteCarloVariableInput {
  /** Nome da variável na expressão (ex.: "F", "m", "d"). */
  name: string;
  /** Estimativa nominal x_i. */
  estimate: number;
  /** Semi-amplitude (retangular/triangular/U) ou desvio-padrão (normal/t). */
  halfWidthOrSd: number;
  distribution: UncertaintyDistribution;
  /** Graus de liberdade (opcional, ativa amostragem t-Student se finito e normal). */
  dof?: number | null;
}

export interface MonteCarloInput {
  /** Expressão do mensurando, ex.: "F / (0.25 * 3.14159265 * d^2)" ou omitido para soma linear. */
  expression?: string;
  variables: MonteCarloVariableInput[];
  /** Número de iterações (padrão 20 000). */
  trials?: number;
  /** Probabilidade de abrangência (padrão 0,95). */
  coverageProbability?: number;
  /** Semente determinística para reprodutibilidade. */
  seed?: number;
}

export interface MonteCarloHistogramBin {
  binCenter: number;
  binStart: number;
  binEnd: number;
  count: number;
}

export interface MonteCarloSensitivity {
  name: string;
  ci: number;
  stdUncertainty: number;
  contributionSqPct: number;
}

export interface MonteCarloResult {
  expression: string;
  trials: number;
  coverageProbability: number;
  seed: number;
  nominalY: number;
  mean: number;
  median: number;
  standardUncertainty: number;
  symmetricInterval: [number, number];
  shortestInterval: [number, number];
  gumCombinedUncertainty: number;
  gumExpandedUncertainty: number;
  /** Critério numérico JCGM 101 §8 (diferença máxima ≤ tolerância numérica δ). */
  gumCompatible: boolean;
  sensitivities: MonteCarloSensitivity[];
  histogram: MonteCarloHistogramBin[];
  reference: string;
}

const REFERENCE = 'JCGM 101:2008 (GUM Suplemento 1 — Propagação de distribuições por Monte Carlo)';

// ── PRNG determinístico (Mulberry32) ───────────────────────────────────────

function createRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Parser matemático seguro (Shunting-Yard / RPN) ─────────────────────────

type Token =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string }
  | { type: 'op'; value: string }
  | { type: 'func'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' };

const ALLOWED_FUNCTIONS = new Set(['sqrt', 'abs', 'ln', 'log10', 'log', 'exp', 'sin', 'cos']);
const PRECEDENCE: Record<string, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '^': 3,
  'neg': 4,
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.trim();
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < s.length && /[0-9.eE+-]/.test(s[i])) {
        if ((s[i] === '+' || s[i] === '-') && numStr.length > 0 && !/[eE]/.test(numStr[numStr.length - 1])) {
          break;
        }
        numStr += s[i];
        i += 1;
      }
      const parsed = Number(numStr);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Número inválido na expressão: "${numStr}".`);
      }
      tokens.push({ type: 'num', value: parsed });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        ident += s[i];
        i += 1;
      }
      if (ident === 'pi' || ident === 'PI') {
        tokens.push({ type: 'num', value: Math.PI });
      } else if (ALLOWED_FUNCTIONS.has(ident)) {
        tokens.push({ type: 'func', value: ident });
      } else {
        tokens.push({ type: 'id', value: ident });
      }
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      const prev = tokens[tokens.length - 1];
      const isUnary =
        ch === '-' &&
        (!prev || prev.type === 'op' || prev.type === 'lparen' || prev.type === 'func');
      tokens.push({ type: 'op', value: isUnary ? 'neg' : ch });
      i += 1;
      continue;
    }
    throw new Error(`Caractere não suportado na expressão matemática: "${ch}".`);
  }
  return tokens;
}

function toRpn(expr: string): Token[] {
  const tokens = tokenize(expr);
  const output: Token[] = [];
  const stack: Token[] = [];

  for (const token of tokens) {
    if (token.type === 'num' || token.type === 'id') {
      output.push(token);
    } else if (token.type === 'func') {
      stack.push(token);
    } else if (token.type === 'op') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.type === 'op') {
          const rightAssoc = token.value === '^' || token.value === 'neg';
          const pTop = PRECEDENCE[top.value] ?? 0;
          const pCur = PRECEDENCE[token.value] ?? 0;
          if ((!rightAssoc && pCur <= pTop) || (rightAssoc && pCur < pTop)) {
            output.push(stack.pop()!);
            continue;
          }
        }
        break;
      }
      stack.push(token);
    } else if (token.type === 'lparen') {
      stack.push(token);
    } else if (token.type === 'rparen') {
      let matched = false;
      while (stack.length > 0) {
        const top = stack.pop()!;
        if (top.type === 'lparen') {
          matched = true;
          break;
        }
        output.push(top);
      }
      if (!matched) throw new Error('Parênteses desbalanceados na expressão.');
      if (stack.length > 0 && stack[stack.length - 1].type === 'func') {
        output.push(stack.pop()!);
      }
    }
  }

  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.type === 'lparen' || top.type === 'rparen') {
      throw new Error('Parênteses desbalanceados na expressão.');
    }
    output.push(top);
  }
  return output;
}

function evalRpn(rpn: Token[], vars: Record<string, number>): number {
  const stack: number[] = [];
  for (const token of rpn) {
    if (token.type === 'num') {
      stack.push(token.value);
    } else if (token.type === 'id') {
      const val = vars[token.value];
      if (val === undefined || !Number.isFinite(val)) {
        throw new Error(`Variável desconhecida ou não numérica: "${token.value}".`);
      }
      stack.push(val);
    } else if (token.type === 'func') {
      const a = stack.pop();
      if (a === undefined) throw new Error(`Argumento ausente para "${token.value}".`);
      switch (token.value) {
        case 'sqrt': stack.push(Math.sqrt(a)); break;
        case 'abs': stack.push(Math.abs(a)); break;
        case 'ln':
        case 'log': stack.push(Math.log(a)); break;
        case 'log10': stack.push(Math.log10(a)); break;
        case 'exp': stack.push(Math.exp(a)); break;
        case 'sin': stack.push(Math.sin(a)); break;
        case 'cos': stack.push(Math.cos(a)); break;
        default: throw new Error(`Função não suportada: "${token.value}".`);
      }
    } else if (token.type === 'op') {
      if (token.value === 'neg') {
        const a = stack.pop();
        if (a === undefined) throw new Error('Expressão malformada.');
        stack.push(-a);
      } else {
        const b = stack.pop();
        const a = stack.pop();
        if (a === undefined || b === undefined) throw new Error('Expressão malformada.');
        switch (token.value) {
          case '+': stack.push(a + b); break;
          case '-': stack.push(a - b); break;
          case '*': stack.push(a * b); break;
          case '/': stack.push(a / b); break;
          case '^': stack.push(a ** b); break;
          default: throw new Error(`Operador inválido: "${token.value}".`);
        }
      }
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) {
    throw new Error('Expressão matemática resultou em valor indefinido.');
  }
  return stack[0];
}

export function evaluateExpression(expr: string, vars: Record<string, number>): number {
  return evalRpn(toRpn(expr), vars);
}

export function numericalSensitivity(
  expr: string,
  nominalVars: Record<string, number>,
  varName: string,
): number {
  const rpn = toRpn(expr);
  const x0 = nominalVars[varName];
  if (x0 === undefined) return 0;
  const h = Math.max(Math.abs(x0) * 1e-6, 1e-7);
  const plus = evalRpn(rpn, { ...nominalVars, [varName]: x0 + h });
  const minus = evalRpn(rpn, { ...nominalVars, [varName]: x0 - h });
  return (plus - minus) / (2 * h);
}

function drawStandardNormal(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function drawVariable(v: MonteCarloVariableInput, rng: () => number): number {
  const a = Math.abs(v.halfWidthOrSd);
  if (a === 0) return v.estimate;
  switch (v.distribution) {
    case 'rectangular':
      return v.estimate + (rng() * 2 - 1) * a;
    case 'triangular':
      return v.estimate + (rng() + rng() - 1) * a;
    case 'u_shaped':
      return v.estimate + a * Math.cos(Math.PI * rng());
    case 'none':
      return v.estimate;
    case 'normal':
    default: {
      const z = drawStandardNormal(rng);
      if (v.dof !== null && v.dof !== undefined && Number.isFinite(v.dof) && v.dof >= 2) {
        // Qui-quadrado aproximado via soma de normais para df inteiro pequeno
        const df = Math.min(60, Math.max(2, Math.round(v.dof)));
        let chi2 = 0;
        for (let k = 0; k < df; k++) {
          const zk = drawStandardNormal(rng);
          chi2 += zk * zk;
        }
        return v.estimate + a * (z / Math.sqrt(chi2 / df));
      }
      return v.estimate + a * z;
    }
  }
}

function stdUncertaintyOf(v: MonteCarloVariableInput): number {
  const a = Math.abs(v.halfWidthOrSd);
  switch (v.distribution) {
    case 'rectangular': return a / Math.sqrt(3);
    case 'triangular': return a / Math.sqrt(6);
    case 'u_shaped': return a / Math.SQRT2;
    case 'none': return 0;
    case 'normal':
    default: return a;
  }
}

function shortestCoverageInterval(sorted: number[], p: number): [number, number] {
  const n = sorted.length;
  const span = Math.max(1, Math.min(n - 1, Math.floor(p * n)));
  let bestStart = 0;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (let i = 0; i + span < n; i++) {
    const width = sorted[i + span] - sorted[i];
    if (width < bestWidth) {
      bestWidth = width;
      bestStart = i;
    }
  }
  return [sorted[bestStart], sorted[bestStart + span]];
}

export function runMonteCarloUncertainty(input: MonteCarloInput): MonteCarloResult {
  if (!input.variables.length) {
    throw new Error('Informe ao menos uma variável de entrada para a simulação Monte Carlo.');
  }
  const trials = Math.min(200_000, Math.max(1000, Math.round(input.trials ?? 20_000)));
  const p = input.coverageProbability ?? 0.95;
  const seed = input.seed ?? 2026;
  const expression =
    input.expression?.trim() || input.variables.map((v) => v.name).join(' + ');

  const rpn = toRpn(expression);
  const nominalVars: Record<string, number> = {};
  for (const v of input.variables) {
    nominalVars[v.name] = v.estimate;
  }
  const nominalY = evalRpn(rpn, nominalVars);

  const rng = createRng(seed);
  const draws: number[] = new Array(trials);
  const simVars: Record<string, number> = {};
  for (let t = 0; t < trials; t++) {
    for (const v of input.variables) {
      simVars[v.name] = drawVariable(v, rng);
    }
    draws[t] = evalRpn(rpn, simVars);
  }

  const mcMean = mean(draws);
  const mcSd = sd(draws);
  const sorted = [...draws].sort((a, b) => a - b);
  const mcMedian = quantile(sorted, 0.5);
  const alpha = 1 - p;
  const symmetricInterval: [number, number] = [
    quantile(sorted, alpha / 2),
    quantile(sorted, 1 - alpha / 2),
  ];
  const shortestInterval = shortestCoverageInterval(sorted, p);

  // Comparação com GUM linear (sensibilidade numérica por diferenças finitas)
  const sensRaw = input.variables.map((v) => {
    const h = Math.max(Math.abs(v.estimate) * 1e-6, 1e-7);
    const plus = evalRpn(rpn, { ...nominalVars, [v.name]: v.estimate + h });
    const minus = evalRpn(rpn, { ...nominalVars, [v.name]: v.estimate - h });
    const ci = (plus - minus) / (2 * h);
    const ui = stdUncertaintyOf(v);
    return { name: v.name, ci, stdUncertainty: ui, contribSq: (ci * ui) ** 2 };
  });
  const totalContribSq = sensRaw.reduce((acc, s) => acc + s.contribSq, 0);
  const gumCombinedUncertainty = Math.sqrt(totalContribSq);
  const gumExpandedUncertainty = tInv(1 - alpha / 2, 1e5) * gumCombinedUncertainty;
  const sensitivities: MonteCarloSensitivity[] = sensRaw.map((s) => ({
    name: s.name,
    ci: s.ci,
    stdUncertainty: s.stdUncertainty,
    contributionSqPct: totalContribSq > 0 ? (100 * s.contribSq) / totalContribSq : 0,
  }));

  const gumLow = nominalY - gumExpandedUncertainty;
  const gumHigh = nominalY + gumExpandedUncertainty;
  const numTol = Math.max(mcSd * 0.05, 1e-9);
  const gumCompatible =
    Math.abs(gumLow - symmetricInterval[0]) <= numTol &&
    Math.abs(gumHigh - symmetricInterval[1]) <= numTol;

  // Histograma em 20 classes
  const binsCount = 20;
  const minVal = sorted[0];
  const maxVal = sorted[sorted.length - 1];
  const width = maxVal > minVal ? (maxVal - minVal) / binsCount : 1;
  const counts = new Array(binsCount).fill(0);
  for (const val of sorted) {
    const idx =
      maxVal > minVal
        ? Math.min(binsCount - 1, Math.floor((val - minVal) / width))
        : 0;
    counts[idx] += 1;
  }
  const histogram: MonteCarloHistogramBin[] = counts.map((count, idx) => ({
    binStart: minVal + idx * width,
    binEnd: minVal + (idx + 1) * width,
    binCenter: minVal + (idx + 0.5) * width,
    count,
  }));

  return {
    expression,
    trials,
    coverageProbability: p,
    seed,
    nominalY,
    mean: mcMean,
    median: mcMedian,
    standardUncertainty: mcSd,
    symmetricInterval,
    shortestInterval,
    gumCombinedUncertainty,
    gumExpandedUncertainty,
    gumCompatible,
    sensitivities,
    histogram,
    reference: REFERENCE,
  };
}
