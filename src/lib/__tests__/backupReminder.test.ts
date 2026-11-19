import { describe, expect, it } from 'vitest';
import { evaluateBackupReminder } from '../backupReminder';

describe('evaluateBackupReminder', () => {
  const referenceNow = new Date('2026-11-19T12:00:00.000Z');

  it('solicita backup se nunca foi exportado (lastExportedAt ausente ou nulo)', () => {
    const res1 = evaluateBackupReminder({
      lastExportedAt: null,
      now: referenceNow,
    });
    expect(res1.shouldRemind).toBe(true);
    expect(res1.reason).toBe('never_exported');
    expect(res1.daysSinceLastBackup).toBeNull();
    expect(res1.hasUnexportedChanges).toBe(true);

    const res2 = evaluateBackupReminder({
      lastExportedAt: undefined,
      now: referenceNow,
    });
    expect(res2.shouldRemind).toBe(true);
    expect(res2.reason).toBe('never_exported');
  });

  it('solicita backup se a data informada for invalida', () => {
    const res = evaluateBackupReminder({
      lastExportedAt: 'data_invalida',
      now: referenceNow,
    });
    expect(res.shouldRemind).toBe(true);
    expect(res.reason).toBe('never_exported');
  });

  it('considera em dia quando exportado recentemente dentro do limite configurado', () => {
    // Exportado há 3 dias (limiar padrão 7)
    const exportedAt = new Date('2026-11-16T12:00:00.000Z').toISOString();
    const res = evaluateBackupReminder({
      lastExportedAt: exportedAt,
      thresholdDays: 7,
      now: referenceNow,
    });
    expect(res.shouldRemind).toBe(false);
    expect(res.reason).toBeNull();
    expect(res.daysSinceLastBackup).toBe(3);
    expect(res.hasUnexportedChanges).toBe(false);
  });

  it('emite alerta de overdue quando ultrapassa o limite de dias', () => {
    // Exportado há 10 dias (limiar 7)
    const exportedAt = new Date('2026-11-09T12:00:00.000Z').toISOString();
    const res = evaluateBackupReminder({
      lastExportedAt: exportedAt,
      thresholdDays: 7,
      now: referenceNow,
    });
    expect(res.shouldRemind).toBe(true);
    expect(res.reason).toBe('overdue');
    expect(res.daysSinceLastBackup).toBe(10);
    expect(res.message).toContain('10 dias');
  });

  it('respeita limiar customizado de dias', () => {
    // Exportado há 4 dias (limiar customizado de 3 dias)
    const exportedAt = new Date('2026-11-15T12:00:00.000Z').toISOString();
    const res = evaluateBackupReminder({
      lastExportedAt: exportedAt,
      thresholdDays: 3,
      now: referenceNow,
    });
    expect(res.shouldRemind).toBe(true);
    expect(res.reason).toBe('overdue');
    expect(res.daysSinceLastBackup).toBe(4);
    expect(res.thresholdDays).toBe(3);
  });

  it('alerta sobre alteracoes nao exportadas quando modificacao posterior ao export', () => {
    // Exportado há 2 dias
    const exportedAt = new Date('2026-11-17T10:00:00.000Z').toISOString();
    // Modificado há 1 dia (posterior ao export)
    const modifiedAt = new Date('2026-11-18T15:00:00.000Z').toISOString();

    const res = evaluateBackupReminder({
      lastExportedAt: exportedAt,
      lastModifiedAt: modifiedAt,
      thresholdDays: 7,
      now: referenceNow,
    });
    expect(res.shouldRemind).toBe(true);
    expect(res.reason).toBe('unexported_changes');
    expect(res.hasUnexportedChanges).toBe(true);
    expect(res.daysSinceLastBackup).toBe(2);
  });

  it('nao alerta sobre alteracoes se a ultima modificacao for anterior ao export', () => {
    // Exportado há 2 dias
    const exportedAt = new Date('2026-11-17T15:00:00.000Z').toISOString();
    // Modificado há 3 dias (anterior ao export)
    const modifiedAt = new Date('2026-11-16T10:00:00.000Z').toISOString();

    const res = evaluateBackupReminder({
      lastExportedAt: exportedAt,
      lastModifiedAt: modifiedAt,
      thresholdDays: 7,
      now: referenceNow,
    });
    expect(res.shouldRemind).toBe(false);
    expect(res.reason).toBeNull();
    expect(res.hasUnexportedChanges).toBe(false);
  });
});
