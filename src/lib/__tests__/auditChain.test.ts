import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  computeAuditLogHash,
  sha256Sync,
  verifyAuditChain,
  exportAuditAnchor,
  verifyAuditChainWithAnchor,
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

  it('detecta edição no meio da cadeia quando recalculado apenas o registro alterado', () => {
    const logs = createChain(5);
    // Adulteração no registro 3: altera o ator e recalcula seu hash intrínseco
    logs[2].actor = 'operador_modificado';
    logs[2].current_hash = computeAuditLogHash({
      previousHash: logs[2].previous_hash!,
      id: logs[2].id,
      validationId: logs[2].validation_id,
      entity: logs[2].entity,
      action: logs[2].action,
      actor: logs[2].actor,
      beforeJson: logs[2].before_json,
      afterJson: logs[2].after_json,
      reason: logs[2].reason,
      timestamp: logs[2].timestamp,
    });

    // O registro 4 ainda aponta para o previous_hash antigo
    const result = verifyAuditChain(logs);
    expect(result.isValid).toBe(false);
    expect(result.tamperedLogId).toBe('aud-4');
    expect(result.tamperedReason).toContain('Quebra de elo na cadeia');
    expect(result.verifiedLogs).toBe(3);
  });

  it('exporta âncora de custódia e valida cadeia íntegra contra o hash âncora', () => {
    const logs = createChain(6);
    const anchor = exportAuditAnchor(logs);

    expect(anchor.totalLogs).toBe(6);
    expect(anchor.latestHash).toBe(logs[5].current_hash);
    expect(anchor.logsChecksum).toBeDefined();

    const result = verifyAuditChainWithAnchor(logs, anchor);
    expect(result.isValid).toBe(true);
    expect(result.anchorMatches).toBe(true);
    expect(result.divergenceReason).toBeNull();
  });

  it('detecta divergência contra âncora exportada mesmo se toda a cadeia for recalculada no IndexedDB', () => {
    const logs = createChain(5);
    // Exporta âncora antes de qualquer adulteração
    const anchor = exportAuditAnchor(logs);

    // Ataque simulado no IndexedDB: adulterar o registro 2 e recalcular toda a cadeia subsequente
    // para tentar forjar integridade interna sem backend
    logs[1].after_json = JSON.stringify({ runOrder: 2, value: 9999 }); // adulteração
    for (let i = 1; i < logs.length; i++) {
      logs[i].previous_hash = logs[i - 1].current_hash;
      logs[i].current_hash = computeAuditLogHash({
        previousHash: logs[i].previous_hash!,
        id: logs[i].id,
        validationId: logs[i].validation_id,
        entity: logs[i].entity,
        action: logs[i].action,
        actor: logs[i].actor,
        beforeJson: logs[i].before_json,
        afterJson: logs[i].after_json,
        reason: logs[i].reason,
        timestamp: logs[i].timestamp,
      });
    }

    // A cadeia agora é internamente consistente
    const internalCheck = verifyAuditChain(logs);
    expect(internalCheck.isValid).toBe(true);

    // Porém, ao comparar com o hash âncora guardado externamente pelo usuário, a fraude é exposta:
    const anchorCheck = verifyAuditChainWithAnchor(logs, anchor);
    expect(anchorCheck.isValid).toBe(true);
    expect(anchorCheck.anchorMatches).toBe(false);
    expect(anchorCheck.divergenceReason).toContain('Hash âncora divergente');
  });
});
