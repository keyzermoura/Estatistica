/**
 * Módulo de Integridade e Trilha de Auditoria com Encadeamento de Hash (Hash-Chaining).
 *
 * Implementa SHA-256 determinístico síncrono (FIPS PUB 180-4) e encadeamento
 * de blocos criptográficos para integridade com detecção de alteração acidental,
 * sem controle de acesso nem identidade verificada.
 *
 * NOTA DE CONFORMIDADE REGULATÓRIA (21 CFR Part 11):
 * Esta aplicação local-first oferece detecção de corrupção ou alteração acidental de dados.
 * Não atende integralmente ao FDA 21 CFR Part 11 por operar em cliente isolado (IndexedDB), faltando:
 *  1. Identificação única de usuário com autenticação (credencial verificada, MFA ou SSO);
 *  2. Controle de acesso baseado em papéis (RBAC) com bloqueio de escrita no banco de dados;
 *  3. Assinatura digital vinculada à identidade (criptografia assimétrica / certificado ICP-Brasil/PKI);
 *  4. Âncora e carimbo de tempo externo confiável (TSA independente via RFC 3161).
 *
 * Como mitigação parcial no modelo cliente, o sistema oferece:
 *  - Identificação declarada do usuário (nome e matrícula);
 *  - Exportação de manifesto de âncora externa para custódia do último hash fora do navegador.
 */

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// Constantes K do algoritmo SHA-256 (primeiros 32 bits das partes fracionárias das raízes cúbicas dos primeiros 64 primos)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/**
 * Implementação pura, determinística e síncrona do algoritmo criptográfico SHA-256 (FIPS PUB 180-4).
 * Funciona de forma idêntica em Node.js, Web Browsers e Web Workers com zero dependências.
 */
export function sha256Sync(message: string): string {
  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(message);
  const msgLen = msgBytes.length;

  // Tamanho com padding: múltiplos de 64 bytes (512 bits)
  // [msg] + 0x80 + zeros + 64-bit length in bits
  const bitLen = msgLen * 8;
  const paddingLen = ((56 - ((msgLen + 1) % 64)) + 64) % 64;
  const totalLen = msgLen + 1 + paddingLen + 8;

  const buffer = new Uint8Array(totalLen);
  buffer.set(msgBytes, 0);
  buffer[msgLen] = 0x80;

  // Comprimento em bits como inteiro de 64 bits big-endian
  const view = new DataView(buffer.buffer);
  // Alta ordem (32 bits superiores)
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  // Baixa ordem (32 bits inferiores)
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  // Valores iniciais de hash H_0 a H_7
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const hex = [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');

  return hex;
}

export interface AuditEntryFields {
  previousHash: string;
  id: string;
  validationId: string;
  entity: string;
  action: string;
  actor: string;
  beforeJson: string | null;
  afterJson: string | null;
  reason: string;
  timestamp: string;
}

/**
 * Calcula o hash SHA-256 encadeado de uma entrada de auditoria.
 * Inclui o previousHash para formar a corrente imutável.
 */
export function computeAuditLogHash(entry: AuditEntryFields): string {
  const payload = [
    entry.previousHash || GENESIS_HASH,
    entry.id,
    entry.validationId,
    entry.entity,
    entry.action,
    entry.actor || '',
    entry.beforeJson || '',
    entry.afterJson || '',
    entry.reason || '',
    entry.timestamp,
  ].join('|');

  return sha256Sync(payload);
}

export interface StoredAuditRow {
  id: string;
  validation_id: string;
  entity: string;
  action: string;
  actor: string;
  before_json: string | null;
  after_json: string | null;
  reason: string;
  timestamp: string;
  previous_hash?: string | null;
  current_hash?: string | null;
}

export interface AuditVerificationResult {
  isValid: boolean;
  totalLogs: number;
  verifiedLogs: number;
  tamperedLogId: string | null;
  tamperedReason: string | null;
  latestHash: string | null;
}

/**
 * Verifica a integridade completa da trilha de auditoria para um conjunto ordenado de logs.
 * Valida tanto o hash intrínseco de cada registro quanto a continuidade da cadeia anterior.
 */
export function verifyAuditChain(logs: StoredAuditRow[]): AuditVerificationResult {
  if (logs.length === 0) {
    return {
      isValid: true,
      totalLogs: 0,
      verifiedLogs: 0,
      tamperedLogId: null,
      tamperedReason: null,
      latestHash: null,
    };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const prevHash = log.previous_hash || GENESIS_HASH;

    // 1. Verifica continuidade da cadeia
    if (prevHash !== expectedPrevHash) {
      return {
        isValid: false,
        totalLogs: logs.length,
        verifiedLogs: i,
        tamperedLogId: log.id,
        tamperedReason: `Quebra de elo na cadeia: o registro #${i + 1} referencia previous_hash="${prevHash}", mas o esperado era "${expectedPrevHash}".`,
        latestHash: null,
      };
    }

    // 2. Recalcula o hash intrínseco
    const calculated = computeAuditLogHash({
      previousHash: prevHash,
      id: log.id,
      validationId: log.validation_id,
      entity: log.entity,
      action: log.action,
      actor: log.actor,
      beforeJson: log.before_json,
      afterJson: log.after_json,
      reason: log.reason,
      timestamp: log.timestamp,
    });

    if (log.current_hash && log.current_hash !== calculated) {
      return {
        isValid: false,
        totalLogs: logs.length,
        verifiedLogs: i,
        tamperedLogId: log.id,
        tamperedReason: `Adulteração detectada no registro #${i + 1} (${log.id}): hash gravado="${log.current_hash}", hash recalculado="${calculated}".`,
        latestHash: null,
      };
    }

    expectedPrevHash = calculated;
  }

  return {
    isValid: true,
    totalLogs: logs.length,
    verifiedLogs: logs.length,
    tamperedLogId: null,
    tamperedReason: null,
    latestHash: expectedPrevHash,
  };
}

export interface AuditAnchorManifest {
  version: '1.0';
  exportedAt: string;
  totalLogs: number;
  latestHash: string;
  genesisHash: string;
  firstLogTimestamp: string | null;
  lastLogTimestamp: string | null;
  logsChecksum: string;
  declaration: string;
}

/**
 * Exporta um manifesto com o hash âncora do estado atual da trilha de auditoria para custódia externa.
 *
 * Mitigação parcial para persistência em IndexedDB: permite que o usuário salve externamente o hash
 * final e compare futuramente para detectar recomputações maliciosas ou acidentais de toda a cadeia.
 */
export function exportAuditAnchor(logs: StoredAuditRow[]): AuditAnchorManifest {
  const verified = verifyAuditChain(logs);
  if (!verified.isValid) {
    throw new Error(
      `Não é possível exportar âncora de custódia: a trilha de auditoria contém violação (${verified.tamperedReason}).`,
    );
  }
  const hashes = logs.map((l) => l.current_hash || '').join(':');
  const logsChecksum = sha256Sync(hashes);
  const latestHash = verified.latestHash ?? GENESIS_HASH;

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    totalLogs: logs.length,
    latestHash,
    genesisHash: GENESIS_HASH,
    firstLogTimestamp: logs[0]?.timestamp ?? null,
    lastLogTimestamp: logs[logs.length - 1]?.timestamp ?? null,
    logsChecksum,
    declaration:
      'Âncora de custódia externa para trilha de auditoria (mitigação parcial de integridade declarada, sem autoridade externa de carimbo de tempo RFC 3161). Guarde este arquivo em mídia externa protegida.',
  };
}

