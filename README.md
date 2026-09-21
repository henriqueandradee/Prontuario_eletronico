# Prontuário Eletrônico Hospitalar e Sistema de Despacho de Ambulâncias

Sistema completo construído a partir do documento **Avaliação N1 — Parte 1**
(Gerência, Configuração e Processos de Software).

**Estudante:** Henrique Tomazoni Andrade

O documento decidiu usar **dois processos diferentes** — Cascata para o núcleo
regulado, DevOps para o app do paciente. Este repositório implementa essa decisão
no código, no pipeline e na estrutura de pastas, não apenas no texto.

---

## Como rodar

Requer apenas **Node.js 22.5+**. Nenhuma dependência externa, nenhum `npm install`.

```bash
npm run seed    # cria o banco com dados de demonstração
npm start       # sobe em http://localhost:3000
```

| Tela | URL | Quem usa |
|---|---|---|
| Portal de acesso | `/` | todos |
| Painel hospitalar | `/nucleo.html` | médico, enfermeiro, recepção |
| Central de despacho | `/despacho.html` | operador, socorrista |
| App do paciente | `/paciente.html` | paciente |
| Trilha de auditoria | `/auditoria.html` | auditor, admin |

Todos os usuários de demonstração usam a senha `senha123`. O portal tem botões
que preenchem o login de cada perfil.

| E-mail | Papel |
|---|---|
| `helena@hospital.local` | Médico |
| `camila@hospital.local` | Enfermeiro |
| `juliana@hospital.local` | Recepção |
| `marcos@hospital.local` | Operador de despacho |
| `diego@hospital.local` | Socorrista |
| `sandra@hospital.local` | Auditor |
| `admin@hospital.local` | Administrador |
| `paciente1@app.local` … `paciente5@app.local` | Paciente (app) |

```bash
npm test                   # 76 testes
npm run seguranca          # verificação de segurança e conformidade
npm run auditoria:verificar # integridade da trilha
npm run reset              # recria o banco do zero
```

---

## Roteiro de demonstração

Um percurso de 5 minutos que exercita as duas trilhas e a integração entre elas.

**1. A triagem protege contra subtriagem.**
Entre como **Marcos (operador)**. Em *Registrar chamado*, escolha prioridade
`5 - Não urgente` e escreva no relato: *"homem caiu e está inconsciente"*.
O sistema devolve **P1 / vermelho** e explica: `sinal crítico no relato:
'inconsciente'`. A triagem só agrava, nunca alivia.

**2. O despacho prefere o recurso certo à distância.**
Clique no chamado e veja a sugestão: para P1 e P2 o sistema escolhe uma **USA**
mesmo havendo uma USB mais perto. Despache também o chamado P2 (crise asmática)
para ocupar a segunda USA e repita — sem nenhuma USA livre, o sistema cai para a
USB e avisa em vermelho que o recurso está abaixo do indicado.

**3. A classificação de campo chega ao prontuário.**
Despache e avance até *Em transporte*. Repare que o operador **não** vê o botão
de admissão: abrir prontuário é ato clínico. Entre como **Dra. Helena**, volte a
`/despacho.html`, abra o mesmo chamado e use **Admitir e abrir prontuário**. Em
`/nucleo.html` o atendimento já aparece com a classificação de risco definida na
rua e o vínculo com o chamado.

**4. O prontuário barra prescrição perigosa.**
Abra o atendimento de **Antônio Carlos Ferraz** (alérgico a Penicilina) e tente
prescrever *Penicilina G Benzatina*. A prescrição é bloqueada, e o bloqueio entra
na trilha de auditoria.

**5. O registro clínico não se apaga.**
Registre uma evolução e depois uma *Retificação* apontando para ela. As duas
ficam visíveis — é assim que funciona o prontuário em papel.

