/**
 * Lógica de verificação e lembrete de backup de dados locais.
 *
 * Em arquiteturas local-first (IndexedDB), o backup periódico é a principal defesa
 * contra a limpeza de cache/armazenamento pelo navegador ou usuário.
 */

export interface BackupReminderStatus {
  shouldRemind: boolean;
  reason: 'overdue' | 'unexported_changes' | 'never_exported' | null;
  daysSinceLastBackup: number | null;
  thresholdDays: number;
  lastExportedAt: string | null;
  hasUnexportedChanges: boolean;
  message: string;
}

export function evaluateBackupReminder(params: {
  lastExportedAt: string | null | undefined;
  lastModifiedAt?: string | null | undefined;
  thresholdDays?: number;
  now?: Date;
}): BackupReminderStatus {
  const threshold = params.thresholdDays && params.thresholdDays > 0 ? params.thresholdDays : 7;
  const now = params.now ?? new Date();

  if (!params.lastExportedAt) {
    return {
      shouldRemind: true,
      reason: 'never_exported',
      daysSinceLastBackup: null,
      thresholdDays: threshold,
      lastExportedAt: null,
      hasUnexportedChanges: true,
      message:
        'Nenhum backup foi exportado ainda. Exporte o banco SQLite para garantir a segurança dos seus dados locais.',
    };
  }

  const lastExportTime = new Date(params.lastExportedAt).getTime();
  if (!Number.isFinite(lastExportTime)) {
    return {
      shouldRemind: true,
      reason: 'never_exported',
      daysSinceLastBackup: null,
      thresholdDays: threshold,
      lastExportedAt: null,
      hasUnexportedChanges: true,
      message: 'Data de backup inválida. Exporte uma nova cópia do banco.',
    };
  }

  const diffMs = now.getTime() - lastExportTime;
  const daysSince = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const isOverdue = daysSince >= threshold;

  let hasUnexportedChanges = false;
  if (params.lastModifiedAt) {
    const modTime = new Date(params.lastModifiedAt).getTime();
    if (Number.isFinite(modTime)) {
      hasUnexportedChanges = modTime > lastExportTime;
    }
  }

  if (isOverdue) {
    return {
      shouldRemind: true,
      reason: 'overdue',
      daysSinceLastBackup: daysSince,
      thresholdDays: threshold,
      lastExportedAt: params.lastExportedAt,
      hasUnexportedChanges,
      message: `Último backup exportado há ${daysSince} dia${daysSince === 1 ? '' : 's'} (limite configurado: ${threshold} dias). Recomendamos exportar o banco SQLite agora.`,
    };
  }

  if (hasUnexportedChanges) {
    return {
      shouldRemind: true,
      reason: 'unexported_changes',
      daysSinceLastBackup: daysSince,
      thresholdDays: threshold,
      lastExportedAt: params.lastExportedAt,
      hasUnexportedChanges: true,
      message:
        'Existem alterações recentes que ainda não foram salvas em um arquivo de backup externo.',
    };
  }

  return {
    shouldRemind: false,
    reason: null,
    daysSinceLastBackup: daysSince,
    thresholdDays: threshold,
    lastExportedAt: params.lastExportedAt,
    hasUnexportedChanges: false,
    message: `Backup em dia (exportado há ${daysSince} dia${daysSince === 1 ? '' : 's'}).`,
  };
}
