/**
 * Design Tokens e Configuração Centralizada de Temas para Gráficos (Recharts).
 * Garante acessibilidade visual (WCAG 2.1 AA), suporte consistente a Dark Mode
 * e distinção cromática redundante para usuários com discromatopsia (deuteranopia/protanopia).
 */

export interface ChartThemeTokens {
  brand: string;
  brandSecondary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  neutralLine: string;
  gridLine: string;
  axisText: string;
  axisLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  confidenceBandFill: string;
  confidenceBandStroke: string;
  guardBandFill: string;
  palette: string[];
}

export const LIGHT_CHART_THEME: ChartThemeTokens = {
  brand: '#0f766e',          // teal-700
  brandSecondary: '#0284c7', // sky-600
  accent: '#7c3aed',         // violet-600
  success: '#10b981',        // emerald-500
  warning: '#f59e0b',        // amber-500
  danger: '#e11d48',         // rose-600
  neutralLine: '#cbd5e1',    // slate-300
  gridLine: '#e2e8f0',       // slate-200
  axisText: '#64748b',       // slate-500
  axisLine: '#cbd5e1',       // slate-300
  tooltipBg: '#ffffff',
  tooltipBorder: '#e2e8f0',
  confidenceBandFill: 'rgba(2, 132, 199, 0.12)',
  confidenceBandStroke: '#0284c7',
  guardBandFill: 'rgba(16, 185, 129, 0.15)',
  palette: [
    '#0f766e', // teal
    '#0284c7', // sky
    '#d97706', // amber
    '#9333ea', // purple
    '#e11d48', // rose
    '#2563eb', // blue
    '#16a34a', // green
  ],
};

export const DARK_CHART_THEME: ChartThemeTokens = {
  brand: '#2dd4bf',          // teal-400
  brandSecondary: '#38bdf8', // sky-400
  accent: '#a78bfa',         // violet-400
  success: '#34d399',        // emerald-400
  warning: '#fbbf24',        // amber-400
  danger: '#fb7185',         // rose-400
  neutralLine: '#475569',    // slate-600
  gridLine: '#334155',       // slate-700
  axisText: '#94a3b8',       // slate-400
  axisLine: '#475569',       // slate-600
  tooltipBg: '#0f172a',      // slate-900
  tooltipBorder: '#334155',  // slate-700
  confidenceBandFill: 'rgba(56, 189, 248, 0.15)',
  confidenceBandStroke: '#38bdf8',
  guardBandFill: 'rgba(52, 211, 153, 0.20)',
  palette: [
    '#2dd4bf',
    '#38bdf8',
    '#fbbf24',
    '#c084fc',
    '#fb7185',
    '#60a5fa',
    '#4ade80',
  ],
};

export function getChartTheme(isDark = false): ChartThemeTokens {
  return isDark ? DARK_CHART_THEME : LIGHT_CHART_THEME;
}

export const defaultAxisProps = {
  stroke: '#94a3b8',
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: '#cbd5e1' },
};
