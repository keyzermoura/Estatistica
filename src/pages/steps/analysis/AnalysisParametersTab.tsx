import type { ParameterAnalysis } from '../../../stats/analysis';
import { ParameterResultCard } from '../../../components/ParameterResultCard';
import { Alert, Badge } from '../../../components/ui';

export function AnalysisParametersTab({
  parameters,
}: {
  parameters: ParameterAnalysis[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="section-title">Resultados por parâmetro</h3>
          <p className="muted">
            Cada tabela mostra a métrica, a fórmula, o critério cadastrado e o veredito.
          </p>
        </div>
        <Badge tone="outline">{parameters.length} parâmetro(s) selecionado(s)</Badge>
      </div>

      {parameters.length === 0 ? (
        <Alert tone="warning" title="Nenhum parâmetro selecionado">
          Volte à etapa de Parâmetros e selecione ao menos um parâmetro.
        </Alert>
      ) : (
        parameters.map((parameter) => (
          <ParameterResultCard key={parameter.key} analysis={parameter} />
        ))
      )}
    </div>
  );
}
