# ValidaMétodo

Sistema web **offline-first** para validação de métodos analíticos. Combina um
fluxo guiado de sete etapas, delineamento amostral estatístico, análise
auditável, orçamento de incerteza (GUM) e relatório exportável em DOCX, PDF e
pacote de evidências.

O princípio central: **nenhum resultado é declarado conforme sem dado numérico
e critério de aceitação cadastrado**. Quando falta um dos dois, o veredito é
**não avaliado**. Nenhum outlier é removido automaticamente.

## Recursos

- Painel de validações com status, progresso, medições e versionamento.
- Fluxo em 7 etapas: método, parâmetros, delineamento, coleta, análise,
  relatório e auditoria.
- Delineamento com poder estatístico, tamanho de amostra por parâmetro,
  aleatorização reproduzível (semente registrada) e plano de execução.
- Análise com fórmula, valor, critério e veredito em cada métrica.
- Estatística descritiva, normalidade, homogeneidade, ANOVA, ISO 5725-2,
  regressão/linearidade, LD/LQ, tendência/recuperação/TOST, robustez e GUM.
- Coleta manual, importação de XLSX/CSV e exportação de dados.
- Relatório com hash SHA-256, três assinaturas eletrônicas e bloqueio após a
  aprovação.
- Snapshots imutáveis por versão; nova versão reabre a edição preservando o
  histórico.
- Persistência local em SQLite (WebAssembly) sobre IndexedDB, sem backend.

## Stack

| Camada | Tecnologia |
|---|---|
| Interface | React 18 + TypeScript + Vite |
| Estilos | Tailwind CSS |
| Gráficos | Recharts |
| Persistência | SQLite compilado para WebAssembly (`sql.js`) + IndexedDB |
| Exportação | DOCX (`docx`), PDF (`jspdf`), XLSX (`xlsx`), ZIP (`jszip`) |
| Testes | Vitest |
| Estatística | Motor próprio em TypeScript, sem biblioteca externa |

## Requisitos

- Node.js 18 ou superior (recomendado: 20 LTS)
- Navegador moderno com JavaScript habilitado (Chrome, Edge ou Firefox)

## Instalação

```bash
npm install
npm run dev
```

O Vite abre o sistema em `http://localhost:5173`.

Para instalar, verificar tipos, rodar os testes e gerar o build em um único
comando:

```bash
npm run setup
```

> **Windows/PowerShell:** se `npm.ps1` estiver bloqueado pela política de
> execução, use `npm.cmd run setup`, `cmd /c npm run dev` ou ajuste a política
> do PowerShell.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com recarga |
| `npm run setup` | Instala dependências, verifica tipos, testa e gera o build |
| `npm run typecheck` | Verificação de tipos (`tsc -b`) |
| `npm test` | Testes de referência do núcleo estatístico |
| `npm run test:watch` | Testes em modo observação |
| `npm run build` | Verificação de tipos + build de produção em `dist/` |
| `npm run preview` | Serve o build de produção localmente |
| `npm start` | Inicia o servidor de desenvolvimento e abre o navegador |

## Fluxo de uso

```
Painel → Nova validação → 7 etapas → Relatório → Assinaturas → Aprovação
         1 Método
         2 Parâmetros
         3 Delineamento
         4 Coleta
         5 Análise
         6 Relatório
         7 Auditoria
```

1. **Método**: identificação, faixa, referências normativas e critérios de
   aceitação.
2. **Parâmetros**: seleção do checklist, justificativas e critérios
   específicos.
3. **Delineamento**: premissas estatísticas, n por parâmetro, poder, plano e
   ordem aleatorizada.
4. **Coleta**: formulário, importação de planilha e verificações automáticas.
5. **Análise**: resultados por parâmetro e orçamento de incerteza.
6. **Relatório**: prévia, configuração, assinaturas e exportações.
7. **Auditoria**: trilha de eventos, snapshots, aprovação, bloqueio e nova
   versão.

## Motor estatístico

O motor é implementado em **TypeScript próprio** em `src/stats/`, sem
dependência de runtime como SciPy, R, jStat ou similar. As distribuições
(normal, t, χ², F e não centrais), as inversas e os testes são calculados
localmente para garantir reprodutibilidade e funcionamento offline.