**6. A trilha detecta adulteração.**
Entre como **Sandra (auditora)** em `/auditoria.html` e verifique a cadeia. Agora
altere um registro direto no banco e verifique de novo:

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('./data/hospital.db');d.prepare(\"UPDATE auditoria SET acao='FALSIFICADA' WHERE id=5\").run()"
```

A tela aponta o registro exato e o motivo da quebra.

**7. Rollback sem deploy.**
Entre como **admin** em `/auditoria.html` e desligue a flag
`app.solicitar_ambulancia`. Recarregue `/paciente.html`: a funcionalidade sumiu e
a tela orienta ligar para o 192. Nenhum deploy foi feito. Esse é o mecanismo de
rollback da trilha DevOps — o núcleo regulado, sob Cascata, precisaria de uma
release homologada.

---

## Estrutura

```
├── docs/                      Baseline e documentação do processo
│   ├── 00-documento-de-contexto.md   ← BASELINE CTX-1.0
│   ├── 01-requisitos.md              ← 45 requisitos rastreados
│   ├── 02-arquitetura.md
│   ├── 03-papeis-e-processo.md       ← questão 2
│   ├── 04-riscos.md                  ← questão 3
│   ├── 05-pipeline-devops.md         ← questão 5
│   └── 06-api.md
│
├── src/
│   ├── nucleo/                ◄── NÚCLEO REGULADO (Cascata)
│   │   ├── prontuario.service.js
│   │   ├── despacho.service.js
│   │   └── rbac.js
│   ├── app-paciente/          ◄── APP DO PACIENTE (DevOps)
│   │   ├── paciente.service.js
│   │   └── flags.js
│   ├── lib/
│   │   ├── audit.js           Trilha encadeada por hash
│   │   ├── auth.js            Tokens e assinatura de registro
│   │   ├── validate.js        Validação e CPF
│   │   └── geo.js             Distância e ETA
│   ├── db/schema.sql          Modelo de dados versionado
│   ├── rotas.js
│   └── server.js
│
├── public/                    Interface web
├── tests/
│   ├── nucleo/                Testes do núcleo
│   ├── app-paciente/          Testes do app
│   └── contrato/              ◄── FRONTEIRA entre as trilhas
├── scripts/                   Verificações do pipeline
└── .github/workflows/         Dois pipelines, um por trilha
```

---

## Como o documento virou sistema

| Decisão do documento | Onde está implementada |
|---|---|
| Núcleo em Cascata, app em DevOps | `src/nucleo/` × `src/app-paciente/`, dois workflows separados |
| Papéis formais e segregação de funções | `src/nucleo/rbac.js` — 8 papéis, verificados por 7 testes |
| Produção do núcleo exige aprovação formal do P.M. | Environment `producao` com revisores obrigatórios |
| App com deploy frequente e rollback | `src/app-paciente/flags.js` — 6 feature flags |
| Risco: integração entre trilhas de ritmos diferentes | `tests/contrato/` — roda nos dois pipelines |
| LGPD, auditoria e aprovação formal | Trilha encadeada por hash, auditoria de leitura, RBAC |
| Baseline é o documento de contexto | Primeiro job do pipeline verifica o baseline e exige RF/RNF no PR |

---

## O que o sistema faz

### Prontuário eletrônico
Cadastro com CPF validado por dígito verificador · alergias com gravidade ·
atendimentos com classificação de risco · **registro clínico append-only** com
assinatura eletrônica e retificação · sinais vitais com faixas fisiológicas e
alertas automáticos · prescrição **bloqueada por alergia registrada** · encerramento
com desfecho.

### Despacho de ambulâncias
Triagem em 5 níveis que **só agrava, nunca alivia** · detecção de sinais críticos
no relato livre · seleção por adequação do recurso e depois distância (Haversine) ·
**P1 e P2 exigem USA** · ciclo de vida completo com linha do tempo · mapa
operacional · indicadores de tempo de resposta · **admissão que leva a triagem de
campo direto ao prontuário**.

### App do paciente
Perfil com CPF mascarado · histórico próprio · solicitação de ambulância que entra
na mesma fila da central · acompanhamento com ETA em tempo real · **tudo atrás de
feature flag**.

### Auditoria e conformidade
Trilha imutável encadeada por hash · **a leitura do prontuário também é auditada** ·
verificação de integridade que aponta o registro adulterado · consentimento por
finalidade · painel de conformidade.

---

## Decisões técnicas

**Zero dependências.** Só Node.js: `node:sqlite`, `node:crypto`, `node:http`,
`node:test`. Em sistema regulado, cada biblioteca externa é mais um item a
inventariar e monitorar. O custo é um roteador e um validador escritos à mão —
cerca de 150 linhas auditáveis. O ganho é `git clone && npm start` funcionando
sem rede e sem cadeia de suprimentos.

**Append-only no registro clínico.** `evolucoes` nunca sofre `UPDATE` nem
`DELETE`; correção entra como novo registro apontando para o original. O
verificador de segurança falha o build se um `UPDATE evolucoes` aparecer.

**Trilha encadeada por hash.** `hash(n) = SHA-256(hash(n-1) | conteúdo)`.
Alterar ou remover qualquer linha quebra a cadeia a partir dali, e a verificação
aponta o registro exato.

Detalhamento em [`docs/02-arquitetura.md`](docs/02-arquitetura.md).
