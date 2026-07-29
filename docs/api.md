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

`meta.requestId` volta também no header `x-request-id`. Se o cliente
enviar esse header, a API o reaproveita: é o que permite correlacionar o
clique do usuário com a linha de log do servidor.

---

## Paginação

Toda rota de lista aceita `page` e `pageSize` e devolve
`meta.pagination`. **`pageSize` máximo é 100** — acima disso a resposta é
`422 VALIDATION_ERROR`, não um silencioso truncamento.

Rotas paginadas: `/users`, `/exercises`, `/workouts/plans`,
`/workouts/sessions`, `/assessments`, `/users/me/weight/history`,
`/hydration/history`, `/ai/reports`.

---

## Idempotência

As rotas de escrita que o app offline reenvia aceitam
`clientGeneratedId` (string, até 64 caracteres). Reenviar o mesmo id
devolve o registro já criado, com o mesmo `id`, em vez de duplicar:

| Rota                               | Chave de unicidade             |
| ---------------------------------- | ------------------------------ |
| `POST /hydration/logs`             | `userId` + `clientGeneratedId` |
| `POST /workouts/sessions`          | `userId` + `clientGeneratedId` |
| `POST /workouts/sessions/:id/sets` | sessão + `clientGeneratedId`   |
| `POST /assessments`                | avaliado + `clientGeneratedId` |

A fila offline **vai** reenviar. Sem o id, cada retry vira uma série a
mais no treino do usuário.

---

## Rate limit

| Família | Limite    | Rotas                              |
| ------- | --------- | ---------------------------------- |
| auth    | 10 / min  | register, login, password, refresh |
| sync    | 10 / min  | push, pull, trigger                |
| IA      | 5 / hora  | reports/generate                   |
| padrão  | 120 / min | todo o resto                       |

Ao estourar: `429` com `RATE_LIMITED` e
`error.details.retryAfterSeconds`. A contagem é por usuário quando há
token válido, por IP quando não há.

---

## Autenticação

```
POST /auth/register            cria conta (e-mail + senha; CPF/telefone opcionais)
POST /auth/login               entra com e-mail, CPF OU telefone + senha
POST /auth/first-access        define a senha de uma conta nunca ativada
POST /auth/password            define a primeira senha ou troca a atual
GET  /auth/google              inicia o login com Google (redireciona)
GET  /auth/google/callback     retorno do Google (redireciona com tokens)
POST /auth/refresh             rotaciona o par de tokens
POST /auth/logout              encerra a sessão
GET  /auth/me                  dados da sessão
GET  /auth/providers           métodos de login habilitados
```

### Login por credenciais

```json
POST /auth/login
{ "identifier": "aluno@atlas.test", "password": "...", "deviceId": "opcional" }
```

`identifier` é **um campo só**: aceita e-mail, CPF (com ou sem
pontuação) ou telefone (em qualquer formatação brasileira). A API
descobre qual é — a tela não precisa perguntar.

Erros possíveis:

| Código                  | Status | Quando                                  |
| ----------------------- | ------ | --------------------------------------- |
| `INVALID_CREDENTIALS`   | 401    | senha errada **ou** conta inexistente   |
| `USER_INACTIVE`         | 403    | conta desativada                        |
| `PASSWORD_NOT_SET`      | 409    | entrou por Google e nunca definiu senha |
| `FIRST_ACCESS_REQUIRED` | 409    | conta nunca ativada — ver abaixo        |
| `RATE_LIMITED`          | 429    | mais de 10 tentativas por minuto        |

Os dois primeiros são o mesmo código de propósito — ver
`docs/auth-security.md`.

### Primeiro acesso

Contas criadas pela academia nascem sem senha. O login devolve
`FIRST_ACCESS_REQUIRED`, e a tela deve **virar** o formulário de criação
de senha em vez de mostrar um erro sem saída.

```json
POST /auth/first-access
{ "identifier": "025.157.183-10", "activationCode": "ABCD-2345", "newPassword": "..." }
```

O código de ativação é entregue fora do app (impresso, no balcão) —
saber o CPF não basta para tomar a conta. Aceita minúsculas, espaços e
hífen; é de uso único e vale 7 dias.

Identificador desconhecido, código errado, código expirado e conta que
já tem senha devolvem todos `401 ACTIVATION_CODE_INVALID`, com a mesma
mensagem.

### Cadastro

```json
POST /auth/register
{ "name": "...", "email": "...", "password": "...", "cpf": "opcional", "phone": "opcional" }
```

CPF e telefone são gravados na forma canônica (11 dígitos; E.164) e são
únicos. Conflito devolve o código do **campo exato**, para o formulário
destacar o certo: `EMAIL_ALREADY_REGISTERED`, `CPF_ALREADY_REGISTERED`
ou `PHONE_ALREADY_REGISTERED`.

### Providers

```json
GET /auth/providers
{ "google": false, "credentials": true, "identifiers": ["email", "cpf", "phone"] }
```

Monte a tela de login a partir desta resposta: quando o Google OAuth for
configurado, `google` vira `true` e o botão aparece sem mudança no front.

### Google OAuth

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
GET    /users/me/weight/history      paginado
GET    /users                       (requer user:read:any) paginado
GET    /users/:id                   (requer user:read:any)
```

`GET /users` e `GET /users/:id` são **escopados pela academia**: um
`GYM_ADMIN` só enxerga a própria unidade; só o `SUPER_ADMIN` atravessa.

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
GET  /workouts/plans                 paginado
GET  /workouts/plans/active
POST /workouts/sessions              inicia (409 se já houver aberta)
GET  /workouts/sessions/open
GET  /workouts/sessions              paginado; ?userId= para staff
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
GET  /assessments                              (aceita ?userId= para staff)
GET  /assessments/compare?fromId=...&toId=...
GET  /assessments/:id
```

Se o `%BF` não for informado mas houver medidas de pescoço e cintura (e
quadril, para o cálculo feminino), a API estima pelo método US Navy.

`userId` (no corpo do POST ou na query do GET) permite ao professor
avaliar e acompanhar um aluno. O escopo é validado: um profissional da
academia A recebe **403** ao tentar alcançar aluno da academia B.

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
