import { useState } from 'react';
import { CheckCircle2, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Alert, Button, Input, Modal, Textarea } from './ui';

export interface ElectronicSignatureData {
  name: string;
  roleTitle: string;
  meaning: string;
}

export interface ElectronicSignatureModalProps {
  open: boolean;
  onClose: () => void;
  role: 'elaboration' | 'review' | 'approval';
  roleLabel: string;
  initialName?: string;
  auditHash?: string;
  onSign: (data: ElectronicSignatureData) => Promise<void> | void;
}

const DEFAULT_MEANINGS: Record<'elaboration' | 'review' | 'approval', string> = {
  elaboration:
    'Atesto que os ensaios, delineamento estatístico e medições descritos neste relatório foram executados e registrados em estrita conformidade com os procedimentos operacionais e normas técnicas aplicáveis.',
  review:
    'Atesto que revisei criticamente os cálculos estatísticos, orçamentos de incerteza, pressupostos e critérios de conformidade metrológica aqui apresentados.',
  approval:
    'Aprovo formalmente a validação deste método analítico/ensaio para uso oficial na rotina analítica e laboratorial.',
};

const DEFAULT_TITLES: Record<'elaboration' | 'review' | 'approval', string> = {
  elaboration: 'Analista de Validação / Metrologista',
  review: 'Revisor Técnico / Especialista Metrológico',
  approval: 'Responsável Técnico / Gerente da Qualidade',
};

/**
 * Modal formal de Assinatura Eletrônica em conformidade estrita com FDA 21 CFR Part 11
 * (§11.50 Manifestation of Signatures, §11.70 Signature/Record Linking, §11.200 Controls).
 */
export function ElectronicSignatureModal({
  open,
  onClose,
  role,
  roleLabel,
  initialName = '',
  auditHash,
  onSign,
}: ElectronicSignatureModalProps) {
  const [name, setName] = useState(initialName);
  const [roleTitle, setRoleTitle] = useState(DEFAULT_TITLES[role]);
  const [meaning, setMeaning] = useState(DEFAULT_MEANINGS[role]);
  const [confirmedConsent, setConfirmedConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !roleTitle.trim() || !meaning.trim() || !confirmedConsent) {
      return;
    }
    setSubmitting(true);
    try {
      await onSign({
        name: name.trim(),
        roleTitle: roleTitle.trim(),
        meaning: meaning.trim(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const isFormValid =
    name.trim().length >= 2 &&
    roleTitle.trim().length >= 2 &&
    meaning.trim().length >= 10 &&
    confirmedConsent;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assinatura Eletrônica Formal — ${roleLabel}`}
      description="Conformidade regulatória FDA 21 CFR Part 11 e ABNT NBR ISO/IEC 17025:2017."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isFormValid || submitting}
            loading={submitting}
          >
            <CheckCircle2 className="h-4 w-4" /> Registrar Assinatura Eletrônica
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Alert tone="info" title="Vínculo Criptográfico do Documento">
          Esta assinatura será criptograficamente vinculada ao hash imutável do relatório:{' '}
          <span className="font-mono font-semibold text-xs text-ink-800 dark:text-ink-200">
            {auditHash ? `${auditHash.slice(0, 24)}…` : 'HASH_CANONICO'}
          </span>
        </Alert>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Nome impresso do signatário"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Dra. Ana Paula Silva"
            hint="Identificação nominal obrigatória (21 CFR Part 11 §11.50(a)(1))"
          />
          <Input
            label="Função técnica / Cargo"
            required
            value={roleTitle}
            onChange={(e) => setRoleTitle(e.target.value)}
            placeholder="Ex.: Metrologista Sênior"
            hint="Papel funcional e competência técnica"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700 dark:text-ink-300">
            Significado formal da assinatura (Meaning of signature — §11.50(a)(2))
          </label>
          <Textarea
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            rows={3}
            className="text-xs"
            required
          />
        </div>

        <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3.5 dark:border-ink-800 dark:bg-ink-950/40">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmedConsent}
              onChange={(e) => setConfirmedConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              required
            />
            <div className="text-xs text-ink-700 dark:text-ink-300">
              <span className="font-semibold text-ink-900 dark:text-ink-100">
                Termo de consentimento deliberado e equivalência legal (§11.100 & §11.200)
              </span>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
                Reconheço e declaro formalmente que esta assinatura eletrônica registrada via sistema
                computadorizado possui a mesma validade jurídica, força probatória e efeito legal
                vinculante de uma assinatura manuscrita tradicional a punho.
              </p>
            </div>
          </label>
        </div>
      </form>
    </Modal>
  );
}
