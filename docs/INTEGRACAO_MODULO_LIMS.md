# Integração como módulo do LIMS (Onda 4)

> **Status:** desenho aprovado para a Onda 4; **não implementado** nesta versão.
> O ValidaMétodo continua sendo uma aplicação offline-first autônoma. Este
> documento descreve como o motor de validação pode ser incorporado ao
> `keyzermoura/LIMS` sem reescrever a estatística nem duplicar o modelo de dados.

## 1. Objetivo

Permitir que o LIMS corporativo:

- crie e acompanhe validações de método vinculadas a `TestMethod`,
  `LaboratoryEquipment` e `LabTest`;
- execute o motor estatístico do ValidaMétodo de forma reproduzível;
- colete assinaturas em duas etapas e mantenha trilha de auditoria compatível
  com 21 CFR Part 11;
- bloqueie operações quando o método não estiver validado, o equipamento estiver
  fora de calibração ou houver CAPA aberta;
- mantenha o funcionamento local/offline quando a conexão com o servidor cair.

## 2. Escopo e não escopo

### Escopo

1. Migração Alembic `0007_fase4_validacao_metodos.py` no LIMS.
2. Rotas FastAPI `/api/v1/method-validations` para CRUD, análise, relatório,
   assinatura e aprovação.
3. Pacote TypeScript do motor (`@valida-metodo/engine`) consumido pelo frontend
   do LIMS ou por um worker Node.
4. Mapeamento entre entidades do LIMS e o modelo do ValidaMétodo.
5. Gates operacionais e eventos de auditoria.
6. Importação/exportação do pacote de evidências (ZIP) e do snapshot SQLite.

### Não escopo

- Substituir o banco local do ValidaMétodo por PostgreSQL nesta onda.
- Reimplementar as fórmulas estatísticas em Python.
- Assinatura digital ICP-Brasil ou certificado qualificado.
- Sincronização bidirecional automática de rascunhos entre dispositivos.

## 3. Arquitetura proposta

```text
┌──────────────────────────── LIMS (FastAPI + PostgreSQL) ────────────────────────────┐
│  Rotas /api/v1/method-validations        Serviço de validação        Auditoria      │
│  - CRUD e versionamento                  - regras de gate             - hash chain   │
│  - upload de medições                    - assinatura 2 etapas       - eventos      │
│  - relatório e pacote de evidências      - aprovação/bloqueio        - retenção     │
└───────────────────────────────────┬─────────────────────────────────────────────────┘
                                    │ HTTP/JSON + ZIP
┌───────────────────────────────────▼─────────────────────────────────────────────────┐
│  Motor ValidaMétodo (TypeScript)                                                    │
│  - @valida-metodo/engine: análise, perfis, critérios, relatório, exportação         │
│  - execução no navegador (Web Worker) ou em worker Node                             │
│  - mesma versão e mesmos testes de referência do aplicativo autônomo                │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

O LIMS é a fonte de verdade corporativa (usuários, métodos, equipamentos,
amostras e CAPA). O motor é a fonte de verdade estatística: recebe um bundle
imutável de entradas e devolve análise, relatório e hashes. O bundle inclui
`method`, `parameters`, `measurements`, `design`, `uncertainty` e
`reportConfig`; o motor não consulta o banco do LIMS diretamente.

## 4. Migração `0007_fase4_validacao_metodos.py`

Tabelas mínimas:

| Tabela | Finalidade | Campos principais |
|---|---|---|
| `method_validations` | Cabeçalho da validação | `id`, `method_id`, `lab_test_id`, `equipment_id`, `title`, `status`, `version`, `locked`, `report_config_json`, `created_at`, `updated_at` |
| `method_validation_parameters` | Parâmetros selecionados | `validation_id`, `parameter_key`, `selected`, `justification`, `criteria_json` |
| `method_validation_measurements` | Medições brutas | `validation_id`, `run_order`, `level`, `analyst`, `day`, `equipment`, `lot`, `sample`, `part_id`, `specimen`, `destructive`, `replicate`, `value`, `reference_value`, `category`, `text_value`, `condition_json` |
| `method_validation_analyses` | Resultados congelados | `validation_id`, `parameter_key`, `input_hash`, `results_json`, `generated_at` |
| `method_validation_reports` | Relatório e assinaturas | `validation_id`, `version`, `status`, `content_json`, `audit_hash`, `elaborated_by`, `reviewed_by`, `approved_by`, datas |
| `method_validation_audit` | Trilha imutável | `id`, `validation_id`, `actor`, `action`, `detail`, `previous_hash`, `hash`, `created_at` |

Restrições e índices:

- `UNIQUE (method_id, version)` em `method_validations`;
- `FOREIGN KEY` para `TestMethod`, `LaboratoryEquipment`, `LabTest` e
  `CapaAction`, com `ON DELETE RESTRICT`;
- índice em `(validation_id, parameter_key)` e em `(validation_id, run_order)`;
- `CHECK (version > 0)` e `CHECK (status IN (...))`;
- `report_config_json` e `criteria_json` validados pelo schema Pydantic antes
  da gravação.

## 5. Rotas FastAPI

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/method-validations` | Lista com filtros por método, status, equipamento e período |
| `POST` | `/api/v1/method-validations` | Cria validação a partir de um `TestMethod` e de um template normativo |
| `GET` | `/api/v1/method-validations/{id}` | Bundle completo (método, parâmetros, medições, delineamento, análise e relatório) |
| `PATCH` | `/api/v1/method-validations/{id}` | Atualiza cabeçalho, parâmetros e `reportConfig` |
| `POST` | `/api/v1/method-validations/{id}/measurements` | Importa medições (JSON ou XLSX) com validação de integridade |
| `POST` | `/api/v1/method-validations/{id}/analyze` | Executa o motor e devolve a análise; opcionalmente congela resultados |
| `POST` | `/api/v1/method-validations/{id}/reports` | Gera relatório e hash de auditoria |
| `POST` | `/api/v1/method-validations/{id}/signatures` | Assinatura em duas etapas (elaboração/revisão e aprovação) |
| `POST` | `/api/v1/method-validations/{id}/approve` | Aprova, bloqueia e publica o evento de liberação |
| `GET` | `/api/v1/method-validations/{id}/evidence` | Baixa o pacote ZIP com dados, resultados, relatório e manifesto |
| `GET` | `/api/v1/method-validations/{id}/audit` | Trilha de auditoria paginada e verificável |

