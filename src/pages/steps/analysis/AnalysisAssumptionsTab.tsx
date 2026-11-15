import { Card, CardBody, CardHeader } from '../../../components/ui';

export function AnalysisAssumptionsTab({
  assumptions,
}: {
  assumptions: string[];
}) {
  return (
    <Card>
      <CardHeader title="Pressupostos da análise" />
      <CardBody>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-500">
          {assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
