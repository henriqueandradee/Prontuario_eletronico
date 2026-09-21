# Papéis, Responsabilidades e Processo

**Baseline:** CTX-1.0 · Responde à **questão 2** da avaliação.

## 1. Por que os papéis são diferentes em cada trilha

No núcleo regulado, qualquer erro pode afetar dado médico e atendimento. Isso
justifica papéis formais, segregação de funções e um portão de aprovação. No app
do paciente, a criticidade é menor e a necessidade de resposta rápida é maior —
uma equipe menor e mais autônoma entrega melhor.

## 2. Núcleo regulado (Cascata)

| Papel | Responsabilidades | Autoridade |
|---|---|---|
| **P.M.** | Escopo, prazos, demandas, gestão de mudanças | **Aprova formalmente a ida à produção**. Sem o aceite, o pipeline não implanta |
| **Analista de requisitos** | Documenta regras legais (LGPD, CFM) e protocolos hospitalares; mantém a matriz RF/RNF | Aprova a especificação antes do desenvolvimento |
| **Desenvolvedor** | Implementa contra requisito rastreado; abre PR citando o RF/RNF | Não implanta em produção |
| **QA** | Valida contra o requisito; produz a evidência de teste retida por 365 dias | Bloqueia a release |
| **Responsável por segurança e conformidade** | LGPD, matriz de RBAC, trilha de auditoria, revisão de acesso a dado sensível | Veto sobre mudanças que afetem dado de saúde |
| **Auditor** (externo ao time) | Verifica a integridade da trilha e o histórico de acessos | Somente leitura — inclusive no sistema |

**Segregação de funções** — quem desenvolve não aprova, quem aprova não audita,
e o auditor não escreve. Isso está no processo e também no código: a matriz de
`src/nucleo/rbac.js` dá ao papel `auditor` exclusivamente permissões `:ler`, e o
pipeline falha se alguém tentar adicionar uma permissão de escrita a ele.

## 3. App do paciente (DevOps)

| Papel | Responsabilidades | Autoridade |
|---|---|---|
| **P.O.** | Prioriza o backlog a partir do feedback real dos usuários | Decide o que entra na próxima entrega |
| **Desenvolvedor** | Implementa e faz deploy; equipe pequena e autônoma | Implanta em produção sem aprovação externa |
| **QA** | Mantém os testes automatizados do pipeline | Bloqueia o merge, não o deploy |
| **DevOps** | Pipeline, monitoramento, rollback por feature flag | Desliga uma flag em produção a qualquer momento |

## 4. Papéis no sistema em execução

Os papéis organizacionais acima se materializam em papéis de acesso no sistema.
Matriz completa em `src/nucleo/rbac.js`, verificada por `tests/nucleo/rbac.test.js`.

| Papel no sistema | O que pode fazer | O que **não** pode |
|---|---|---|
| `medico` | Prontuário completo, prescrever, dar alta | Despachar ambulância, ler a trilha de auditoria |
| `enfermeiro` | Sinais vitais, evolução de enfermagem, triagem | Prescrever, assinar evolução médica |
| `recepcao` | Cadastrar paciente, abrir atendimento | Acessar o registro clínico |
| `operador_despacho` | Chamados, triagem, despacho, frota | Prescrever, registrar evolução |
| `socorrista` | Atualizar chamado e status da unidade em campo, registrar sinais vitais | Despachar, prescrever |
| `auditor` | Ler tudo, inclusive a trilha | **Escrever qualquer coisa** |
| `admin` | Administração do sistema e das feature flags | — |
| `paciente` | Apenas as rotas `/api/app/*`, apenas os próprios dados | **Qualquer rota do núcleo regulado** |

### Decisões de segregação e seus motivos

- **Enfermeiro não assina evolução médica.** O tipo `evolucao` exige papel
  `medico`; enfermagem registra em `enfermagem`. Um registro clínico responde
  pelo profissional que o assinou.
- **Recepção não lê o registro clínico.** Cadastra e abre atendimento, mas não
  acessa o conteúdo assistencial — minimização de acesso (LGPD).
- **Auditor não escreve.** Se o auditor pudesse alterar dados, a auditoria
  perderia independência. Garantido em código e no pipeline.
- **Paciente não toca o núcleo.** `PERMISSOES.paciente` é uma lista vazia, e o
  verificador de segurança falha o build se deixar de ser.

## 5. Fluxo de mudança

### Núcleo regulado

```
demanda ─> analista documenta RF/RNF ─> P.M. aprova o escopo
   ─> branch + implementação citando o requisito
   ─> code review (2 revisores, um deles da segurança se o dado for sensível)
   ─> testes automatizados + evidência arquivada
   ─> verificação de segurança e conformidade
   ─> homologação validada pela equipe assistencial
   ─> APROVAÇÃO FORMAL DO P.M.  ← portão obrigatório
   ─> produção
   ─> verificação pós-implantação
```

### App do paciente

```
feedback ─> P.O. prioriza ─> branch + implementação atrás de feature flag
   ─> code review (1 revisor)
   ─> testes automatizados + teste de contrato com o núcleo
   ─> deploy automático
   ─> monitoramento por 15 minutos
   ─> se degradar: desliga a flag (rollback em segundos)
```

## 6. Comunicação entre as equipes

O risco 3 do documento aponta o aumento do custo de comunicação. Três mecanismos
reduzem essa dependência de conversa:

1. **Baseline único.** As duas equipes partem de `00-documento-de-contexto.md`.
2. **Glossário compartilhado.** Seção 7 do baseline. "Chamado", "despacho" e
   "admissão" significam a mesma coisa nos dois times.
3. **Contrato executável.** `tests/contrato/` transforma a combinação verbal
   entre as equipes em teste que falha o build. Se o núcleo remover um campo que
   o app renderiza, o pipeline avisa — ninguém precisa lembrar de avisar.
