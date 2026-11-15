import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  computeAuditLogHash,
  sha256Sync,
  verifyAuditChain,
  type StoredAuditRow,
} from '../auditChain';

describe('sha256Sync (NIST FIPS 180-4 standard vectors)', () => {
  it('calcula o digest correto para string vazia', () => {
    expect(sha256Sync('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('calcula o digest correto para "abc"', () => {
    expect(sha256Sync('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('calcula o digest correto para "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"', () => {
    expect(
      sha256Sync('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

describe('verifyAuditChain (21 CFR Part 11 Hash-Chaining)', () => {
  function createChain(count: number): StoredAuditRow[] {
    const logs: StoredAuditRow[] = [];
    let prevHash = GENESIS_HASH;

    for (let i = 1; i <= count; i++) {
      const entry: StoredAuditRow = {
        id: `aud-${i}`,
        validation_id: 'val-001',
        entity: 'measurement',
        action: 'create',
        actor: `analyst-${i}`,
        before_json: null,
        after_json: JSON.stringify({ runOrder: i, value: i * 10 }),
        reason: `Medição ${i}`,
        timestamp: new Date(2026, 0, 1, 10, i).toISOString(),
        previous_hash: prevHash,
      };

      const currHash = computeAuditLogHash({
        previousHash: prevHash,
        id: entry.id,
        validationId: entry.validation_id,
        entity: entry.entity,
        action: entry.action,
        actor: entry.actor,
        beforeJson: entry.before_json,
        afterJson: entry.after_json,
        reason: entry.reason,
        timestamp: entry.timestamp,
      });

      entry.current_hash = currHash;
      logs.push(entry);
      prevHash = currHash;
    }

    return logs;
  }

  it('valida com sucesso uma cadeia íntegra de múltiplos registros', () => {
    const logs = createChain(10);
    const result = verifyAuditChain(logs);

    expect(result.isValid).toBe(true);
    expect(result.totalLogs).toBe(10);
    expect(result.verifiedLogs).toBe(10);
    expect(result.tamperedLogId).toBeNull();
    expect(result.latestHash).toBe(logs[9].current_hash);
  });

  it('detecta alteração em um campo de auditoria (ex.: actor ou valor alterado)', () => {
    const logs = createChain(5);
    // Adulteração no registro 3
    logs[2].actor = 'hacker';

    const result = verifyAuditChain(logs);
    expect(result.isValid).toBe(false);
    expect(result.tamperedLogId).toBe('aud-3');
    expect(result.tamperedReason).toContain('Adulteração detectada');
    expect(result.verifiedLogs).toBe(2);
  });

  it('detecta remoção de um registro intermediário (quebra de encadeamento)', () => {
    const logs = createChain(5);
    // Remove o registro 3
    logs.splice(2, 1);

    const result = verifyAuditChain(logs);
    expect(result.isValid).toBe(false);
    expect(result.tamperedLogId).toBe('aud-4');
    expect(result.tamperedReason).toContain('Quebra de elo na cadeia');
  });

  it('retorna válido para lista vazia de logs', () => {
    const result = verifyAuditChain([]);
    expect(result.isValid).toBe(true);
    expect(result.totalLogs).toBe(0);
    expect(result.verifiedLogs).toBe(0);
  });
});
