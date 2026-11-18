import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileText,
  History,
  Lock,
  ScrollText,
  ShieldCheck,
  Unlock,
  XCircle,
} from 'lucide-react';
import type { AuditLog } from '../../lib/types';
import { STATUS_LABELS } from '../../lib/types';
import {
  approveValidation,
  createVersionSnapshot,
  newVersion,
  verifyValidationAuditTrail,
} from '../../lib/repository';
import {
  buildEvidenceZip,
  downloadEvidenceZip,
  downloadValidationSqlite,
} from '../../lib/export';
import { formatDate, downloadText, slugify } from '../../lib/utils';
import { StepShell } from '../../components/wizard';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Modal,
  Textarea,
  VerdictBadge,
  useToast,
} from '../../components/ui';
import type { StepProps } from './types';

const STATUS_TONE = {
  draft: 'neutral',
  in_progress: 'info',
  in_review: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const;

export function StepAudit({ bundle, analysis, goTo, reload }: StepProps) {
  const toast = useToast();
  const { validation, report, versions, audit } = bundle;
  const [approveOpen, setApproveOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [busy, setBusy] = useState(false);

  const auditVerification = useMemo(
    () => verifyValidationAuditTrail(bundle.validation.id),
    [bundle.validation.id, audit],
  );

  useEffect(() => {
    setReason('');
  }, [approveOpen, versionOpen]);

  const selectedParameters = bundle.parameters.filter((parameter) => parameter.selected);
  const failed = analysis.parameters.filter((parameter) => parameter.verdict === 'fail');
  const pending = analysis.parameters.filter((parameter) => parameter.verdict === 'not_evaluated');
  const reportSigned =
    report?.content.signatures.every((signature) => signature.signed) ?? false;

  const checklist = [
    {
      label: 'Método e identificação registrados',
      ok: Boolean(bundle.method.code && bundle.method.name),
    },
    {
      label: 'Ao menos um parâmetro selecionado',
      ok: selectedParameters.length > 0,
    },
    {
      label: 'Delineamento salvo',
      ok: Boolean(bundle.design),
    },
    {
      label: 'Medições numéricas ou textuais registradas',
      ok: bundle.measurements.length > 0,
    },
    {
      label: 'Todos os parâmetros avaliados',
      ok: analysis.parameters.length > 0 && pending.length === 0,
    },
    {
      label: 'Relatório gerado',
      ok: Boolean(report),
    },
    {
      label: 'Relatório com todas as assinaturas',
      ok: reportSigned,
    },
  ];

  const [postApproveOpen, setPostApproveOpen] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [exportingSqlite, setExportingSqlite] = useState(false);

  const handleDownloadEvidenceZip = async () => {
    if (!report) return;
    setExportingZip(true);
    try {
      const bytes = await buildEvidenceZip(bundle, analysis, report);
      downloadEvidenceZip(bytes, bundle);
      toast.push('Pacote de evidências baixado.');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao gerar pacote de evidências.', 'danger');
    } finally {
      setExportingZip(false);
    }
  };

  const handleDownloadSqlite = async () => {
    setExportingSqlite(true);
    try {
      await downloadValidationSqlite(bundle);
      toast.push('Banco SQLite exportado.');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao exportar banco.', 'danger');
    } finally {
      setExportingSqlite(false);
    }
  };

  const doApprove = () => {
    if (!report) {
      toast.push('Gere o relatório da versão atual antes de aprovar.', 'danger');
      return;
    }
    if (!reportSigned) {
      toast.push('Todas as assinaturas são obrigatórias antes da aprovação.', 'danger');
      return;
    }
    if (!validation.approver.trim() && !reason.trim()) {
      toast.push('Informe o aprovador ou uma justificativa.', 'danger');
      return;
    }
    setBusy(true);
    try {
      const actor = validation.approver.trim() || 'aprovador';
      approveValidation(validation.id, actor, reason.trim() || 'Aprovação da validação');
      toast.push('Validação aprovada, versionada e bloqueada.');
      setApproveOpen(false);
      setPostApproveOpen(true);
      reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao aprovar.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const doNewVersion = () => {
    if (!reason.trim()) {
      toast.push('Informe a justificativa da nova versão.', 'danger');
      return;
    }
    setBusy(true);
    try {
      const next = newVersion(validation.id, reason.trim(), validation.responsible || 'sistema');
      toast.push(`Nova versão ${next.version} aberta para edição.`);
      setVersionOpen(false);
      reload();
      goTo(0);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao criar nova versão.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const snapshot = () => {
    setBusy(true);
    try {
      const version = createVersionSnapshot(
        validation.id,
        'Snapshot manual solicitado na auditoria',
        validation.responsible || 'sistema',
      );
      downloadText(
        version.snapshot,
        `${slugify(bundle.method.code || 'metodo')}-v${version.version}-snapshot.json`,
        'application/json',
      );
      toast.push('Snapshot da versão atual baixado.');
      reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao gerar snapshot.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell
      step={6}
      title="Auditoria, versões e aprovação"
      description="Revise a trilha completa, baixe snapshots, aprove a validação e bloqueie os dados. Alterações posteriores exigem justificativa e nova versão."
      locked={validation.locked}
      help={
        <>
          <p>
            A aprovação cria um snapshot imutável em <code>validation_versions</code>, bloqueia a
            edição e registra o evento. A nova versão mantém o histórico anterior.
          </p>
          <p className="mt-1">
            O log de auditoria registra antes/depois de cada escrita. Ele é a evidência de
            rastreabilidade do processo.
          </p>
        </>
      }
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[validation.status]}>{STATUS_LABELS[validation.status]}</Badge>
          <Badge tone="outline">v{validation.version}</Badge>
          {validation.locked ? <Badge tone="success"><Lock className="h-3 w-3" /> bloqueada</Badge> : <Badge tone="neutral"><Unlock className="h-3 w-3" /> editável</Badge>}
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => goTo(5)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={snapshot} loading={busy} disabled={validation.locked}>
              <Download className="h-4 w-4" /> Snapshot atual
            </Button>
            {validation.locked ? (
              <>
                <Button variant="outline" onClick={handleDownloadEvidenceZip} loading={exportingZip} disabled={!report}>
                  <Archive className="h-4 w-4" /> Baixar evidências (.zip)
                </Button>
                <Button variant="outline" onClick={handleDownloadSqlite} loading={exportingSqlite}>
                  <Database className="h-4 w-4" /> Baixar banco (.sqlite)
                </Button>
                <Button onClick={() => setVersionOpen(true)}>
                  <History className="h-4 w-4" /> Criar nova versão
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setApproveOpen(true)}
                disabled={!report || !reportSigned}
                title={
                  !report
                    ? 'Gere o relatório da versão atual.'
                    : !reportSigned
                      ? 'Conclua as três assinaturas do relatório.'
                      : undefined
                }
              >
                <ShieldCheck className="h-4 w-4" /> Aprovar validação
              </Button>
            )}
          </div>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Resumo do processo" icon={<ScrollText className="h-4 w-4" />} />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
              <p className="text-[11px] uppercase tracking-wide text-ink-400">Status</p>
              <p className="mt-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{STATUS_LABELS[validation.status]}</p>
              <p className="text-xs text-ink-500">{validation.locked ? 'Dados congelados' : 'Em edição'}</p>
            </div>
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
              <p className="text-[11px] uppercase tracking-wide text-ink-400">Versão</p>
              <p className="mt-1 text-sm font-semibold text-ink-800 dark:text-ink-100">v{validation.version}</p>
              <p className="text-xs text-ink-500">{versions.length} snapshot(s) arquivado(s)</p>
            </div>
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
              <p className="text-[11px] uppercase tracking-wide text-ink-400">Aprovação</p>
              <p className="mt-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{validation.approvedAt ? formatDate(validation.approvedAt) : 'Pendente'}</p>
              <p className="text-xs text-ink-500">{validation.approver || 'Aprovador não informado'}</p>
            </div>
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
              <p className="text-[11px] uppercase tracking-wide text-ink-400">Relatório</p>
              <p className="mt-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{report ? `v${report.version} · ${report.status}` : 'Não gerado'}</p>
              <p className="text-xs text-ink-500">{report?.content.auditHash.slice(0, 20) ?? '—'}</p>
            </div>
            <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-wide text-ink-400">Resultado global da análise</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <VerdictBadge verdict={analysis.overallVerdict} />
                {failed.length ? <Badge tone="danger">{failed.length} não conforme(s)</Badge> : null}
                {pending.length ? <Badge tone="warning">{pending.length} não avaliado(s)</Badge> : null}
                <span className="text-xs text-ink-500">{analysis.nUsed} de {analysis.nTotal} medições usadas</span>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Pré-requisitos" icon={<CheckCircle2 className="h-4 w-4" />} />
          <CardBody className="space-y-1.5">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-start gap-2 text-xs">
                {item.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300 dark:text-ink-600" />
                )}
                <span className={item.ok ? 'text-ink-600 dark:text-ink-300' : 'text-ink-400'}>{item.label}</span>
              </div>
            ))}
            <div className="pt-2">
              {failed.length ? (
                <Alert tone="danger" title="Há parâmetros não conformes">
                  A aprovação pode registrar a conclusão de não adequação. Verifique o relatório e a
                  decisão do laboratório.
                </Alert>
              ) : pending.length ? (
                <Alert tone="warning" title="Há parâmetros não avaliados">
                  A conclusão ficará limitada. Revise os dados e critérios antes de aprovar.
                </Alert>
              ) : (
                <Alert tone="success" title="Todos os parâmetros avaliados">
                  Não há pendências estatísticas bloqueantes.
                </Alert>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {validation.locked ? (
        <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <CardBody className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <h4 className="font-semibold text-emerald-900 dark:text-emerald-100 text-sm">
                  Validação Aprovada e Congelada (v{validation.version})
                </h4>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Os dados estão protegidos contra edições. Para retenção de dados brutos (ISO/IEC 17025 e BPL), baixe o pacote de evidências ou o backup do banco SQLite.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={handleDownloadEvidenceZip} loading={exportingZip} disabled={!report}>
                <Archive className="h-3.5 w-3.5 mr-1" /> Evidências (.zip)
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownloadSqlite} loading={exportingSqlite}>
                <Database className="h-3.5 w-3.5 mr-1" /> Banco (.sqlite)
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={`Trilha de auditoria (${audit.length})`}
          description="Eventos ordenados cronologicamente. Cada registro é encadeado por SHA-256 (21 CFR Part 11)."
          icon={<ScrollText className="h-4 w-4" />}
          action={
            auditVerification.isValid ? (
              <Badge tone="success" className="gap-1 font-mono text-[11px]">
                <ShieldCheck className="h-3 w-3" /> 21 CFR Part 11 · Íntegra ({auditVerification.totalLogs} blocos)
              </Badge>
            ) : (
              <Badge tone="danger" className="gap-1 font-mono text-[11px]">
                <AlertTriangle className="h-3 w-3" /> Falha de integridade
              </Badge>
            )
          }
        />
        {!auditVerification.isValid ? (
          <div className="p-4 border-b border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/20">
            <Alert tone="danger" title="Violação de Integridade Criptográfica (21 CFR Part 11)">
              {auditVerification.tamperedReason}
            </Alert>
          </div>
        ) : null}
        {audit.length === 0 ? (
          <CardBody>
            <EmptyState title="Nenhum evento" description="As escritas relevantes aparecerão aqui." />
          </CardBody>
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Entidade</th>
                  <th>Ação</th>
                  <th>Ator</th>
                  <th>Hash SHA-256</th>
                  <th>Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  <tr key={entry.id} className="cursor-pointer hover:bg-ink-50/60 dark:hover:bg-ink-800/40" onClick={() => setSelectedLog(entry)}>
                    <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(entry.timestamp)}</td>
                    <td className="text-xs font-medium">{entry.entity}</td>
                    <td className="text-xs">{entry.action}</td>
                    <td className="text-xs">{entry.actor}</td>
                    <td
                      className="whitespace-nowrap font-mono text-[11px] text-ink-600 dark:text-ink-400"
                      title={`Hash atual: ${entry.currentHash || '—'}\nHash anterior: ${entry.previousHash || '—'}`}
                    >
                      {entry.currentHash ? `${entry.currentHash.slice(0, 10)}…` : '—'}
                    </td>
                    <td className="max-w-[320px] truncate text-xs text-ink-500" title={entry.reason}>{entry.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title={`Versões arquivadas (${versions.length})`}
          description="Snapshots imutáveis do processo no momento da aprovação ou de uma abertura de versão."
          icon={<History className="h-4 w-4" />}
        />
        {versions.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="Nenhuma versão arquivada"
              description="Aprovar a validação cria o primeiro snapshot. Você também pode gerar um snapshot manual."
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Criada em</th>
                  <th>Criada por</th>
                  <th>Justificativa</th>
                  <th className="text-right">Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td className="font-mono text-xs font-semibold">v{version.version}</td>
                    <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(version.createdAt)}</td>
                    <td className="text-xs">{version.createdBy}</td>
                    <td className="max-w-[360px] text-xs text-ink-500">{version.reason}</td>
                    <td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          downloadText(
                            version.snapshot,
                            `${slugify(bundle.method.code || 'metodo')}-v${version.version}-snapshot.json`,
                            'application/json',
                          )
                        }
                      >
                        <Download className="h-3.5 w-3.5" /> Baixar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Aprovar e bloquear validação"
        description="A aprovação cria um snapshot, congela os dados e registra o evento de auditoria."
        footer={
          <>
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>Cancelar</Button>
            <Button variant="success" onClick={doApprove} loading={busy} disabled={!report || !reportSigned}>
              <ShieldCheck className="h-4 w-4" /> Aprovar validação
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Alert tone="warning" title="Ação irreversível sem nova versão">
            Após aprovar, nenhuma edição será aceita. Para corrigir algo será necessário abrir uma
            nova versão com justificativa.
          </Alert>
          <div className="rounded-xl border border-ink-200 p-3 text-sm dark:border-ink-800">
            <p className="font-medium text-ink-900 dark:text-white">Aprovador: {validation.approver || 'não informado'}</p>
            <p className="mt-1 text-xs text-ink-500">
              Relatório: {report ? `v${report.version}, ${report.content.signatures.filter((signature) => signature.signed).length}/3 assinatura(s)` : 'não gerado'}
            </p>
            <p className="text-xs text-ink-500">
              Resultado: {analysis.overallVerdict === 'pass' ? 'conforme' : analysis.overallVerdict === 'fail' ? 'não conforme' : analysis.overallVerdict === 'warning' ? 'atenção' : 'não avaliado'}
            </p>
          </div>
          {!reportSigned ? (
            <Alert tone="warning" title="Assinaturas pendentes">
              A aprovação exige as assinaturas de elaboração, revisão e aprovação do relatório
              desta versão.
            </Alert>
          ) : null}
          <Textarea
            label="Justificativa / decisão"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: Aprovado após revisão do relatório e verificação dos critérios."
          />
        </div>
      </Modal>

      <Modal
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        title="Criar nova versão"
        description="O histórico atual é preservado em um snapshot. A validação volta a ser editável."
        footer={
          <>
            <Button variant="ghost" onClick={() => setVersionOpen(false)}>Cancelar</Button>
            <Button onClick={doNewVersion} loading={busy}>
              <History className="h-4 w-4" /> Criar versão {validation.version + 1}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            label="Justificativa"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: Correção de uma medição após revisão do cromatograma."
          />
          <Alert tone="info">
            A versão atual (v{validation.version}) permanece congelada nos snapshots. A nova versão
            começa como “em andamento” e mantém os dados existentes.
          </Alert>
        </div>
      </Modal>

      <Modal
        open={selectedLog !== null}
        onClose={() => setSelectedLog(null)}
        title={selectedLog ? `${selectedLog.entity} · ${selectedLog.action}` : 'Evento'}
        description={selectedLog ? `${formatDate(selectedLog.timestamp)} · ${selectedLog.actor}` : undefined}
        size="lg"
        footer={<Button variant="outline" onClick={() => setSelectedLog(null)}>Fechar</Button>}
      >
        {selectedLog ? (
          <div className="space-y-3">
            {selectedLog.reason ? <Alert tone="info">{selectedLog.reason}</Alert> : null}

            <div className="grid gap-2 rounded-lg border border-ink-100 bg-ink-50 p-2.5 text-xs dark:border-ink-800 dark:bg-ink-950 sm:grid-cols-2">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Hash Anterior (Previous Hash)</span>
                <p className="mt-0.5 break-all font-mono text-[11px] text-ink-700 dark:text-ink-300">
                  {selectedLog.previousHash || '0000000000000000000000000000000000000000000000000000000000000000 (GENESIS)'}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Hash do Bloco (Current Hash SHA-256)</span>
                <p className="mt-0.5 break-all font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                  {selectedLog.currentHash || '—'}
                </p>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Antes</p>
              <pre className="max-h-[240px] overflow-auto rounded-xl bg-ink-950 p-3 text-[11px] text-ink-100">
                {JSON.stringify(selectedLog.before, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Depois</p>
              <pre className="max-h-[240px] overflow-auto rounded-xl bg-ink-950 p-3 text-[11px] text-ink-100">
                {JSON.stringify(selectedLog.after, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={postApproveOpen}
        onClose={() => setPostApproveOpen(false)}
        title="Validação Aprovada com Sucesso!"
        size="md"
        footer={
          <Button variant="outline" onClick={() => setPostApproveOpen(false)}>
            Concluir
          </Button>
        }
      >
        <div className="space-y-4 text-xs text-ink-600 dark:text-ink-300">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                Estudo congelado na versão {validation.version}
              </p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                Todas as 3 assinaturas foram validadas e a trilha de auditoria está selada criptograficamente.
              </p>
            </div>
          </div>

          <p>
            Para atender aos requisitos regulatórios de retenção e arquivamento de dados brutos (ISO/IEC 17025 e BPL),
            recomendamos o download imediato do pacote completo de evidências ou da cópia do banco de dados SQLite:
          </p>

          <div className="space-y-2">
            <Button
              className="w-full justify-start text-left py-3 px-3.5 h-auto"
              variant="outline"
              onClick={handleDownloadEvidenceZip}
              loading={exportingZip}
              disabled={!report}
            >
              <Archive className="h-5 w-5 text-teal-600 mr-3 shrink-0" />
              <div>
                <span className="font-semibold block text-ink-900 dark:text-ink-100">Baixar Pacote de Evidências (.zip)</span>
                <span className="text-[11px] text-ink-400 block font-normal">
                  Contém PDF, DOCX, CSV de dados, banco SQLite e MANIFESTO.txt com hashes SHA-256
                </span>
              </div>
            </Button>

            <Button
              className="w-full justify-start text-left py-3 px-3.5 h-auto"
              variant="outline"
              onClick={handleDownloadSqlite}
              loading={exportingSqlite}
            >
              <Database className="h-5 w-5 text-blue-600 mr-3 shrink-0" />
              <div>
                <span className="font-semibold block text-ink-900 dark:text-ink-100">Baixar Cópia do Banco SQLite (.sqlite)</span>
                <span className="text-[11px] text-ink-400 block font-normal">
                  Arquivo SQLite físico para armazenamento frio e auditorias externas
                </span>
              </div>
            </Button>
          </div>
        </div>
      </Modal>
    </StepShell>
  );
}
