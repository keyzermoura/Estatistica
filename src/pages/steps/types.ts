import type { ValidationAnalysis } from '../../stats/analysis';
import type { ValidationBundle } from '../../lib/types';

export interface StepProps {
  bundle: ValidationBundle;
  analysis: ValidationAnalysis;
  reload: () => void;
  goTo: (step: number) => void;
}

export const STEP_COUNT = 7;
