# API do Atlas

Base: `http://localhost:3333/api`
Swagger: `http://localhost:3333/docs`

---

## Envelope de resposta

**Toda** rota responde neste formato. O front-end trata sucesso e erro em
um único lugar.

Sucesso:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "timestamp": "2026-07-27T18:00:00.000Z",
    "requestId": "req-1",
    "servedBy": "LOCAL",
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 47,
      "totalPages": 3,
      "hasNext": true,
      "hasPrevious": false
    }
  }
}
```

Erro:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos",
    "details": { "issues": [{ "path": "amountMl", "message": "Máximo de 5000 ml por registro" }] }
  },
  "meta": { "timestamp": "...", "requestId": "req-2" }
}
```

> **Reaja ao `code`, nunca à mensagem.** Mensagens mudam com tradução e
> revisão de texto; os códigos são contrato. Lista completa em
> `@atlas/shared` → `ERROR_CODES`.

`meta.servedBy` indica qual banco atendeu. Quando for `CLOUD`, o sistema
está em contingência — vale avisar o usuário.

---

## Autenticação

```
GET  /auth/google              inicia o login (redireciona)
GET  /auth/google/callback     retorno do Google (redireciona com tokens)
POST /auth/refresh             rotaciona o par de tokens
POST /auth/logout              encerra a sessão
GET  /auth/me                  dados da sessão
GET  /auth/providers           métodos de login habilitados
```

Após o callback, os tokens voltam no **fragmento** da URL:

```
http://localhost:3000/auth/callback#access_token=...&refresh_token=...&expires_in=900
```

O fragmento não é enviado ao servidor nem registrado em logs
intermediários — por isso não usamos query string.

Nas demais rotas:

```
Authorization: Bearer <access_token>
x-atlas-device-id: <identificador do dispositivo>   (opcional, recomendado)
```

---

## Sistema

```
GET /health          estado completo (bancos, Redis, nó ativo)
GET /health/live     liveness
GET /health/ready    readiness
```

---

## Home

```
GET /home
```

Agrega hidratação do dia, treino, peso, streak, progresso semanal, dicas,
avisos e último relatório — **em uma única chamada**.

---

## Usuários

```
GET    /users/me
PATCH  /users/me
PATCH  /users/me/preferences
GET    /users/me/water-goal/suggestion
POST   /users/me/weight
GET    /users/me/weight/history
GET    /users                       (requer user:read:any)
GET    /users/:id                   (requer user:read:any)
```

---

## Exercícios

```
GET /exercises                 lista com filtros
GET /exercises/muscle-groups   árvore de grupos e subgrupos
GET /exercises/equipment
GET /exercises/:id             detalhe completo
```

Filtros: `search`, `muscleGroupId`, `equipmentId`, `mechanic`, `force`,
`difficulty`, `stimulus`, `page`, `pageSize`.

`stimulus` ordena pelo estímulo escolhido — ex.: `stimulus=HYPERTROPHY`
traz primeiro os exercícios com maior nota de hipertrofia.

---

## Treinos

```
GET  /workouts/plans
GET  /workouts/plans/active
POST /workouts/sessions              inicia (409 se já houver aberta)
GET  /workouts/sessions/open
GET  /workouts/sessions
POST /workouts/sessions/:id/sets     registra uma série
POST /workouts/sessions/:id/finish   finaliza e consolida
```

Só existe **uma** sessão aberta por vez — duas fariam as séries caírem na
sessão errada.

---

## Hidratação

```
POST   /hydration/logs      registra consumo
GET    /hydration/today     resumo do dia
GET    /hydration/history   histórico agregado por dia
DELETE /hydration/logs/:id  remove (exclusão lógica)
GET    /hydration/reminder
PUT    /hydration/reminder
```

Envie `clientGeneratedId` ao registrar offline — é o que garante que o
mesmo copo de água não seja contado duas vezes.

---

## Avaliações

```
POST /assessments
GET  /assessments
GET  /assessments/compare?fromId=...&toId=...
GET  /assessments/:id
```

Se o `%BF` não for informado mas houver medidas de pescoço e cintura (e
quadril, para o cálculo feminino), a API estima pelo método US Navy.

---

## Sincronização

```
GET  /sync/status     estado atual         (requer sync:read)
POST /sync/trigger    disparo manual       (requer sync:trigger)
POST /sync/push       envia alterações do dispositivo
POST /sync/pull       busca alterações do servidor
```

Contrato completo em [`offline-sync.md`](offline-sync.md).

---

## IA

```
GET  /ai/reports                     relatórios do usuário
POST /ai/reports/generate            gera sob demanda (requer ai:request)
POST /ai/webhooks/weekly-report      webhook do n8n (assinatura HMAC)
```

---

## Mídia

```
GET /media/upload-signature?folder=avatars
```

Devolve assinatura para o cliente enviar o arquivo **direto ao
Cloudinary**. A API nunca recebe o binário — evita banda, memória e
timeout no servidor, e mantém o `api_secret` no back-end.

Pastas: `avatars`, `exercises`, `assessments`, `gyms`, `reports`.

---

## Códigos de status

| Código    | Quando                                        |
| --------- | --------------------------------------------- |
| 200 / 201 | Sucesso                                       |
| 204       | Sucesso sem corpo (logout)                    |
| 401       | Token ausente, inválido ou expirado           |
| 403       | Autenticado, mas sem permissão                |
| 404       | Recurso inexistente                           |
| 409       | Conflito (sessão já aberta, e-mail duplicado) |
| 422       | Falha de validação                            |
| 429       | Rate limit                                    |
| 503       | Nenhum banco disponível                       |

---

## Rate limit

Padrão: **120 requisições por minuto por IP** (`RATE_LIMIT_*` no `.env`).
O Fastify roda com `trustProxy`, então atrás de um proxy o limite é
aplicado ao IP real do cliente, e não ao do proxy.