Todas as rotas exigem autenticação, RBAC por papel (`analyst`, `reviewer`,
`approver`, `admin`) e registro de evento de auditoria. O servidor não aceita
`reportConfig` ou `criteria` sem validação de schema.

## 6. Mapeamento com o LIMS

| ValidaMétodo | LIMS | Regra |
|---|---|---|
| `Method` | `TestMethod` | Um método pode ter várias validações versionadas |
| `Method.equipment` | `LaboratoryEquipment` | O equipamento precisa estar calibrado na data da coleta |
| `Validation` | `LabTest` | A validação libera o método para um `LabTest` específico |
| `ValidationParameter` | `TestMethodParameter` | Critérios específicos da validação prevalecem sobre os globais |
| Falha de parâmetro | `CapaAction` | Abre CAPA automaticamente quando o veredito é `fail` |
| Relatório aprovado | `ControlledDocument` | Relatório entra no controle de documentos com hash e versão |

## 7. Assinatura em duas etapas e 21 CFR Part 11

Fluxo:

1. **Elaboração** — o responsável técnico assina o relatório com nome, papel,
   instante UTC e hash do conteúdo.
2. **Revisão** — o revisor independente confere e assina; o sistema impede
   revisar antes de elaborar.
3. **Aprovação** — o aprovador assina e o registro é bloqueado. Qualquer
   alteração posterior exige nova versão com justificativa.

Controles mínimos:

- identificação única do usuário e verificação de senha no momento da assinatura;
- vínculo entre assinatura, versão do relatório e hash SHA-256;
- registro de tentativas negadas e de alterações de dados;
- trilha de auditoria append-only com encadeamento de hashes;
- carimbo de tempo UTC e retenção configurável;
- separação de papéis (quem elabora não aprova a própria validação);
- bloqueio de edição após aprovação.

## 8. Gates operacionais

| Gate | Condição de bloqueio | Mensagem ao usuário |
|---|---|---|
| Método validado | Não existe validação aprovada e vigente para o `TestMethod` | “Método sem validação aprovada para uso rotineiro.” |
| Equipamento | Calibração vencida ou ausente na data da coleta | “Equipamento fora de calibração; coleta bloqueada.” |
| CAPA | CAPA aberta vinculada à validação | “Existe CAPA aberta; conclusão da validação suspensa.” |
| Homogeneidade | Lote rejeitado sem justificativa | “Registre justificativa técnica antes de prosseguir.” |
| Assinatura | Ordem de papéis inválida | “A revisão exige assinatura de elaboração prévia.” |
| Relatório | Hash divergente do conteúdo | “Relatório alterado após assinatura; gere nova versão.” |

Os gates são aplicados no servidor, não apenas na interface.

## 9. Implantação e compatibilidade

1. Publicar o pacote `@valida-metodo/engine` com versão semântica e testes de
   referência.
2. Aplicar a migração `0007` em ambiente de homologação com backup.
3. Criar as rotas e os schemas Pydantic, mantendo o motor desacoplado.
4. Migrar um método-piloto e comparar os resultados com o aplicativo autônomo
   (mesmo bundle, mesmo hash).
5. Habilitar os gates em modo de observação por duas semanas.
6. Ativar bloqueios, treinar usuários e publicar o runbook de rollback.

Critérios de aceite:

- mesmo bundle produz o mesmo `auditHash` no aplicativo e no LIMS;
- relatório DOCX/PDF abre e mantém tabelas, fórmulas e assinaturas;
- pacote de evidências contém manifesto com hashes verificáveis;
- trilha de auditoria é append-only e resistente a alteração;
- gates impedem coleta/análise quando as pré-condições falham;
- nenhum dado é perdido no rollback para o modo autônomo.

## 10. Riscos e decisões abertas

| Risco | Mitigação |
|---|---|
| Divergência entre versões do motor | Pacote versionado, lockfile e testes de contrato no LIMS |
| Duplicação de regras de negócio | Gates no servidor; motor apenas calcula e devolve evidência |
| Dados sensíveis em worker Node | Execução no navegador por padrão; worker isolado quando necessário |
| Migração de rascunhos locais | Exportação/importação explícita do snapshot SQLite; sem sincronização automática |
| Assinatura sem certificado digital | Documentar como assinatura eletrônica simples; ICP-Brasil fica para onda futura |

Decisões abertas: provedor de identidade do LIMS, política de retenção de
evidências, necessidade de aprovação dupla para métodos críticos e estratégia
de tradução dos relatórios para inglês.