export interface AuditAnchorVerificationResult extends AuditVerificationResult {
  anchorMatches: boolean;
  anchorExpectedHash: string;
  divergenceReason: string | null;
}

/**
 * Verifica a trilha de auditoria comparando-a contra um hash âncora exportado anteriormente.
 *
 * Garante que a cadeia não apenas é internamente consistente, mas também coincide com o hash
 * de custódia externa previamente registrado, detectando substituições completas do banco IndexedDB.
 */
export function verifyAuditChainWithAnchor(
  logs: StoredAuditRow[],
  anchorManifestOrHash: string | AuditAnchorManifest,
): AuditAnchorVerificationResult {
  const chainResult = verifyAuditChain(logs);
  const expectedHash =
    typeof anchorManifestOrHash === 'string'
      ? anchorManifestOrHash.trim()
      : anchorManifestOrHash.latestHash.trim();

  if (!chainResult.isValid) {
    return {
      ...chainResult,
      anchorMatches: false,
      anchorExpectedHash: expectedHash,
      divergenceReason: `Cadeia internamente adulterada: ${chainResult.tamperedReason}`,
    };
  }

  const currentLatest = chainResult.latestHash ?? GENESIS_HASH;
  if (currentLatest === expectedHash) {
    return {
      ...chainResult,
      anchorMatches: true,
      anchorExpectedHash: expectedHash,
      divergenceReason: null,
    };
  }

  // Verifica se o hash âncora corresponde a um ponto histórico íntegro da cadeia
  const historicalIndex = logs.findIndex((l) => l.current_hash === expectedHash);
  if (historicalIndex !== -1) {
    return {
      ...chainResult,
      anchorMatches: true,
      anchorExpectedHash: expectedHash,
      divergenceReason: null,
    };
  }

  return {
    ...chainResult,
    anchorMatches: false,
    anchorExpectedHash: expectedHash,
    divergenceReason: `Hash âncora divergente: esperado "${expectedHash}", mas o hash mais recente é "${currentLatest}" e o valor não existe no histórico verificado.`,
  };
}
