import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Database,
  Download,
  FileText,
  HardDrive,
  ImagePlus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { useApp } from '../lib/app-context';
import type { AppSettings } from '../lib/types';
import {
  exportSqlite,
  getLastDataModifiedAt,
  loadSettings,
  recordBackupExport,
  saveSettings,
} from '../lib/repository';
import {
  getStoragePersistenceState,
  importDatabase,
  requestStoragePersistence,
  resetDatabase,
  type StoragePersistenceState,
} from '../lib/db';
import { evaluateBackupReminder } from '../lib/backupReminder';
import { seedIfEmpty } from '../lib/seed';
import { downloadBytes, readFileAsDataUrl } from '../lib/utils';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
  useToast,
} from '../components/ui';

export function Settings() {
  const { settings, updateSettings, bumpRefresh, bumpData } = useApp();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [persistenceState, setPersistenceState] = useState<StoragePersistenceState>('unsupported');
  const [requestingPersistence, setRequestingPersistence] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const dbInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    void getStoragePersistenceState().then(setPersistenceState);
  }, []);

  const onRequestPersistence = async () => {
    setRequestingPersistence(true);
    try {
      const granted = await requestStoragePersistence();
      setPersistenceState(granted ? 'persisted' : 'not_persisted');
      if (granted) {
        toast.push('Armazenamento persistente habilitado no navegador.', 'success');
      } else {
        toast.push('Navegador não concedeu persistência de armazenamento.', 'info');
      }
    } finally {
      setRequestingPersistence(false);
    }
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    saveSettings(draft);
    await updateSettings(draft);
    setSaved(true);
    toast.push('Configurações salvas.');
    bumpRefresh();
  };

  const onLogo = async (file: File | null) => {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      toast.push('O logo deve ter no máximo 1,5 MB.', 'danger');
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    set('logoDataUrl', dataUrl);
  };

  const downloadDb = async () => {
    const bytes = await exportSqlite();
    const updated = recordBackupExport();
    await updateSettings(updated);
    setDraft(updated);
    downloadBytes(
      bytes,
      `validametodo-${new Date().toISOString().slice(0, 10)}.sqlite`,
      'application/x-sqlite3',
    );
    toast.push('Banco SQLite exportado e data de backup atualizada.');
    bumpRefresh();
  };

  const importDb = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await importDatabase(bytes);
      const reloaded = loadSettings();
      setDraft(reloaded);
      await updateSettings(reloaded);
      bumpRefresh();
      bumpData();
      toast.push('Banco importado. Dados recarregados.');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao importar banco.', 'danger');
    } finally {
      setImporting(false);
      if (dbInput.current) dbInput.current.value = '';
    }
  };

  const reset = async () => {
    await resetDatabase();
    await seedIfEmpty();
    const reloaded = loadSettings();
    await updateSettings(reloaded);
    setDraft(reloaded);
    bumpRefresh();
    bumpData();
    setResetOpen(false);
    toast.push('Banco reiniciado com os dados de demonstração.');
  };

  const lastModifiedAt = getLastDataModifiedAt();
  const reminderStatus = evaluateBackupReminder({
    lastExportedAt: draft.lastBackupExportedAt,
    lastModifiedAt,
    thresholdDays: draft.backupReminderDays,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">Preferências locais</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">Configurações</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Identidade do laboratório, responsáveis, padrões estatísticos e gestão do banco local.
          </p>
        </div>
        <Button onClick={() => void save()}>
          <Save className="h-4 w-4" />
          {saved ? 'Salvo' : 'Salvar configurações'}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Laboratório" description="Aparece no cabeçalho do relatório e nos exports." icon={<Building2 className="h-4 w-4" />} />
          <CardBody className="space-y-3">
            <Input label="Nome do laboratório" value={draft.laboratoryName} onChange={(e) => set('laboratoryName', e.target.value)} />
            <Input label="Endereço" value={draft.laboratoryAddress} onChange={(e) => set('laboratoryAddress', e.target.value)} />
            <Input label="Acreditação / identificação" value={draft.accreditation} onChange={(e) => set('accreditation', e.target.value)} />
            <Field label="Logo" hint="PNG ou JPG, até 1,5 MB. Fica embutido no DOCX/PDF.">
              <div className="flex flex-wrap items-center gap-3">
                {draft.logoDataUrl ? (
                  <img src={draft.logoDataUrl} alt="Logo do laboratório" className="h-14 w-auto rounded-lg border border-ink-200 bg-white object-contain p-1 dark:border-ink-700" />
                ) : (
                  <div className="flex h-14 w-24 items-center justify-center rounded-lg border border-dashed border-ink-300 text-ink-400 dark:border-ink-700">
                    <ImagePlus className="h-5 w-5" />
                  </div>
                )}
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => void onLogo(e.target.files?.[0] ?? null)}
                />
                <Button variant="outline" size="sm" onClick={() => logoInput.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Enviar logo
                </Button>
                {draft.logoDataUrl ? (
                  <Button variant="ghost" size="sm" onClick={() => set('logoDataUrl', '')}>
                    <Trash2 className="h-3.5 w-3.5" /> Remover
                  </Button>
                ) : null}
              </div>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Responsáveis e assinaturas" description="Nomes pré-preenchidos nas novas validações e no relatório." icon={<Users className="h-4 w-4" />} />
          <CardBody className="space-y-3">
            <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-900/50 dark:bg-brand-950/20">
              <p className="text-xs font-semibold text-brand-900 dark:text-brand-300">Identificação declarada do operador (Auditoria local)</p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                Nome e matrícula registrados na trilha de auditoria e exigidos ao criar ou aprovar validações. Declaração de autoria, sem autenticação verificada (21 CFR Part 11).
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Input label="Nome completo *" value={draft.userName ?? ''} onChange={(e) => set('userName', e.target.value)} placeholder="Ex.: Dr. Carlos Silva" />
                <Input label="Matrícula / Registro" value={draft.userRegistration ?? ''} onChange={(e) => set('userRegistration', e.target.value)} placeholder="Ex.: CRQ 04412345" />
              </div>
            </div>
            <Input label="Responsável pela elaboração" value={draft.responsible} onChange={(e) => set('responsible', e.target.value)} />
            <Input label="Revisor" value={draft.reviewer} onChange={(e) => set('reviewer', e.target.value)} />
            <Input label="Aprovador" value={draft.approver} onChange={(e) => set('approver', e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Confiança padrão" type="number" step="0.01" min="0.5" max="0.999" value={draft.defaultConfidence} onChange={(e) => set('defaultConfidence', Number(e.target.value))} />
              <Input label="Poder padrão" type="number" step="0.05" min="0.5" max="0.99" value={draft.defaultPower} onChange={(e) => set('defaultPower', Number(e.target.value))} />
            </div>
            <Field label="Tema">
              <Select value={draft.theme} onChange={(e) => set('theme', e.target.value as AppSettings['theme'])}>
                <option value="light">Claro</option>
                <option value="dark">Escuro</option>
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Relatório" description="Textos padrão e referências normativas." icon={<FileText className="h-4 w-4" />} />
          <CardBody className="grid gap-3 lg:grid-cols-2">
            <Textarea label="Introdução padrão" value={draft.reportIntro} onChange={(e) => set('reportIntro', e.target.value)} />
            <Textarea label="Rodapé / aviso de reprodução" value={draft.reportFooter} onChange={(e) => set('reportFooter', e.target.value)} />
            <Field label="Referências" hint="Uma por linha. Entram no relatório, além das referências estatísticas dos parâmetros." className="lg:col-span-2">
              <Textarea
                className="min-h-[130px] font-mono text-xs"
                value={draft.references.join('\n')}
                onChange={(e) => set('references', e.target.value.split('\n').map((line) => line.trim()).filter(Boolean))}
              />
            </Field>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Dados e backup"
            description="O banco é um arquivo SQLite real persistido em IndexedDB."
            icon={<Database className="h-4 w-4" />}
          />
          <CardBody className="space-y-4">
            {reminderStatus.shouldRemind && (
              <Alert
                tone={reminderStatus.reason === 'never_exported' ? 'danger' : 'warning'}
                title="Lembrete de backup de dados locais"
              >
                {reminderStatus.message}
              </Alert>
            )}

            <Alert tone="info" title="Offline-first">
              Nada é enviado a servidores externos. Exporte o .sqlite periodicamente ou antes de limpar o navegador. O pacote de evidências de cada validação inclui o banco e um manifesto de hashes.
            </Alert>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void downloadDb()}>
                <Download className="h-4 w-4" /> Exportar banco (.sqlite)
              </Button>
              <input
                ref={dbInput}
                type="file"
                accept=".sqlite,.db,application/x-sqlite3,application/octet-stream"
                className="hidden"
                onChange={(e) => void importDb(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" loading={importing} onClick={() => dbInput.current?.click()}>
                <Upload className="h-4 w-4" /> Importar banco
              </Button>
              <Button variant="danger" onClick={() => setResetOpen(true)}>
                <RotateCcw className="h-4 w-4" /> Reiniciar dados
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Persistência do Navegador
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  {persistenceState === 'persisted' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Persistente
                    </span>
                  )}
                  {persistenceState === 'not_persisted' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" /> Não persistente
                    </span>
                  )}
                  {persistenceState === 'unsupported' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                      Indisponível
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {persistenceState === 'persisted'
                    ? 'Protegido contra limpeza automática de cache pelo navegador sob pressão de armazenamento.'
                    : persistenceState === 'not_persisted'
                      ? 'O navegador pode descartar dados locais caso falte espaço em disco.'
                      : 'StorageManager API não suportada neste ambiente.'}
                </p>
                {persistenceState === 'not_persisted' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full text-xs"
                    loading={requestingPersistence}
                    onClick={() => void onRequestPersistence()}
                  >
                    <HardDrive className="h-3.5 w-3.5" /> Solicitar persistência
                  </Button>
                )}
              </div>

              <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Lembrete de Backup
                </p>
                <p className="mt-1 text-sm font-medium text-ink-800 dark:text-ink-100">
                  {reminderStatus.shouldRemind ? (
                    <span className="font-semibold text-amber-600 dark:text-amber-400">Backup recomendado</span>
                  ) : (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">Em dia</span>
                  )}
                </p>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  Último export:{' '}
                  {draft.lastBackupExportedAt
                    ? new Date(draft.lastBackupExportedAt).toLocaleDateString()
                    : 'Nunca exportado'}
                </p>
              </div>

              <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Portabilidade</p>
                <p className="mt-1 text-sm font-medium text-ink-800 dark:text-ink-100">Arquivo .sqlite padrão</p>
                <p className="mt-1.5 text-[11px] text-ink-500">Compatível com DB Browser, Python, R e CLI</p>
              </div>

              <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Integridade</p>
                <p className="mt-1 text-sm font-medium text-ink-800 dark:text-ink-100">Hash SHA-256 no relatório</p>
                <p className="mt-1.5 text-[11px] text-ink-500">Cadeia de custódia e âncora externa exportável</p>
              </div>
            </div>

            <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-3 dark:border-ink-800 dark:bg-ink-900/30">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Intervalo para lembrete de backup (dias)"
                  type="number"
                  min="1"
                  max="90"
                  value={draft.backupReminderDays ?? 7}
                  onChange={(e) =>
                    set('backupReminderDays', Math.max(1, Number(e.target.value) || 7))
                  }
                  hint="Exibe um alerta quando o último backup exportado ultrapassar este limite."
                />
                <div className="flex flex-col justify-end pb-1 text-xs text-ink-500">
                  <p>
                    <strong>Último backup exportado:</strong>{' '}
                    {draft.lastBackupExportedAt
                      ? new Date(draft.lastBackupExportedAt).toLocaleString()
                      : 'Nenhum backup registrado'}
                  </p>
                  <p className="mt-0.5">
                    <strong>Última alteração de dados:</strong>{' '}
                    {lastModifiedAt ? new Date(lastModifiedAt).toLocaleString() : 'Nenhuma alteração registrada'}
                  </p>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reiniciar banco local"
        description="Todos os métodos, validações, medições, relatórios e logs serão substituídos pelo conjunto de demonstração."
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void reset()}>Reiniciar agora</Button>
          </>
        }
      >
        <Alert tone="danger" title="Exporte um backup antes">
          Esta ação não pode ser desfeita. O arquivo .sqlite exportado continua abrindo em qualquer ferramenta SQLite.
        </Alert>
      </Modal>

      <Card>
        <CardHeader title="Sobre o ValidaMétodo" icon={<ShieldCheck className="h-4 w-4" />} />
        <CardBody className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
          <p>
            Sistema offline-first para validação de métodos analíticos. O núcleo estatístico implementa as fórmulas de ISO 5725, GUM, ICH Q2(R2), ISO 8466 e ISO 11843, com testes de referência contra valores publicados.
          </p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-ink-100 px-2 py-1 dark:bg-ink-800">React 18 + TypeScript</span>
            <span className="rounded-full bg-ink-100 px-2 py-1 dark:bg-ink-800">SQLite WASM</span>
            <span className="rounded-full bg-ink-100 px-2 py-1 dark:bg-ink-800">DOCX / PDF / XLSX / ZIP</span>
            <span className="rounded-full bg-ink-100 px-2 py-1 dark:bg-ink-800">Hash de auditoria</span>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()}>
          <Save className="h-4 w-4" /> {saved ? 'Salvo' : 'Salvar configurações'}
        </Button>
      </div>
    </div>
  );
}
