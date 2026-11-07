/**
 * Seletividade / especificidade — módulo do perfil analítico.
 *
 * Não há cálculo automático: a evidência exige branco, amostra fortificada e
 * interferente. O parâmetro permanece não avaliado até haver critério e dado.
 *
 * Referência: ISO/IEC 17025:2017, 7.2.2; ICH Q2(R2); EURACHEM.
 */

import type { AnalysisModule } from '../analysis-types';
import { emptyParameter } from '../analysis-utils';

export const selectivityAnalysis: AnalysisModule = ({ parameter, context }) =>
  emptyParameter(
    parameter,
    context.used.length,
    'A seletividade exige experimento com branco/interferentes e critério de recuperação; registre os resultados no relatório ou use o teste de recuperação.',
    ['Ensaie branco, amostra fortificada e amostra com interferente nas mesmas condições.'],
  );
