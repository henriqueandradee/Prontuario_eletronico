# Documento de Contexto — Baseline CTX-1.0

**Sistema:** Prontuário Eletrônico Hospitalar e Sistema de Despacho de Ambulâncias
**Disciplina:** Gerência, Configuração e Processos de Software
**Estudante:** Henrique Tomazoni Andrade
**Status:** Aprovado — baseline inicial do projeto
**Versão:** CTX-1.0

> Este documento é o **baseline inicial** do projeto, conforme a questão 5 da
> Avaliação N1 — Parte 1. Todo o pipeline parte dele: requisitos, histórias e
> mudanças são rastreados até aqui. Alterá-lo exige aprovação formal do P.M.

---

## 1. Domínio do problema

Um hospital público opera dois serviços interligados:

1. **Prontuário eletrônico** — registro clínico dos pacientes atendidos no
   pronto-socorro, ambulatório e internação.
2. **Despacho de ambulâncias** — central de regulação que recebe chamados de
   urgência, classifica o risco e envia a unidade adequada.

Os dois se encontram no momento em que a ambulância entrega o paciente no
hospital: a classificação de risco feita em campo precisa chegar íntegra ao
prontuário, sem redigitação e sem perda do histórico pré-hospitalar.

Há ainda um terceiro componente, de criticidade menor: o **aplicativo do
paciente**, que permite acompanhar atendimentos e solicitar ambulância.

## 2. Decisão de processo (questão 1)

O projeto é dividido em **duas trilhas com processos diferentes**:

| | Núcleo regulado | App do paciente |
|---|---|---|
| **Escopo** | Prontuário + despacho de ambulâncias | Aplicativo do paciente |
| **Processo** | Cascata | DevOps / entrega contínua |
| **Requisitos** | Estáveis, definidos previamente | Evoluem com feedback do usuário |
| **Mudança** | Aprovação formal do P.M. | Deploy contínuo |
| **Criticidade** | Alta — erro afeta dado médico e atendimento | Menor — falha não interrompe assistência |
| **Rollback** | Nova versão homologada | Feature flag, sem redeploy |
| **Exigências** | LGPD, auditoria, rastreabilidade | LGPD (dados do próprio titular) |

### Critérios da decisão

1. **Criticidade do dado.** O registro clínico e o despacho de urgência podem
   custar vidas. Isso exige requisitos congelados, homologação formal e trilha
   de auditoria — características do modelo Cascata.
2. **Estabilidade dos requisitos.** As regras do prontuário derivam de norma
   (CFM, LGPD) e de protocolo assistencial. Mudam pouco e não são negociáveis
   com o usuário final.
3. **Exigência regulatória.** Auditoria e LGPD demandam evidência de teste,
   aprovação registrada e histórico de versões — o que um fluxo totalmente
   livre não entrega.
4. **Velocidade de aprendizado.** O app do paciente melhora com uso real. Travá-lo
   no mesmo rito do núcleo desperdiçaria a única parte que ganha com iteração.

### Justificativa

Tratar todo o sistema com o mesmo nível de rigor seria errado nos dois sentidos:
engessaria o app, que precisa aprender rápido, e afrouxaria o núcleo, que não pode
errar. A separação permite respeitar a exigência legal sem travar a evolução da
parte que pode mudar.

## 3. Papéis e responsabilidades (questão 2)

Detalhamento completo em [`03-papeis-e-processo.md`](03-papeis-e-processo.md).

**Núcleo regulado (Cascata)**
- **P.M.** — escopo, prazos, demandas e a **aprovação formal de ida à produção**.
- **Analista de requisitos** — documenta regras legais e protocolos hospitalares.
- **Desenvolvedores** — implementam contra requisito rastreado.
- **QA** — valida contra o requisito e produz a evidência de teste.
- **Responsável por segurança e conformidade** — LGPD, RBAC, trilha de auditoria.

**App do paciente (DevOps)**
- **P.O.** — prioriza o backlog a partir do feedback dos usuários.
- **Desenvolvedores** — equipe menor e mais autônoma.
- **QA** — testes automatizados no pipeline.
- **DevOps** — pipeline, deploy, monitoramento e rollback.

## 4. Riscos (questão 3)

Registro completo, com probabilidade, impacto e mitigação implementada, em
[`04-riscos.md`](04-riscos.md).

| # | Risco | Mitigação implementada |
|---|---|---|
| R1 | Integração difícil entre trilhas de ritmos diferentes | Testes de contrato em `tests/contrato/`, obrigatórios nos dois pipelines |
| R2 | Mudança rápida no app passa a depender de regra do núcleo | Núcleo exposto ao app por superfície reduzida e versionada (`/api/app`) |
| R3 | Aumento do custo de comunicação entre equipes | Baseline único, glossário compartilhado e contrato executável |
| R4 | Vazamento de dado de saúde | RBAC, isolamento por titular, mascaramento, auditoria de leitura |
| R5 | Subtriagem de chamado grave | Triagem que só agrava, nunca alivia; P1/P2 exigem USA |
| R6 | Adulteração do registro clínico | Registro append-only e trilha encadeada por hash |

## 5. Pontos fortes da decisão (questão 4)

- Cada parte usa o processo adequado ao seu risco.
- O núcleo fica controlado, rastreável e auditável.
- O app recebe melhorias e correções com rapidez.
- A exigência legal é respeitada sem congelar todo o produto.

## 6. Pipeline (questão 5)

Descrito em [`05-pipeline-devops.md`](05-pipeline-devops.md) e implementado em
`.github/workflows/`. Resumo do fluxo, partindo deste baseline:

```
CTX-1.0 (este documento)
  └─> requisitos RF/RNF (docs/01-requisitos.md)
        └─> histórias e branch
              └─> code review
                    └─> testes automatizados
                          └─> análise de segurança e conformidade
                                └─> homologação
                                      ├─ núcleo: APROVAÇÃO FORMAL DO P.M. ─> produção
                                      └─ app:    deploy contínuo + monitoramento ─> rollback por flag
```

## 7. Glossário

| Termo | Significado |
|---|---|
| **USB** | Unidade de Suporte Básico — técnico de enfermagem a bordo |
| **USA** | Unidade de Suporte Avançado — médico e enfermeiro a bordo |
| **Triagem** | Classificação de risco do chamado, de P1 (emergência) a P5 (não urgente) |
| **Evolução** | Registro clínico assinado por profissional |
| **Retificação** | Correção de registro clínico, feita por novo registro — nunca por edição |
| **Chamado** | Ocorrência recebida pela central de regulação |
| **Despacho** | Envio de uma ambulância a um chamado |
| **Admissão** | Entrada do paciente no hospital, abrindo o atendimento no prontuário |
| **Baseline** | Versão aprovada de um artefato; mudança exige processo formal |
| **Feature flag** | Chave que liga/desliga funcionalidade em produção sem novo deploy |

## 8. Controle de versões deste documento

| Versão | Data | Autor | Mudança |
|---|---|---|---|
| CTX-1.0 | 2026-09-21 | Henrique Tomazoni Andrade | Baseline inicial aprovado |