| Arquivo | Conteúdo |
|---|---|
| `distributions.ts` | funções gama/beta, normal, t, χ², F, não centrais e inversas |
| `descriptive.ts` | média, variância, quantis, IC, assimetria, curtose |
| `sampleSize.ts` | poder e tamanho de amostra (t, TOST, razão de variâncias, ANOVA) |
| `design.ts` | planos de execução, aleatorização e curva de poder |
| `outliers.ts` | Grubbs, Cochran, Hampel |
| `normality.ts` | Shapiro–Wilk, Anderson–Darling, Jarque–Bera |
| `variance.ts` | F, Bartlett, Levene/Brown–Forsythe |
| `anova.ts` | ANOVA de um e dois fatores, Welch, componentes de variância |
| `iso5725.ts` | precisão por ISO 5725-2, Mandel h/k |
| `regression.ts` | OLS, WLS, falta de ajuste, LD/LQ |
| `bias.ts` | tendência, recuperação, TOST, proficiência, tolerância |
| `uncertainty.ts` | GUM, Welch–Satterthwaite, incerteza expandida |
| `analysis.ts` | orquestração genérica dos parâmetros e vereditos |

O catálogo de parâmetros, critérios sugeridos, pressupostos e templates do
perfil analítico fica em `src/profiles/analytical.ts`. `analysis.ts` consulta o
perfil ativo, de modo que as próximas famílias de métodos possam ser acrescentadas
sem duplicar o catálogo analítico.

Os testes em `src/stats/__tests__/stats.test.ts` comparam os resultados com
valores de `scipy`, `R` e publicações de referência. A catalogação completa das
fórmulas está em [`docs/FORMULAS.md`](docs/FORMULAS.md).

## Dados, privacidade e backup

- O banco é um SQLite real compilado para WebAssembly e persistido no
  **IndexedDB do navegador**. Nenhum dado é enviado a um servidor.
- O sistema funciona offline depois de carregado.
- `localhost` e `127.0.0.1` são origens diferentes: cada uma tem seu próprio
  banco.
- Limpar os dados do site, trocar de navegador ou de perfil remove o acesso ao
  banco local. Exporte backups em **Configurações → Dados**.
- É possível exportar o arquivo `.sqlite` e abri-lo em DB Browser for SQLite,
  DBeaver ou outra ferramenta SQLite.
- O pacote de evidências (ZIP) inclui dados, resultados, relatório, snapshot e
  manifesto com hashes.

## Exportações

| Formato | Conteúdo |
|---|---|
| DOCX | Relatório completo com tabelas, gráficos e assinaturas |
| PDF | Prévia paginada com cabeçalho, rodapé e numeração |
| Pacote de evidências (ZIP) | Dados, resultados JSON, relatório, snapshot e manifesto |
| HTML | Prévia autônoma |
| Resultados JSON | Métricas e resultados estruturados |
| Dados XLSX | Medições e plano de execução |

## Estrutura do projeto

```
src/
  components/       componentes de UI, layout, wizard, gráficos e prévia
  lib/              banco, repositório, tipos, critérios, relatório, exportação
  pages/            painel, configurações, wizard e etapas
  stats/            motor estatístico próprio e testes de referência
docs/
  ARQUITETURA.md    arquitetura, modelo de dados e decisões
  FORMULAS.md       catálogo de fórmulas, referências e valores de teste
  GUIA_USUARIO.md   guia para usuários sem formação estatística
scripts/
  setup.mjs         instalação + verificação + testes + build
```

## Decisões e limitações

- **Confiança** padrão 95%, **poder** 80%, **α** 5% bilateral. Os valores são
  editáveis no delineamento.
- **σ esperado** usa dado piloto; se ausente, `faixa/6`. A suposição aparece no
  relatório.
- **Normalidade**: Shapiro–Wilk é o teste principal; rejeições geram alerta, sem
  bloquear automaticamente a análise.
- **Homogeneidade**: Levene é o teste de decisão; Bartlett é informativo.
- **Outliers**: apenas sinalizados. A exclusão exige justificativa registrada.
- **Seletividade**: não há cálculo automático; exige experimento e evidência
  registrada. Permanece “não avaliado” até haver critério e dado.
- **Assinaturas**: são eletrônicas simples (nome, papel, instante e hash), não
  certificado digital ICP-Brasil.
- **Uso**: aplicação local/monousuário; não há autenticação, servidor central
  nem sincronização entre dispositivos.
- **Aprovação**: congela o relatório e a validação; qualquer alteração posterior
  exige **Criar nova versão** com justificativa.

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Fórmulas e decisões estatísticas](docs/FORMULAS.md)
- [Guia do usuário](docs/GUIA_USUARIO.md)

## Aviso

O sistema apoia o processo de validação e organiza a evidência estatística, mas
não substitui a avaliação técnica do responsável, os requisitos da norma
aplicável nem a revisão independente do laboratório. Os critérios de aceitação
são decisões do laboratório e devem ser definidos e justificados antes da
análise dos resultados.
