# Matriz de Requisitos

**Baseline:** CTX-1.0 · **Versão:** REQ-1.0

Todo requisito aponta para o local do código que o implementa e para o teste que
o comprova. Um PR no núcleo regulado deve citar o identificador do requisito que
atende — o pipeline recusa o PR sem essa citação.

---

## Requisitos funcionais — Prontuário (núcleo regulado)

| ID | Requisito | Implementação | Teste |
|---|---|---|---|
| RF-01 | Cadastrar paciente com CPF validado por dígito verificador | `prontuario.service.js:cadastrarPaciente` | `prontuario.test.js` — "rejeita CPF com dígitos inválidos" |
| RF-02 | Impedir cadastro duplicado de CPF | `prontuario.service.js:cadastrarPaciente` | "rejeita CPF duplicado" |
| RF-03 | Registrar alergias do paciente com gravidade | `prontuario.service.js:registrarAlergia` | "bloqueia prescrição com alergia" |
| RF-04 | Abrir atendimento vinculado a um paciente | `prontuario.service.js:abrirAtendimento` | "abre atendimento e impede duplicidade" |
| RF-05 | Impedir dois atendimentos abertos para o mesmo paciente | `prontuario.service.js:abrirAtendimento` | idem |
| RF-06 | Registrar evolução clínica com assinatura eletrônica | `prontuario.service.js:registrarEvolucao` | "assina eletronicamente cada registro" |
| RF-07 | Manter o registro clínico append-only; correção só por retificação | `prontuario.service.js:registrarEvolucao` | "retificação não apaga o original" |
| RF-08 | Registrar sinais vitais com faixas fisiológicas válidas | `prontuario.service.js:registrarSinaisVitais` | "recusa sinais impossíveis" |
| RF-09 | Alertar sinais vitais fora da faixa de referência | `prontuario.service.js:avaliarSinais` | "sinais fora da faixa geram alertas" |
| RF-10 | Prescrever medicamento com dose, via e frequência | `prontuario.service.js:prescrever` | "medicamento sem conflito passa" |
| RF-11 | Bloquear prescrição de medicamento com alergia registrada | `prontuario.service.js:prescrever` | "bloqueia prescrição com alergia" |
| RF-12 | Encerrar atendimento com desfecho e concluir prescrições ativas | `prontuario.service.js:encerrarAtendimento` | "encerrar conclui prescrições ativas" |

## Requisitos funcionais — Despacho (núcleo regulado)

| ID | Requisito | Implementação | Teste |
|---|---|---|---|
| RF-13 | Abrir chamado com localização e natureza da ocorrência | `despacho.service.js:abrirChamado` | "percorre a sequência completa" |
| RF-14 | Classificar o risco do chamado em 5 níveis | `despacho.service.js:triar` | "respeita a prioridade informada" |
| RF-15 | A triagem só agrava a prioridade, nunca alivia | `despacho.service.js:triar` | "nunca rebaixa prioridade grave" |
| RF-16 | Elevar prioridade por sinal crítico no relato | `despacho.service.js:triar` | "sinal crítico eleva ao máximo" |
| RF-17 | Elevar prioridade por natureza da ocorrência | `despacho.service.js:triar` | "natureza estabelece piso" |
| RF-18 | Sugerir a ambulância mais adequada (recurso, depois distância) | `despacho.service.js:escolherAmbulancia` | "prioridade alta escolhe USA" |
| RF-19 | Exigir USA para prioridades 1 e 2 | `despacho.service.js:CORES` | idem |
| RF-20 | Sinalizar ao operador o despacho de recurso abaixo do indicado | `escolherAmbulancia` + `despacho.js` | "sem USA sinaliza recurso inadequado" |
| RF-21 | Impedir despacho de ambulância já empenhada | `despacho.service.js:despachar` | "não despacha ambulância empenhada" |
| RF-22 | Registrar a linha do tempo completa da ocorrência | `despacho.service.js:registrarEvento` | "registra a linha do tempo" |
| RF-23 | Cancelar chamado com motivo e liberar a ambulância | `despacho.service.js:cancelarChamado` | "cancelamento exige motivo" |
| RF-24 | Admitir o paciente abrindo o atendimento com a triagem de campo | `despacho.service.js:admitirNoHospital` | "admissão preserva a classificação" |
| RF-25 | Calcular indicadores operacionais da central | `despacho.service.js:indicadores` | "contabiliza chamados e tempos" |

