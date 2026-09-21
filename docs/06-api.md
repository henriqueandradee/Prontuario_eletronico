# Referência da API

Autenticação: `Authorization: Bearer <token>` em todas as rotas, exceto as marcadas
como públicas. O token vem de `POST /api/login` e vale 8 horas.

Formato de resposta:

```json
{ "ok": true,  "dados": { } }
{ "ok": false, "erro": "mensagem", "detalhes": ["..."] }
```

---

## Sistema

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/api/saude` | pública | Estado, versão e baseline |
| GET | `/api/info` | pública | Trilhas, papéis e tabela de classificação de risco |
| POST | `/api/login` | pública | Autentica e devolve token + permissões |
| GET | `/api/eu` | autenticado | Dados da sessão atual |

## Núcleo regulado — Prontuário

| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/nucleo/pacientes?busca=` | `paciente:ler` |
| POST | `/api/nucleo/pacientes` | `paciente:criar` |
| GET | `/api/nucleo/pacientes/:id` | `paciente:ler` |
| POST | `/api/nucleo/pacientes/:id/alergias` | `alergia:registrar` |
| GET | `/api/nucleo/atendimentos?status=&paciente_id=` | `atendimento:ler` |
| POST | `/api/nucleo/atendimentos` | `atendimento:abrir` |
| GET | `/api/nucleo/atendimentos/:id` | `atendimento:ler` |
| PATCH | `/api/nucleo/atendimentos/:id` | `atendimento:atualizar` |
| POST | `/api/nucleo/atendimentos/:id/encerrar` | `atendimento:encerrar` |
| POST | `/api/nucleo/atendimentos/:id/evolucoes` | `evolucao:registrar` |
| POST | `/api/nucleo/atendimentos/:id/sinais-vitais` | `sinais:registrar` |
| POST | `/api/nucleo/atendimentos/:id/prescricoes` | `prescricao:criar` |
| PATCH | `/api/nucleo/prescricoes/:id` | `prescricao:atualizar` |

## Núcleo regulado — Despacho

| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/nucleo/chamados?status=` | `chamado:ler` |
| POST | `/api/nucleo/chamados` | `chamado:abrir` |
| GET | `/api/nucleo/chamados/:id` | `chamado:ler` |
| GET | `/api/nucleo/chamados/:id/sugestao` | `chamado:despachar` |
| POST | `/api/nucleo/chamados/:id/despachar` | `chamado:despachar` |
| POST | `/api/nucleo/chamados/:id/avancar` | `chamado:atualizar` |
| POST | `/api/nucleo/chamados/:id/cancelar` | `chamado:cancelar` |
| POST | `/api/nucleo/chamados/:id/admitir` | `atendimento:abrir` |
| GET | `/api/nucleo/ambulancias` | `ambulancia:ler` |
| PATCH | `/api/nucleo/ambulancias/:id` | `ambulancia:atualizar_status` |
| GET | `/api/nucleo/indicadores` | `chamado:ler` |

## Núcleo regulado — Auditoria

| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/nucleo/auditoria?entidade=&limite=` | `auditoria:ler` |
| GET | `/api/nucleo/auditoria/integridade` | `auditoria:ler` |

## App do paciente

| Método | Rota | Acesso |
|---|---|---|
| GET | `/api/app/flags` | pública |
| PATCH | `/api/app/flags/:chave` | somente `admin` |
| GET | `/api/app/perfil` | papel `paciente` |
| GET | `/api/app/atendimentos` | papel `paciente` |
| GET | `/api/app/atendimentos/:id` | papel `paciente`, apenas os próprios |
| POST | `/api/app/ambulancia` | papel `paciente` |
| GET | `/api/app/ambulancia` | papel `paciente` |

---

## Exemplos

### Login

```bash
curl -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"marcos@hospital.local","senha":"senha123"}'
```

### Abrir chamado com triagem automática

```bash
curl -X POST http://localhost:3000/api/nucleo/chamados \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "solicitante_nome": "Vizinha - Ana",
    "endereco": "Rua das Flores, 200 - Centro",
    "lat": -26.3050, "lng": -48.8490,
    "natureza": "clinico",
    "descricao": "Homem caiu e esta inconsciente",
    "prioridade": 4
  }'
```

A prioridade informada foi 4, mas a resposta devolve **P1 / vermelho**: a palavra
"inconsciente" no relato dispara a elevação automática, e `triagem.motivos`
explica o porquê.

### Verificar a integridade da trilha

```bash
curl http://localhost:3000/api/nucleo/auditoria/integridade \
  -H "Authorization: Bearer $TOKEN_AUDITOR"
```

## Códigos de erro

| Código | Significado |
|---|---|
| 400 | Dados inválidos — `detalhes` lista cada campo |
| 401 | Token ausente, inválido ou expirado |
| 403 | O papel não possui a permissão exigida |
| 404 | Recurso não encontrado |
| 409 | Conflito de regra de negócio (alergia, duplicidade, transição inválida) |
| 413 | Corpo da requisição muito grande |
