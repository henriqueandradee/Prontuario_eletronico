# Arquitetura

**Baseline:** CTX-1.0

A arquitetura reflete a decisão de processo: as duas trilhas são separadas no
código, no pipeline e na superfície da API, mas compartilham o mesmo banco —
porque o paciente é o mesmo dos dois lados.

## Visão geral

```
                    ┌──────────────────────────────────────────┐
                    │              Navegador                   │
                    ├──────────────┬───────────────────────────┤
                    │ nucleo.html  │  despacho.html            │  paciente.html
                    │ auditoria.html                           │
                    └──────┬───────┴──────────┬────────────────┘
                           │                  │
                     /api/nucleo/*        /api/app/*
                           │                  │
        ┌──────────────────┴──────────────────┴──────────────────┐
        │  app.js — servidor HTTP, autenticação, roteamento       │
        └──────────────────┬──────────────────┬──────────────────┘
                           │                  │
   ┌───────────────────────┴──────────┐   ┌───┴───────────────────────────┐
   │      NÚCLEO REGULADO (Cascata)   │   │  APP DO PACIENTE (DevOps)     │
   │  ┌────────────┐ ┌─────────────┐  │   │  ┌────────────┐ ┌──────────┐  │
   │  │ prontuario │ │  despacho   │  │   │  │  paciente  │ │  flags   │  │
   │  │  .service  │ │  .service   │  │   │  │  .service  │ │          │  │
   │  └─────┬──────┘ └──────┬──────┘  │   │  └─────┬──────┘ └──────────┘  │
   │        │               │         │   │        │                      │
   │        └── admitir ────┘         │   │        │ (só leitura + abrir  │
   │           (integração)           │   │        │  chamado)            │
   │  ┌───────────────────────────┐   │   └────────┼──────────────────────┘
   │  │  rbac.js — matriz de      │   │            │
   │  │  papéis e permissões      │   │            │
   │  └───────────────────────────┘   │            │
   └──────────────┬───────────────────┘            │
                  │                                │
        ┌─────────┴────────────────────────────────┴─────────┐
        │  lib/audit.js — trilha imutável encadeada por hash │
        └─────────────────────────┬──────────────────────────┘
                                  │
                       ┌──────────┴───────────┐
                       │  SQLite (node:sqlite)│
                       └──────────────────────┘
```

## Separação das trilhas

| | Núcleo regulado | App do paciente |
|---|---|---|
| Código | `src/nucleo/` | `src/app-paciente/` |
| Rotas | `/api/nucleo/*` | `/api/app/*` |
| Telas | `nucleo.html`, `despacho.html`, `auditoria.html` | `paciente.html` |
| Testes | `tests/nucleo/` | `tests/app-paciente/` |
| Pipeline | `.github/workflows/nucleo-regulado.yml` | `.github/workflows/app-paciente.yml` |
| Fronteira | — | `tests/contrato/` (verificada nos dois pipelines) |

**Regra de dependência:** o app do paciente depende do núcleo; o núcleo **nunca**
depende do app. Isso permite que o app mude em ritmo próprio sem arrastar o
núcleo junto. A dependência é unidirecional e está congelada pelos testes de
contrato.

## Decisões técnicas

### Zero dependências de terceiros

O projeto roda apenas com Node.js (`node:sqlite`, `node:crypto`, `node:http`,
`node:test`). Motivos:

1. **Superfície de auditoria menor.** Cada biblioteca externa em um sistema
   regulado precisa ser inventariada e monitorada por vulnerabilidade.
2. **Reprodutibilidade.** `git clone && npm start` funciona sem rede.
3. **Sem cadeia de suprimentos.** Não há risco de pacote comprometido.

O custo é escrever roteador e validador à mão — cerca de 150 linhas, todas
auditáveis.

### Registro clínico append-only

A tabela `evolucoes` nunca sofre `UPDATE` nem `DELETE`. Uma correção entra como
novo registro do tipo `retificacao`, apontando para o original, que permanece
visível. É como funciona o prontuário em papel — e o que a auditoria exige.

`scripts/verifica-seguranca.js` falha o build se um `UPDATE evolucoes` aparecer
no código.

### Trilha de auditoria encadeada por hash

Cada registro carrega o hash do anterior:

```
hash(n) = SHA-256( hash(n-1) | ator | ação | entidade | detalhes | timestamp )
```

Alterar ou remover qualquer linha quebra a cadeia a partir dali.
`verificarCadeia()` recalcula tudo e aponta o registro exato da divergência.
Um atacante com acesso ao banco precisaria recomputar toda a cadeia — e ainda
assim não bate com os backups anteriores.

### Feature flags como mecanismo de rollback

O núcleo, sob Cascata, só volta atrás com nova versão homologada. O app, sob
DevOps, desliga a funcionalidade problemática em segundos, sem deploy. Por isso
toda funcionalidade do app nasce atrás de uma flag — é o que torna o deploy
contínuo seguro sem o rito do núcleo.

### Autenticação

Token assinado com HMAC-SHA256 (formato JWT), validade de 8 horas — um turno.
Senhas com scrypt e sal por usuário. Comparações com `timingSafeEqual`.

## Modelo de dados

```
usuarios ──┬──> pacientes ──┬──> alergias
           │                ├──> consentimentos
           │                └──> atendimentos ──┬──> evolucoes (append-only)
           │                         │          ├──> sinais_vitais
           │                         │          └──> prescricoes
           │                         │
           │                    chamados ──> chamado_eventos
           │                         │
           │                    ambulancias
           │
           └──> auditoria (encadeada por hash)

feature_flags (isolada — só o app do paciente)
```

A ligação `chamados.atendimento_id ↔ atendimentos.chamado_id` é o ponto de
integração entre os dois módulos do núcleo.

## Fluxo crítico: da ligação ao leito

```
1. Central recebe o chamado         → abrirChamado()    → triagem automática
2. Sistema sugere a ambulância      → sugerirDespacho() → recurso + distância
3. Operador confirma                → despachar()       → ambulância = a_caminho
4. Equipe chega ao local            → avancarChamado()  → no_local
5. Paciente embarcado               → avancarChamado()  → transportando
6. Chegada ao hospital              → admitirNoHospital()
                                       ├─ abre atendimento no prontuário
                                       ├─ transfere a classificação de risco
                                       └─ vincula chamado ↔ atendimento
7. Equipe assistencial assume       → registrarEvolucao(), prescrever()...
```

Cada passo gera registro de auditoria e evento na linha do tempo do chamado.
