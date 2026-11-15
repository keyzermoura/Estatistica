import { runMonteCarloUncertainty, type MonteCarloInput } from '../stats/monteCarlo';

/**
 * Web Worker dedicado para simulações pesadas de Monte Carlo (JCGM 101:2008 / GUM Supl. 1).
 * Executa 20.000 a 100.000 iterações fora da thread de UI para garantir 60 FPS contínuos no navegador.
 */
self.onmessage = (event: MessageEvent<{ id: string; input: MonteCarloInput }>) => {
  const { id, input } = event.data;
  try {
    const result = runMonteCarloUncertainty(input);
    self.postMessage({ id, success: true, result });
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Falha na simulação Monte Carlo.',
    });
  }
};
