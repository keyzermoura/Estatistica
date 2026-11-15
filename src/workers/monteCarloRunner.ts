import { useCallback, useEffect, useRef, useState } from 'react';
import { runMonteCarloUncertainty, type MonteCarloInput, type MonteCarloResult } from '../stats/monteCarlo';
import { uid } from '../lib/utils';

/**
 * Executa a simulação Monte Carlo em Web Worker off-thread quando disponível,
 * ou com fallback síncrono transparente em ambientes sem suporte (ex.: Node.js / Vitest).
 */
export async function executeMonteCarloAsync(input: MonteCarloInput): Promise<MonteCarloResult> {
  // Se não houver suporte a Worker (ex.: ambiente de testes Node/jsdom), executa diretamente
  if (typeof Worker === 'undefined') {
    return runMonteCarloUncertainty(input);
  }

  return new Promise<MonteCarloResult>((resolve, reject) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./monteCarlo.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      // Fallback caso URL/Worker falhe no bundling
      try {
        resolve(runMonteCarloUncertainty(input));
      } catch (err) {
        reject(err);
      }
      return;
    }

    const taskId = uid('mc');
    const timer = setTimeout(() => {
      worker?.terminate();
      reject(new Error('A simulação de Monte Carlo excedeu o tempo limite de 60 segundos.'));
    }, 60000);

    worker.onmessage = (event: MessageEvent<{ id: string; success: boolean; result?: MonteCarloResult; error?: string }>) => {
      if (event.data.id !== taskId) return;
      clearTimeout(timer);
      worker?.terminate();

      if (event.data.success && event.data.result) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.error || 'Erro desconhecido na simulação Monte Carlo.'));
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timer);
      worker?.terminate();
      reject(new Error(err.message || 'Falha no Web Worker de Monte Carlo.'));
    };

    worker.postMessage({ id: taskId, input });
  });
}

/**
 * Hook para invocar a simulação Monte Carlo assíncrona com estado de carregamento e cancelamento.
 */
export function useMonteCarloRunner() {
  const [running, setRunning] = useState(false);
  const activeWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      if (activeWorkerRef.current) {
        activeWorkerRef.current.terminate();
      }
    };
  }, []);

  const runSimulation = useCallback(async (input: MonteCarloInput): Promise<MonteCarloResult> => {
    setRunning(true);
    try {
      const result = await executeMonteCarloAsync(input);
      return result;
    } finally {
      setRunning(false);
    }
  }, []);

  return {
    runSimulation,
    running,
  };
}
