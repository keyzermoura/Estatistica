import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from './ui';

const TERMS = [
  {
    term: 'Exatidão',
    group: 'Metrologia',
    text: 'Grau de concordância entre o resultado de uma medição e um valor de referência aceito. Inclui tendência e precisão; é avaliada por recuperação, MRC ou comparação interlaboratorial.',
  },
  {
    term: 'Tendência (bias)',
    group: 'Metrologia',
    text: 'Diferença entre a média dos resultados e o valor de referência. O teste t pareado verifica se a tendência é estatisticamente significativa; o TOST verifica se ela é pequena o bastante para equivalência.',
  },
  {
    term: 'Precisão',
    group: 'Metrologia',
    text: 'Grau de concordância entre resultados independentes. Desdobra-se em repetibilidade, precisão intermediária e reprodutibilidade.',
  },
  {
    term: 'Repetibilidade',
    group: 'Precisão',
    text: 'Precisão obtida com o mesmo método, mesmo laboratório, mesmo analista e mesmo equipamento, em curto intervalo de tempo.',
  },
  {
    term: 'Precisão intermediária',
    group: 'Precisão',
    text: 'Precisão dentro do mesmo laboratório, variando fatores como analista, dia, equipamento ou lote. Também chamada de precisão intermediária ou robustez intermediária.',
  },
  {
    term: 'Reprodutibilidade',
    group: 'Precisão',
    text: 'Precisão entre laboratórios diferentes, geralmente avaliada por ensaio interlaboratorial conforme ISO 5725-2.',
  },
  {
    term: 's_r, s_L, s_R',
    group: 'ISO 5725',
    text: 's_r = desvio-padrão de repetibilidade; s_L = desvio-padrão entre laboratórios; s_R = desvio-padrão de reprodutibilidade = √(s_r² + s_L²).',
  },
  {
    term: 'r e R',
    group: 'ISO 5725',
    text: 'Limites de repetibilidade e reprodutibilidade: r = 2,8·s_r e R = 2,8·s_R. Dois resultados no mesmo laboratório diferindo mais que r são suspeitos; entre laboratórios, mais que R.',
  },
  {
    term: 'Linearidade',
    group: 'Calibração',
    text: 'Capacidade de o método produzir resposta proporcional à concentração dentro da faixa. Avaliada por regressão, R², resíduos e teste de falta de ajuste.',
  },
  {
    term: 'LD e LQ',
    group: 'Calibração',
    text: 'Limite de detecção (menor quantidade detectável com confiança) e limite de quantificação (menor quantidade quantificável com precisão e exatidão aceitáveis).',
  },
  {
    term: 'Falta de ajuste',
    group: 'Estatística',
    text: 'Teste que compara o desvio da reta com a variabilidade pura entre réplicas no mesmo nível. Se significativo, um modelo não linear pode ser mais adequado.',
  },
  {
    term: 'Shapiro-Wilk',
    group: 'Normalidade',
    text: 'Teste de normalidade sensível em amostras pequenas. A hipótese nula é que os dados vêm de uma distribuição normal; p < α indica desvio significativo.',
  },
  {
    term: 'Levene / Bartlett',
    group: 'Homogeneidade',
    text: 'Testes de igualdade de variâncias. Levene é robusto à não normalidade; Bartlett é mais potente quando os dados são normais, mas sensível a desvios.',
  },
  {
    term: 'ANOVA',
    group: 'Estatística',
    text: 'Análise de variância: decompõe a variabilidade total em fontes (fatores e erro) e testa se as médias diferem. Também fornece componentes de variância.',
  },
  {
    term: 'Componentes de variância',
    group: 'Estatística',
    text: 'Parcelas da variabilidade atribuídas a cada fonte aleatória (analista, dia, equipamento, interação, repetibilidade). Alimentam a incerteza e a precisão intermediária.',
  },
  {
    term: 'GUM',
    group: 'Incerteza',
    text: 'Guia para a Expressão da Incerteza de Medição. Combina incertezas padrão em quadratura e usa Welch-Satterthwaite para os graus de liberdade efetivos.',
  },
  {
    term: 'u_c, U, k',
    group: 'Incerteza',
    text: 'u_c = incerteza padrão combinada; U = incerteza expandida; k = fator de abrangência (2 para ~95% ou t de Student com ν_eff).',
  },
  {
    term: 'Tipo A e Tipo B',
    group: 'Incerteza',
    text: 'Tipo A: avaliada por repetição (estatística). Tipo B: avaliada por certificados, especificações, experiência ou distribuições assumidas.',
  },
  {
    term: 'TOST',
    group: 'Equivalência',
    text: 'Two One-Sided Tests: demonstra que a diferença está dentro de uma margem clinicamente/metrologicamente aceitável, com duas hipóteses unilaterais.',
  },
  {
    term: 'z-score e En',
    group: 'Proficiência',
    text: 'z = (x − x_ref)/σ_pt mede desvio em relação à dispersão do ensaio. En = (x − x_ref)/√(u_lab² + u_ref²) incorpora as incertezas; |En| ≤ 1 é satisfatório.',
  },
  {
    term: 'Poder estatístico',
    group: 'Delineamento',
    text: 'Probabilidade de detectar um efeito de tamanho especificado quando ele realmente existe. Poder = 1 − β; 80% é uma convenção comum.',
  },
  {
    term: 'σ e efeito mínimo detectável',
    group: 'Delineamento',
    text: 'σ é o desvio-padrão esperado do processo; o efeito é a menor diferença que se deseja detectar. Ambos determinam o n e precisam estar registrados como suposições.',
  },
  {
    term: 'Aleatorização',
    group: 'Delineamento',
    text: 'Ordem de execução gerada por PRNG determinístico com semente registrada. A mesma semente reproduz a mesma sequência, permitindo auditoria.',
  },
  {
    term: 'Adequação ao uso',
    group: 'Conclusão',
    text: 'Julgamento de que o método, nas condições descritas, atende aos requisitos para a finalidade pretendida. Depende dos critérios de aceitação cadastrados.',
  },
];

const GROUPS = [...new Set(TERMS.map((t) => t.group))];

export function Glossary() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('Todos');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TERMS.filter(
      (t) =>
        (group === 'Todos' || t.group === group) &&
        (!q || t.term.toLowerCase().includes(q) || t.text.toLowerCase().includes(q)),
    );
  }, [query, group]);
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar termo…" className="pl-9" />
        </div>
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="h-10 rounded-xl border border-ink-300 bg-white px-3 text-sm dark:border-ink-700 dark:bg-ink-900"
        >
          <option>Todos</option>
          {GROUPS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>
      <div className="mt-4 space-y-3">
        {filtered.map((term) => (
          <div key={term.term} className="rounded-xl border border-ink-200 p-3.5 dark:border-ink-800">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-ink-900 dark:text-white">{term.term}</h4>
              <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                {term.group}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-600 dark:text-ink-300">{term.text}</p>
          </div>
        ))}
        {filtered.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">Nenhum termo encontrado.</p> : null}
      </div>
    </div>
  );
}
