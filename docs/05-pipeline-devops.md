# Pipeline

**Baseline:** CTX-1.0 · Responde à **questão 5** da avaliação.

> "O pipeline começaria com o documento de contexto como baseline inicial."

É literalmente o que acontece: o primeiro job do pipeline do núcleo verifica se o
baseline e a matriz de requisitos estão versionados, e recusa PRs que não citem o
requisito atendido.

---

## 1. Do baseline à produção

```
┌──────────────────────────────────────────────────────────────────────┐
│  BASELINE INICIAL — docs/00-documento-de-contexto.md (CTX-1.0)       │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │  Requisitos RF-xx / RNF-xx    │
                 │  docs/01-requisitos.md        │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │  Histórias e branch de        │
                 │  trabalho citando o requisito │
                 └───────────────┬───────────────┘
                                 │
        ┌────────────────────────┴────────────────────────┐
        │                                                 │
┌───────┴─────────────────────┐              ┌────────────┴──────────────┐
│    NÚCLEO REGULADO          │              │    APP DO PACIENTE        │
│    (Cascata)                │              │    (DevOps)               │
├─────────────────────────────┤              ├───────────────────────────┤
│ 1. Rastreabilidade          │              │ 1. Lint                   │
│    · baseline versionado    │              │ 2. Testes do app          │
│    · PR cita RF/RNF         │              │ 3. TESTE DE CONTRATO      │
│ 2. Lint                     │              │    com o núcleo           │
│ 3. Testes do núcleo         │              │ 4. Deploy automático      │
│    · evidência arquivada    │              │    (sem aprovação manual) │
│      por 365 dias           │              │ 5. Monitoramento 15 min   │
│ 4. Segurança e conformidade │              │ 6. Rollback por flag      │
│    · segredos, RBAC         │              │                           │
│    · append-only            │              │                           │
│    · integridade da trilha  │              │                           │
│ 5. Homologação              │              │                           │
│    · validação assistencial │              │                           │
│ 6. ▓▓ APROVAÇÃO FORMAL ▓▓   │              │                           │
│    ▓▓ DO P.M.          ▓▓   │              │                           │
│ 7. Produção                 │              │                           │
│ 8. Verificação pós-deploy   │              │                           │
└─────────────────────────────┘              └───────────────────────────┘
```

## 2. Por que o pipeline do núcleo não pode ser livre

O documento aponta: *"como o projeto tem uma parte regulada, o pipeline não pode
ser totalmente livre. Ele precisa guardar histórico, evidências de teste e
aprovações."* Três etapas existem só por causa disso:

### Rastreabilidade (job `rastreabilidade`)

Verifica que o baseline e os requisitos estão versionados, e que o PR cita um
`RF-xx` ou `RNF-xx`. Sem rastreabilidade não há auditoria: é preciso conseguir
responder "por que esta linha de código existe?" apontando para um requisito
aprovado.

### Evidência de teste retida (job `testes`)

O resultado dos testes é arquivado como artefato com **365 dias de retenção**,
carimbado com o commit e o horário. Em auditoria hospitalar, dizer "os testes
passaram" não basta — é preciso mostrar.

### Aprovação formal (job `producao`)

O job usa o *environment* `producao` do GitHub Actions, que exige revisores
configurados. O pipeline **para** e espera o aceite do P.M. e do responsável por
conformidade. O aceite fica registrado com autor e data.

É o ponto que diferencia as duas trilhas: o núcleo tem um portão humano
obrigatório; o app não tem nenhum.

## 3. Por que o app pode ser livre

O app é menos crítico e precisa responder rápido ao feedback. Seu pipeline vai
direto ao deploy. A segurança vem de outro lugar:

1. **Feature flags.** Todo código novo entra desligado ou controlado por flag.
2. **Rollback em segundos.** Degradou? Desliga a flag. Sem redeploy, sem release.
3. **Teste de contrato.** Impede que o app quebre por mudança no núcleo.
4. **Monitoramento pós-deploy.** 15 minutos de observação antes de considerar a
   entrega estável.

## 4. Verificações automatizadas

| Script | O que verifica | Falha o build? |
|---|---|---|
| `scripts/lint.js` | Sintaxe de todos os módulos | Sim |
| `scripts/verifica-seguranca.js` | Segredos no código, invariantes de RBAC, append-only do registro clínico, autorização em toda rota do núcleo | Sim |
| `scripts/verifica-auditoria.js` | Integridade da cadeia de hash da trilha | Sim |
| `node --test` | 76 testes automatizados | Sim |

O `verifica-seguranca.js` cobre o que teste unitário não pega, porque olha o
código-fonte: se alguém adicionar uma rota em `/api/nucleo/` sem
`exigirPermissao`, ou der permissão de escrita ao auditor, o build para.

## 5. Gestão de configuração

| Item | Baseline | Onde mudar |
|---|---|---|
| Documento de contexto | CTX-1.0 | PR com aprovação do P.M. |
| Requisitos | REQ-1.0 | PR do analista, aprovado pelo P.M. |
| Schema do banco | `src/db/schema.sql` | PR no núcleo, com migração |
| Matriz de RBAC | `src/nucleo/rbac.js` | PR com veto do responsável por conformidade |
| Feature flags | Banco, em tempo de execução | Admin, pela tela de auditoria — alteração auditada |

Repare na última linha: a flag é o único item que muda **em produção, sem
deploy**. Por isso a alteração é registrada na trilha de auditoria — é uma
mudança de comportamento do sistema como qualquer outra.

## 6. Ambientes

| Ambiente | Origem | Aprovação | Dados |
|---|---|---|---|
| Desenvolvimento | branch local | — | seed sintético |
| Homologação | `main` / `release/*` | automática após testes | seed sintético |
| Produção | `main` | **P.M. + conformidade** | dados reais |

`src/config.js` recusa subir em produção com o segredo de desenvolvimento.

## 7. Como rodar o pipeline localmente

```bash
node scripts/lint.js               # verificação sintática
node --test 'tests/**/*.test.js'   # suíte completa
node scripts/verifica-seguranca.js # segurança e conformidade
node scripts/verifica-auditoria.js # integridade da trilha
```
