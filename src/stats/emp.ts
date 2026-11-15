/**
 * Método EMP (Evaluating the Measurement Process — Donald J. Wheeler).
 *
 * Avalia a capacidade do sistema de medição a partir dos componentes de variância
 * (peça e sistema de medição) por meio do coeficiente de correlação intraclasse
 * (ICC), erro provável (PE), resolução efetiva e classificação em Classes I–IV.
 *
 * Referência: Wheeler, D. J. (2006). EMP III: Evaluating the Measurement Process
 * & Using Imperfect Data. SPC Press.
 */

export type EmpMonitorClass = 'Class I' | 'Class II' | 'Class III' | 'Class IV';

export interface EmpInput {
  sigmaPart: number;
  sigmaRepeatability: number;
  sigmaReproducibility?: number;
  resolution?: number | null;
}

export interface EmpResult {
  icc: number;
  signalAttenuationPct: number;
  probableError: number;
  effectiveResolutionMin: number;
  effectiveResolutionMax: number;
  monitorClass: EmpMonitorClass;
  monitorDescription: string;
  resolutionStatus: 'adequada' | 'grosseira' | 'exagerada' | 'nao_informada';
  reference: string;
}

const REFERENCE = 'Wheeler, D. J. (2006). EMP III: Evaluating the Measurement Process';

function classifyEmp(icc: number): {
  monitorClass: EmpMonitorClass;
  monitorDescription: string;
} {
  if (icc >= 0.8) {
    return {
      monitorClass: 'Class I',
      monitorDescription:
        'Excelente (ICC ≥ 0,80): menos de 10% de atenuação do sinal do processo; adequado para controle estatístico e inspeção.',
    };
  }
  if (icc >= 0.5) {
    return {
      monitorClass: 'Class II',
      monitorDescription:
        'Adequado (0,50 ≤ ICC < 0,80): útil para cartas de controle de processo; detectar pequenos desvios exige média amostral.',
    };
  }
  if (icc >= 0.2) {
    return {
      monitorClass: 'Class III',
      monitorDescription:
        'Marginal (0,20 ≤ ICC < 0,50): erro de medição próximo à variação do produto; requer médias de subgrupos maiores.',
    };
  }
  return {
    monitorClass: 'Class IV',
    monitorDescription:
      'Inadequado (ICC < 0,20): o erro de medição domina o sinal do processo e mascara deslocamentos reais.',
  };
}

export function computeEmp(input: EmpInput): EmpResult {
  const sigmaPart = Math.max(0, input.sigmaPart);
  const sigmaRep = Math.max(0, input.sigmaRepeatability);
  const sigmaRepro = Math.max(0, input.sigmaReproducibility ?? 0);
  const varPart = sigmaPart * sigmaPart;
  const varMeas = sigmaRep * sigmaRep + sigmaRepro * sigmaRepro;
  const varTotal = varPart + varMeas;
  const icc = varTotal > 0 ? varPart / varTotal : 0;
  const signalAttenuationPct = (1 - Math.sqrt(Math.max(0, icc))) * 100;
  const probableError = 0.6745 * sigmaRep;
  const effectiveResolutionMin = 0.2 * probableError;
  const effectiveResolutionMax = 2.0 * probableError;
  const { monitorClass, monitorDescription } = classifyEmp(icc);

  let resolutionStatus: EmpResult['resolutionStatus'] = 'nao_informada';
  const resolution = input.resolution ?? null;
  if (resolution !== null && Number.isFinite(resolution) && resolution > 0 && probableError > 0) {
    if (resolution > effectiveResolutionMax) {
      resolutionStatus = 'grosseira';
    } else if (resolution < effectiveResolutionMin) {
      resolutionStatus = 'exagerada';
    } else {
      resolutionStatus = 'adequada';
    }
  }

  return {
    icc,
    signalAttenuationPct,
    probableError,
    effectiveResolutionMin,
    effectiveResolutionMax,
    monitorClass,
    monitorDescription,
    resolutionStatus,
    reference: REFERENCE,
  };
}
