import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Copy,
  FlaskConical,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import { useApp } from '../lib/app-context';
import {
  createValidation,
  deleteValidation,
  duplicateValidation,
  getValidationSummaries,
  listMethods,
  saveMethod,
} from '../lib/repository';
import type { Method, MethodFamily, MethodType, ValidationType } from '../lib/types';
import {
  METHOD_FAMILY_LABELS,
  METHOD_TYPE_LABELS,
  STATUS_LABELS,
  VALIDATION_TYPE_LABELS,
} from '../lib/types';
import { formatDate, uid } from '../lib/utils';
import { getProfileForFamily } from '../profiles/index';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  Progress,
  Select,
  Stat,
  Tabs,
  Textarea,
  useToast,
} from '../components/ui';

const statusTone = {
  draft: 'neutral',
  in_progress: 'info',
  in_review: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const;

export function Dashboard() {
  const { refreshKey, dataVersion, bumpRefresh } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState(() => getValidationSummaries());
  const [methods, setMethods] = useState<Method[]>(() => listMethods());
  const [newOpen, setNewOpen] = useState(false);
  const [tab, setTab] = useState<'existing' | 'new'>('existing');
  const [selectedMethod, setSelectedMethod] = useState('');
  const [title, setTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'quantitative' as MethodType,
    family: 'analytical' as MethodFamily,
    unit: '',
    rangeMin: '',
    rangeMax: '',
    lsl: '',
    usl: '',
    resolution: '',
    measurand: '',
    toleranceUnit: '',
    equipment: '',
    referenceNorm: '',
    validationType: 'full' as ValidationType,
    description: '',
  });

  const reload = () => {
    setItems(getValidationSummaries());
    setMethods(listMethods());
  };

  useEffect(() => {
    reload();
  }, [refreshKey, dataVersion]);

  useEffect(() => {
    const handler = () => {
      reload();
      setNewOpen(true);
    };
    window.addEventListener('open-new-validation', handler);
    return () => window.removeEventListener('open-new-validation', handler);
  }, []);

  useEffect(() => {
    if (!selectedMethod && methods.length) setSelectedMethod(methods[0].id);
  }, [methods, selectedMethod]);

  const createFromExisting = () => {
    if (!selectedMethod) {
      toast.push('Selecione um método.', 'danger');
      return;
    }
    try {
      const validation = createValidation(selectedMethod, title);
      toast.push('Validação criada.');
      setNewOpen(false);
      bumpRefresh();
      navigate(`/validation/${validation.id}`);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao criar validação.', 'danger');
    }
  };

  const createFromNewMethod = () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.push('Informe código e nome do método.', 'danger');
      return;
    }
    try {
      const id = uid('method');
      const now = new Date().toISOString();
      const profile = getProfileForFamily(form.family);
      const method: Method = {
        id,
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        family: form.family,
        unit: form.unit.trim(),
        rangeMin: form.rangeMin ? Number(form.rangeMin) : null,
        rangeMax: form.rangeMax ? Number(form.rangeMax) : null,
        lsl: form.lsl ? Number(form.lsl) : null,
        usl: form.usl ? Number(form.usl) : null,
        resolution: form.resolution ? Number(form.resolution) : null,
        measurand: form.measurand.trim(),
        toleranceUnit: form.toleranceUnit.trim(),
        equipment: form.equipment.trim(),
        referenceNorm: form.referenceNorm.trim(),
        validationType: form.validationType,
        description: form.description.trim(),
        criteria: profile.defaultMethodCriteria.map((criterion) => ({ ...criterion })),
        createdAt: now,
        updatedAt: now,
      };
      saveMethod(method);
      const validation = createValidation(id, title);
      toast.push('Método e validação criados.');
      setNewOpen(false);
      bumpRefresh();
      navigate(`/validation/${validation.id}`);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Falha ao criar método.', 'danger');
    }
  };

  const totals = useMemo(
    () => ({
      total: items.length,
      approved: items.filter((i) => i.validation.status === 'approved').length,
      active: items.filter((i) => ['draft', 'in_progress', 'in_review'].includes(i.validation.status)).length,
      measurements: items.reduce((acc, i) => acc + i.measurementCount, 0),
    }),
    [items],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">Visão geral</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">
            Validações em andamento
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-500 dark:text-ink-400">
            Cada processo combina delineamento estatístico, dados brutos, análise auditável, orçamento de incerteza e relatório exportável.
          </p>
        </div>
        <Button onClick={() => { reload(); setNewOpen(true); }}>
          <Plus className="h-4 w-4" />
          Nova validação
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Processos" value={totals.total} hint="todas as validações" icon={<FlaskConical className="h-5 w-5" />} />
        <Stat label="Em andamento" value={totals.active} hint="rascunho, execução ou revisão" icon={<ClipboardList className="h-5 w-5" />} tone="warning" />
        <Stat label="Aprovadas" value={totals.approved} hint="bloqueadas e versionadas" icon={<CheckCircle2 className="h-5 w-5" />} tone="success" />
        <Stat label="Medições" value={totals.measurements.toLocaleString('pt-BR')} hint="registros numéricos e textuais" icon={<Lock className="h-5 w-5" />} tone="neutral" />
      </div>

      {items.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<FlaskConical className="h-10 w-10" />}
              title="Nenhuma validação cadastrada"
              description="Cadastre um método e inicie o fluxo guiado. O sistema sugere parâmetros, calcula o n e conduz a análise estatística."
              action={
                <Button onClick={() => setNewOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Criar primeira validação
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Processos de validação"
            description={`${items.length} registro(s) local(is) · dados persistidos em SQLite no navegador`}
            icon={<FlaskConical className="h-4 w-4" />}
          />
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Método</th>
                  <th>Validação</th>
                  <th>Status</th>
                  <th>Progresso</th>
                  <th>Dados</th>
                  <th>Atualizado</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ validation, method, parameterCount, measurementCount, progress }) => (
                  <tr key={validation.id}>
                    <td>
                      <p className="font-mono text-xs font-semibold text-brand-700 dark:text-brand-300">{method.code || '—'}</p>
                      <p className="max-w-[220px] truncate text-sm font-medium text-ink-800 dark:text-ink-100">{method.name}</p>
                      <p className="text-[11px] text-ink-400">{METHOD_TYPE_LABELS[method.type]}</p>
                    </td>
                    <td>
                      <Link to={`/validation/${validation.id}`} className="font-medium text-ink-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-300">
                        {validation.title}
                      </Link>
                      <p className="text-[11px] text-ink-400">v{validation.version} · {parameterCount} parâmetro(s)</p>
                    </td>
                    <td>
                      <Badge tone={statusTone[validation.status]}>{STATUS_LABELS[validation.status]}</Badge>
                      {validation.locked ? <Badge tone="neutral" className="ml-1">bloqueada</Badge> : null}
                    </td>
                    <td className="min-w-[130px]">
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="w-20" tone={validation.status === 'approved' ? 'success' : 'brand'} />
                        <span className="text-xs text-ink-500">{progress}%</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-xs text-ink-500">
                      {measurementCount} medição(ões)
                    </td>
                    <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(validation.updatedAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/validation/${validation.id}`)}>
                          Abrir <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Duplicar"
                          onClick={() => {
                            try {
                              const copy = duplicateValidation(validation.id);
                              toast.push('Validação duplicada.');
                              bumpRefresh();
                              navigate(`/validation/${copy.id}`);
                            } catch (error) {
                              toast.push(error instanceof Error ? error.message : 'Falha ao duplicar.', 'danger');
                            }
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Excluir" onClick={() => setConfirmDelete(validation.id)}>
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Como o sistema decide" icon={<CheckCircle2 className="h-4 w-4" />} />
          <CardBody className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
            <p>
              Nenhum resultado é apresentado como conforme sem um <strong>critério de aceitação</strong> cadastrado. Quando não há dado ou critério, o veredito é explicitamente “não avaliado”.
            </p>
            <p>
              O delineamento registra σ, efeito mínimo, confiança, poder e semente de aleatorização. A análise registra os valores congelados e a incerteza segue o GUM. O relatório carrega um hash de auditoria.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge tone="brand">ISO/IEC 17025</Badge>
              <Badge tone="brand">ISO 5725</Badge>
              <Badge tone="brand">GUM</Badge>
              <Badge tone="brand">ICH Q2(R2)</Badge>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Atalhos" />
          <CardBody className="space-y-2">
            <a href="#/settings" className="block rounded-xl border border-ink-200 p-3 text-sm hover:border-brand-400 hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-brand-950/20">
              <span className="font-medium text-ink-900 dark:text-white">Configurar laboratório</span>
              <span className="mt-0.5 block text-xs text-ink-500">Nome, logo, responsáveis e referências do relatório.</span>
            </a>
            <div className="rounded-xl border border-ink-200 p-3 text-sm dark:border-ink-800">
              <span className="font-medium text-ink-900 dark:text-white">Exportar banco SQLite</span>
              <span className="mt-0.5 block text-xs text-ink-500">Use Configurações → Dados para baixar o arquivo .sqlite ou importar um backup.</span>
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Nova validação"
        description="Escolha um método já cadastrado ou defina um novo método."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancelar</Button>
            {tab === 'existing' ? (
              <Button onClick={createFromExisting}>Criar validação</Button>
            ) : (
              <Button onClick={createFromNewMethod}>Criar método e validação</Button>
            )}
          </>
        }
      >
        <Tabs
          items={[
            { id: 'existing', label: `Método existente (${methods.length})` },
            { id: 'new', label: 'Novo método' },
          ]}
          value={tab}
          onChange={(id) => setTab(id as 'existing' | 'new')}
        />
        {tab === 'existing' ? (
          <div className="mt-4 space-y-3">
            {methods.length === 0 ? (
              <Alert tone="warning">Nenhum método cadastrado. Use a aba “Novo método”.</Alert>
            ) : (
              <Select label="Método" value={selectedMethod} onChange={(e) => setSelectedMethod(e.target.value)}>
                {methods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.code} — {method.name} ({METHOD_TYPE_LABELS[method.type]})
                  </option>
                ))}
              </Select>
            )}
            <Input
              label="Título da validação"
              placeholder="Ex.: Validação do método HPLC-CAF-01 — 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              hint="Se vazio, o sistema cria um título automático."
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input label="Código" required placeholder="Ex.: HPLC-CAF-01" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input label="Unidade" placeholder="Ex.: mg/L" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            <Input label="Nome do método" required className="sm:col-span-2" placeholder="Ex.: Cafeína em bebidas por HPLC-UV" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select label="Tipo" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as MethodType })}>
              {Object.entries(METHOD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <Select label="Família de ensaio" value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value as MethodFamily })}>
              {Object.entries(METHOD_FAMILY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <Select label="Tipo de validação" value={form.validationType} onChange={(e) => setForm({ ...form, validationType: e.target.value as ValidationType })}>
              {Object.entries(VALIDATION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <Input label="Faixa mínima" type="number" step="any" value={form.rangeMin} onChange={(e) => setForm({ ...form, rangeMin: e.target.value })} />
            <Input label="Faixa máxima" type="number" step="any" value={form.rangeMax} onChange={(e) => setForm({ ...form, rangeMax: e.target.value })} />
            <Input label="LSL (limite inferior)" type="number" step="any" value={form.lsl} onChange={(e) => setForm({ ...form, lsl: e.target.value })} />
            <Input label="USL (limite superior)" type="number" step="any" value={form.usl} onChange={(e) => setForm({ ...form, usl: e.target.value })} />
            <Input label="Resolução" type="number" step="any" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} />
            <Input label="Mensurando" value={form.measurand} onChange={(e) => setForm({ ...form, measurand: e.target.value })} />
            <Input label="Unidade da tolerância" value={form.toleranceUnit} onChange={(e) => setForm({ ...form, toleranceUnit: e.target.value })} />
            <Input label="Equipamento" className="sm:col-span-2" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} />
            <Input label="Norma / referência" className="sm:col-span-2" value={form.referenceNorm} onChange={(e) => setForm({ ...form, referenceNorm: e.target.value })} />
            <Textarea label="Descrição / escopo" className="sm:col-span-2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Input label="Título da validação" className="sm:col-span-2" value={title} onChange={(e) => setTitle(e.target.value)} hint="Opcional." />
          </div>
        )}
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Excluir validação"
        description="Esta ação remove dados, análises, relatórios, versões e auditoria deste processo."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!confirmDelete) return;
                deleteValidation(confirmDelete);
                setConfirmDelete(null);
                toast.push('Validação excluída.');
                bumpRefresh();
                reload();
              }}
            >
              Excluir definitivamente
            </Button>
          </>
        }
      >
        <Alert tone="danger" title="Sem possibilidade de desfazer">
          Se precisar manter históricos, exporte o banco SQLite antes de excluir.
        </Alert>
      </Modal>
    </div>
  );
}
