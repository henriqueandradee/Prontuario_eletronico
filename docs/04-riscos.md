# Registro de Riscos

**Baseline:** CTX-1.0 · Responde à **questão 3** da avaliação.

Escala: probabilidade e impacto de 1 (baixo) a 5 (alto). Exposição = P × I.

---

## R1 — Integração difícil entre trilhas com ritmos diferentes

| | |
|---|---|
| **Probabilidade** | 4 |
| **Impacto** | 4 |
| **Exposição** | 16 — alta |

**Descrição.** Cada trilha trabalha em um ritmo. O app entrega várias vezes por
semana; o núcleo, a cada release homologada. Uma mudança no núcleo pode quebrar o
app entre duas releases sem ninguém perceber.

**Mitigação implementada.** `tests/contrato/nucleo-app.test.js` fixa exatamente o
que o app consome do núcleo: campos de `meuChamadoAtivo`, campos de
`meuAtendimento`, vocabulário de status e as cores de triagem. Os testes rodam
nos **dois** pipelines. Se o núcleo remover `eta_min`, o build falha antes de
chegar ao paciente.

**Risco residual.** O contrato cobre a estrutura, não a semântica. Se o núcleo
mudar o *significado* de `prioridade` mantendo o tipo, o teste passa. Mitigação
complementar: o glossário do baseline e revisão obrigatória do analista de
requisitos em mudanças de domínio.

---

## R2 — Mudança rápida no app passa a depender de regra do núcleo

| | |
|---|---|
| **Probabilidade** | 3 |
| **Impacto** | 4 |
| **Exposição** | 12 — alta |

**Descrição.** O app pode precisar de uma regra que só existe no núcleo — e aí
fica bloqueado esperando uma release que leva semanas, perdendo a vantagem do
DevOps.

**Mitigação implementada.** Dependência unidirecional e superfície reduzida: o
app acessa o núcleo apenas por `criarServicoPaciente`, que recebe o serviço de
despacho por injeção. O app **lê** do núcleo e só tem **uma** operação de escrita
(abrir chamado). Quanto menor a superfície, menor a chance de precisar mexer no
núcleo para evoluir o app.

**Risco residual.** Uma funcionalidade nova do app que exija regra clínica nova
continua dependendo do ciclo do núcleo. Aceito: é o preço de manter o núcleo
regulado, e a alternativa (regra clínica fora do núcleo auditado) é pior.

---

## R3 — Aumento do custo de comunicação entre as equipes

| | |
|---|---|
| **Probabilidade** | 4 |
| **Impacto** | 2 |
| **Exposição** | 8 — média |

**Descrição.** Dois processos, dois ritos, dois vocabulários. Sem alinhamento, um
time atrapalha o outro ou retrabalha.

**Mitigação implementada.** Baseline único como fonte de verdade, glossário
compartilhado (seção 7 do baseline) e contrato executável, que substitui parte da
comunicação verbal por verificação automática.

---

## R4 — Vazamento de dado pessoal de saúde

| | |
|---|---|
| **Probabilidade** | 2 |
| **Impacto** | 5 |
| **Exposição** | 10 — alta |

**Descrição.** Dado de saúde é dado pessoal sensível (LGPD Art. 5, II). Vazamento
gera sanção e dano irreparável ao paciente.

**Mitigações implementadas.**
- RBAC em todas as rotas do núcleo (`exigirPermissao`), verificado pelo pipeline.
- `PERMISSOES.paciente = []` — o app nunca alcança o núcleo.
- Isolamento por titular: `meuPacienteId(ator)` filtra toda consulta do app.
- Visão reduzida: o app recebe um subconjunto explícito, nunca o prontuário integral.
- Mascaramento de CPF na interface do app (minimização — Art. 6, III).
- **A leitura do prontuário é auditada**, não só a escrita (Art. 37).
- Consentimento registrado por finalidade (`consentimentos`).

**Risco residual.** Um usuário autorizado pode consultar prontuários sem
necessidade assistencial. Detectável pela trilha, não prevenido por ela. Controle
complementar: revisão periódica do relatório de acessos pelo responsável por
conformidade.

---

## R5 — Subtriagem de chamado grave

| | |
|---|---|
| **Probabilidade** | 3 |
| **Impacto** | 5 |
| **Exposição** | 15 — alta |

**Descrição.** Classificar como leve um caso grave atrasa o socorro. É o erro
mais caro da central.

**Mitigações implementadas.**
- A triagem **só agrava, nunca alivia** — testado explicitamente.
- Sinais críticos no relato livre ("inconsciente", "não respira", "parada")
  elevam o chamado a P1 automaticamente.
- A natureza da ocorrência estabelece um piso de prioridade.
- P1 e P2 exigem USA; a sugestão prefere a USA mesmo estando mais distante.
- Despacho de recurso abaixo do indicado é sinalizado na tela do operador.

**Risco residual.** A detecção por palavra-chave não entende contexto nem
negação. É uma rede de segurança adicional à avaliação do operador, não um
substituto dela.

---

## R6 — Adulteração do registro clínico ou da trilha

| | |
|---|---|
| **Probabilidade** | 1 |
| **Impacto** | 5 |
| **Exposição** | 5 — média |

**Descrição.** Alteração retroativa de prontuário para encobrir erro
assistencial, ou apagamento de registros da trilha.

**Mitigações implementadas.**
- `evolucoes` é append-only; correção só por retificação, com o original preservado.
- Cada registro carrega assinatura eletrônica (HMAC de autor + conteúdo + horário).
- Trilha de auditoria encadeada por hash — adulteração e remoção são detectáveis.
- `scripts/verifica-auditoria.js` roda no pipeline e pode ser agendado em produção.
- O verificador de segurança falha o build se surgir `UPDATE`/`DELETE` em `evolucoes`.

**Risco residual.** Quem controla o servidor e a chave pode recomputar a cadeia
inteira. Mitigação complementar (fora do escopo acadêmico): publicar o hash do
último registro em armazenamento externo (WORM) periodicamente.

---

## Matriz consolidada

| Risco | P | I | Exposição | Situação |
|---|---|---|---|---|
| R1 Integração entre trilhas | 4 | 4 | **16** | Mitigado por contrato executável |
| R5 Subtriagem | 3 | 5 | **15** | Mitigado por triagem conservadora |
| R2 Acoplamento app → núcleo | 3 | 4 | **12** | Mitigado por superfície reduzida |
| R4 Vazamento de dado de saúde | 2 | 5 | **10** | Mitigado por RBAC + auditoria de leitura |
| R3 Custo de comunicação | 4 | 2 | **8** | Mitigado por baseline e glossário |
| R6 Adulteração de registro | 1 | 5 | **5** | Mitigado por append-only + hash |
