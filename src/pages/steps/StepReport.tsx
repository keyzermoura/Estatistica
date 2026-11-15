import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  PenLine,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import type { ReportRecord, ReportSignature, Validation } from '../../lib/types';
import { saveReport, signReport, updateValidation } from '../../lib/repository';
import { composeReport } from '../../lib/report';
import {
  buildEvidenceZip,
  buildReportDocx,
  buildReportPdf,
  downloadAnalysisJson,
  downloadEvidenceZip,
  downloadMeasurementsXlsx,
  downloadReportDocx,
  downloadReportHtml,
  downloadReportPdf,
} from '../../lib/export';
import { formatDate, readFileAsDataUrl } from '../../lib/utils';
import { ReportPreview } from '../../components/ReportPreview';
import { StepShell } from '../../components/wizard';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Switch,
  Textarea,
  useToast,
} from '../../components/ui';
import type { StepProps } from './types';

const ROLE_LABELS = {
  elaboration: 'Elaboração',
  review: 'Revisão',
  approval: 'Aprovação',
} as const;

const STATUS_TONE = {
  draft: 'neutral',
  in_review: 'warning',
  approved: 'success',
} as const;

export function StepReport({ bundle, analysis, goTo, reload }: StepProps) {
  const toast = useToast();
  const locked = bundle.validation.locked;
  const [config, setConfig] = useState(bundle.validation.reportConfig);
  const [report, setReport] = useState<ReportRecord | null>(bundle.report);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [names, setNames] = useState<Record<ReportSignature['role'], string>>({
    elaboration: bundle.report?.content.signatures.find((s) => s.role === 'elaboration')?.name || bundle.validation.responsible,
    review: bundle.report?.content.signatures.find((s) => s.role === 'review')?.name || bundle.validation.reviewer,
    approval: bundle.report?.content.signatures.find((s) => s.role === 'approval')?.name || bundle.validation.approver,
  });
  const previewRef = useRef<HTMLDivElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConfig(bundle.validation.reportConfig);
    setReport(bundle.report);
    setNames({
      elaboration: bundle.report?.content.signatures.find((s) => s.role === 'elaboration')?.name || bundle.validation.responsible,
      review: bundle.report?.content.signatures.find((s) => s.role === 'review')?.name || bundle.validation.reviewer,
      approval: bundle.report?.content.signatures.find((s) => s.role === 'approval')?.name || bundle.validation.approver,
    });
  }, [bundle.report, bundle.validation]);

  const actor = bundle.validation.responsible.trim() || 'sistema';

  const patchConfig = (patch: Partial<typeof config>) => setConfig((prev) => ({ ...prev, ...patch }));

  const persistConfig = (): boolean => {
    if (locked) return false;
    try {
      updateValidation({ ...bundle.validation, reportConfig: config }, actor, 'Configuração do relatório');
      toast.push('Configuração do relatório salva.');
      reload();
      return true;
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao salvar configuração.', 'danger');
      return false;
    }
  };

  const generateReport = async (): Promise<ReportRecord | null> => {
    setGenerating(true);
    try {
      const effectiveValidation: Validation = { ...bundle.validation, reportConfig: config };
      if (!locked) {
        updateValidation(effectiveValidation, actor, 'Geração de relatório');
      }
      const generated = await composeReport(
        { ...bundle, validation: effectiveValidation, report: null },
        analysis,
        actor,
      );
      const reuse = bundle.report && bundle.report.version === bundle.validation.version;
      const record: ReportRecord = reuse
        ? {
            ...generated,
            id: bundle.report!.id,
            createdAt: bundle.report!.createdAt,
            elaboratedBy: bundle.report!.elaboratedBy,
            elaboratedAt: bundle.report!.elaboratedAt,
            reviewedBy: bundle.report!.reviewedBy,
            approvedBy: bundle.report!.approvedBy,
            reviewedAt: bundle.report!.reviewedAt,
            approvedAt: bundle.report!.approvedAt,
          }
        : generated;
      record.elaboratedBy = bundle.validation.responsible;
      record.elaboratedAt = null;
      record.reviewedBy = '';
      record.reviewedAt = null;
      record.approvedBy = '';
      record.approvedAt = null;
      record.status = 'draft';
      record.locked = false;
      saveReport(record, actor);
      setReport(record);
      toast.push('Prévia do relatório gerada e registrada.');
      reload();
      return record;
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao gerar relatório.', 'danger');
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const ensureReport = async (): Promise<ReportRecord | null> => {
    if (report) return report;
    return generateReport();
  };

  const sign = (role: ReportSignature['role']) => {
    const name = names[role].trim();
    if (!name) {
      toast.push('Informe o nome do responsável pela assinatura.', 'danger');
      return;
    }
    if (!report) {
      toast.push('Gere a prévia do relatório antes de assinar.', 'danger');
      return;
    }
    if (role === 'review' && !report.elaboratedAt) {
      toast.push('A elaboração deve ser assinada antes da revisão.', 'danger');
      return;
    }
    if (role === 'approval' && !report.reviewedAt) {
      toast.push('A revisão deve ser assinada antes da aprovação.', 'danger');
      return;
    }
    try {
      const next = signReport(bundle.validation.id, role, name, name);
      if (next) {
        setReport(next);
        toast.push(`${ROLE_LABELS[role]} assinada por ${name}.`);
        reload();
      }
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao assinar.', 'danger');
    }
  };

  const exportReport = async (kind: 'docx' | 'pdf' | 'zip' | 'html' | 'json' | 'xlsx') => {
    setBusy(kind);
    try {
      const current = await ensureReport();
      if (!current) return;
      if (kind === 'docx') {
        const bytes = await buildReportDocx(bundle, analysis, current);
        downloadReportDocx(bytes, bundle);
      } else if (kind === 'pdf') {
        const bytes = await buildReportPdf(bundle, analysis, current);
        downloadReportPdf(bytes, bundle);
      } else if (kind === 'zip') {
        await buildEvidenceZip(bundle, analysis, current).then((bytes) =>
          downloadEvidenceZip(bytes, bundle),
        );
      } else if (kind === 'html') {
        downloadReportHtml(bundle, current, previewRef.current);
      } else if (kind === 'json') {
        downloadAnalysisJson(analysis, bundle);
      } else {
        downloadMeasurementsXlsx(bundle);
      }
      toast.push('Exportação concluída.');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha na exportação.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  const onLogo = async (file: File | null) => {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      toast.push('O logo deve ter no máximo 1,5 MB.', 'danger');
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    patchConfig({ logoDataUrl: dataUrl });
  };

  const signatureSigned = (role: ReportSignature['role']) =>
    report?.content.signatures.find((signature) => signature.role === role)?.signed ?? false;

  return (
    <StepShell
      step={5}
      title="Relatório e assinaturas"
      description="Revise o documento auditável, ajuste a identidade do laboratório, assine eletronicamente e exporte em DOCX, PDF ou pacote de evidências."
      locked={locked}
      help={
        <>
          <p>
            O relatório congela os resultados da análise atual e recebe um hash SHA-256 de
            auditoria. Alterações posteriores exigem nova geração.
          </p>
          <p className="mt-1">
            Assine na ordem elaboração → revisão → aprovação. A aprovação final e o bloqueio da
            validação ocorrem na etapa de Auditoria.
          </p>
        </>
      }
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {report ? <Badge tone={STATUS_TONE[report.status]}>{report.status === 'draft' ? 'Rascunho' : report.status === 'in_review' ? 'Em revisão' : 'Aprovado'}</Badge> : <Badge tone="neutral">Sem prévia</Badge>}
          {report ? <Badge tone="outline">v{report.version}</Badge> : null}
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => goTo(4)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void generateReport()} loading={generating} disabled={locked}>
              <RefreshCw className="h-4 w-4" /> {report ? 'Regenerar prévia' : 'Gerar prévia'}
            </Button>
            <Button onClick={() => goTo(6)}>
              Ir para auditoria <ShieldCheck className="h-4 w-4" />
            </Button>
          </div>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {!report ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<FileText className="h-10 w-10" />}
                  title="Prévia ainda não gerada"
                  description="Gere o relatório para congelar os resultados atuais. Você poderá revisar o conteúdo, assinar e exportar."
                  action={
                    <Button onClick={() => void generateReport()} loading={generating} disabled={locked}>
                      <FileText className="h-4 w-4" /> Gerar prévia do relatório
                    </Button>
                  }
                />
              </CardBody>
            </Card>
          ) : (
            <>
              <ReportPreview ref={previewRef} content={report.content} />
              <Card>
                <CardHeader title="Exportações" description="Arquivos gerados a partir da prévia congelada." icon={<Download className="h-4 w-4" />} />
                <CardBody className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void exportReport('docx')} loading={busy === 'docx'}>
                    <FileText className="h-4 w-4" /> DOCX
                  </Button>
                  <Button variant="outline" onClick={() => void exportReport('pdf')} loading={busy === 'pdf'}>
                    <FileText className="h-4 w-4" /> PDF
                  </Button>
                  <Button variant="outline" onClick={() => void exportReport('zip')} loading={busy === 'zip'}>
                    <FileArchive className="h-4 w-4" /> Pacote de evidências
                  </Button>
                  <Button variant="ghost" onClick={() => void exportReport('html')} loading={busy === 'html'}>
                    <Download className="h-4 w-4" /> HTML
                  </Button>
                  <Button variant="ghost" onClick={() => void exportReport('json')} loading={busy === 'json'}>
                    <FileJson className="h-4 w-4" /> Resultados JSON
                  </Button>
                  <Button variant="ghost" onClick={() => void exportReport('xlsx')} loading={busy === 'xlsx'}>
                    <FileSpreadsheet className="h-4 w-4" /> Dados XLSX
                  </Button>
                </CardBody>
              </Card>
            </>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Configuração do relatório" icon={<PenLine className="h-4 w-4" />} />
            <CardBody className="space-y-3">
              <Input label="Título" value={config.reportTitle} disabled={locked} onChange={(e) => patchConfig({ reportTitle: e.target.value })} />
              <Input label="Nome do laboratório" value={config.laboratoryName} disabled={locked} onChange={(e) => patchConfig({ laboratoryName: e.target.value })} />
              <Input label="Endereço" value={config.laboratoryAddress} disabled={locked} onChange={(e) => patchConfig({ laboratoryAddress: e.target.value })} />
              <Input label="Acreditação" value={config.accreditation} disabled={locked} onChange={(e) => patchConfig({ accreditation: e.target.value })} />
              <Field label="Logo" hint="PNG/JPG até 1,5 MB.">
                <div className="flex items-center gap-2">
                  {config.logoDataUrl ? (
                    <img src={config.logoDataUrl} alt="Logo" className="h-10 w-16 rounded border border-ink-200 bg-white object-contain p-0.5 dark:border-ink-700" />
                  ) : (
                    <div className="flex h-10 w-16 items-center justify-center rounded border border-dashed border-ink-300 text-ink-400 dark:border-ink-700">
                      <ImagePlus className="h-4 w-4" />
                    </div>
                  )}
                  <input ref={logoInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void onLogo(e.target.files?.[0] ?? null)} />
                  <Button variant="outline" size="sm" disabled={locked} onClick={() => logoInput.current?.click()}>
                    Enviar
                  </Button>
                </div>
              </Field>
              <Textarea label="Introdução" className="min-h-[90px]" value={config.templateIntro} disabled={locked} onChange={(e) => patchConfig({ templateIntro: e.target.value })} />
              <Textarea label="Rodapé / aviso" className="min-h-[80px]" value={config.templateFooter} disabled={locked} onChange={(e) => patchConfig({ templateFooter: e.target.value })} />
              <Input label="Versão do documento" value={config.version} disabled={locked} onChange={(e) => patchConfig({ version: e.target.value })} />
              <div className="space-y-2 rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                <Switch checked={config.showRawData} onChange={(checked) => patchConfig({ showRawData: checked })} label="Incluir dados brutos" description="No pacote de evidências e exports de dados." />
                <Switch checked={config.showFormulas} onChange={(checked) => patchConfig({ showFormulas: checked })} label="Incluir fórmulas" description="Métricas sempre exibem a fórmula no relatório." disabled />
                <Switch checked={config.showCharts} onChange={(checked) => patchConfig({ showCharts: checked })} label="Incluir gráficos" description="Disponível nos exports que suportam imagem." />
              </div>
              <Button variant="outline" className="w-full" onClick={persistConfig} disabled={locked}>
                <Save className="h-4 w-4" /> Salvar configuração
              </Button>
              <p className="text-[11px] text-ink-400">
                Após alterar a configuração, gere a prévia novamente para atualizar o documento.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Assinaturas eletrônicas" description="O nome e o instante ficam gravados no relatório e na auditoria." icon={<CheckCircle2 className="h-4 w-4" />} />
            <CardBody className="space-y-3">
              {(Object.keys(ROLE_LABELS) as Array<ReportSignature['role']>).map((role) => {
                const signed = signatureSigned(role);
                const signature = report?.content.signatures.find((item) => item.role === role);
                return (
                  <div key={role} className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{ROLE_LABELS[role]}</p>
                      {signed ? <Badge tone="success">assinada</Badge> : <Badge tone="outline">pendente</Badge>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Input
                        aria-label={`Nome — ${ROLE_LABELS[role]}`}
                        className="h-9"
                        value={names[role]}
                        disabled={locked || signed}
                        onChange={(e) => setNames((prev) => ({ ...prev, [role]: e.target.value }))}
                        placeholder="Nome completo"
                      />
                      <Button size="sm" onClick={() => sign(role)} disabled={locked || signed || !report}>
                        Assinar
                      </Button>
                    </div>
                    {signature?.date ? (
                      <p className="mt-1.5 text-[11px] text-ink-400">Assinada em {formatDate(signature.date)}</p>
                    ) : null}
                  </div>
                );
              })}
              {!report ? (
                <Alert tone="info">Gere a prévia antes de assinar.</Alert>
              ) : null}
              {report?.status === 'approved' ? (
                <Alert tone="success" title="Relatório aprovado">
                  Conclua a aprovação da validação na etapa de Auditoria para bloquear os dados.
                </Alert>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Integridade" icon={<ShieldCheck className="h-4 w-4" />} />
            <CardBody className="space-y-1.5 text-xs text-ink-500">
              <p>
                Hash SHA-256:{' '}
                <span className="break-all font-mono text-[10px] text-ink-700 dark:text-ink-300">
                  {report?.content.auditHash ?? '—'}
                </span>
              </p>
              <p>Gerado em: {report ? formatDate(report.content.generatedAt) : '—'}</p>
              <p>
                O hash cobre método, validação, parâmetros, delineamento, registros de coleta e
                resultados congelados.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Alert tone="info" title="Relatórios e dados são locais">
        Nada é enviado a servidores. Exporte o pacote ZIP para arquivar dados, resultados, relatório
        e banco SQLite com manifesto de hashes. A configuração padrão do laboratório também pode ser
        ajustada em Configurações.
      </Alert>
    </StepShell>
  );
}