## Requisitos funcionais — App do paciente (trilha DevOps)

| ID | Requisito | Implementação | Teste |
|---|---|---|---|
| RF-26 | Paciente consulta seu perfil com CPF mascarado | `paciente.service.js:meuPerfil` | "perfil com CPF mascarado" |
| RF-27 | Paciente consulta apenas o próprio histórico | `paciente.service.js:meusAtendimentos` | "nunca vê atendimento de outro" |
| RF-28 | Paciente solicita ambulância pelo app | `paciente.service.js:solicitarAmbulancia` | "chamado entra na mesma fila" |
| RF-29 | Impedir dois chamados simultâneos do mesmo paciente | `paciente.service.js:solicitarAmbulancia` | "impede dois chamados" |
| RF-30 | Paciente acompanha o chamado com ETA em tempo real | `paciente.service.js:meuChamadoAtivo` | "acompanhamento mostra ETA" |
| RF-31 | Cada funcionalidade do app é controlada por feature flag | `flags.js` | "desligar a flag remove a função" |

## Requisitos não funcionais

| ID | Requisito | Implementação | Teste |
|---|---|---|---|
| RNF-01 | Autenticação com token assinado e expiração por turno (8h) | `lib/auth.js:emitirToken` | verificação em `verificarToken` |
| RNF-02 | Senha armazenada com derivação de chave (scrypt + sal) | `lib/auth.js:gerarHashSenha` | — |
| RNF-03 | Controle de acesso por papel em todas as rotas do núcleo | `nucleo/rbac.js` | `rbac.test.js` (7 testes) |
| RNF-04 | Segregação de funções: só médico prescreve | `rbac.js` + `registrarEvolucao` | "somente médico e admin prescrevem" |
| RNF-05 | Auditor é estritamente somente leitura | `rbac.js:PERMISSOES.auditor` | "auditor lê tudo e não escreve nada" |
| RNF-06 | Toda operação do núcleo gera registro de auditoria | `lib/audit.js:registrar` | "registra toda operação" |
| RNF-07 | A leitura do prontuário também é auditada (LGPD Art. 37) | `obterAtendimento` | "a leitura também é auditada" |
| RNF-08 | Trilha de auditoria imutável, encadeada por hash | `lib/audit.js` | "detecta adulteração" e "detecta remoção" |
| RNF-09 | Paciente não acessa nenhuma rota do núcleo regulado | `rbac.js:PERMISSOES.paciente` | "paciente não acessa o núcleo" |
| RNF-10 | Minimização de dado pessoal na interface do app | `paciente.service.js:mascararCpf` | "mascara CPF" |
| RNF-11 | Entrada validada por esquema antes de qualquer escrita | `lib/validate.js` | diversos |
| RNF-12 | Contrato entre as trilhas verificado automaticamente | `tests/contrato/` | 8 testes de contrato |
| RNF-13 | Evidência de teste retida por 365 dias para auditoria | `.github/workflows/nucleo-regulado.yml` | — |
| RNF-14 | Produção do núcleo exige aprovação formal registrada | `.github/workflows/nucleo-regulado.yml` (environment `production`) | — |

## Rastreabilidade

```
CTX-1.0 ──> RF-xx / RNF-xx ──> commit / PR ──> teste automatizado ──> evidência no pipeline
```

O script `scripts/verifica-seguranca.js` falha o build se RNF-03, RNF-04, RNF-05,
RNF-07, RNF-08 ou RNF-09 forem violados no código.
