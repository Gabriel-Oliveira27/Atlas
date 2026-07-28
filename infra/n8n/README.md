# N8N — Workflows do Atlas

O n8n roda no Docker (`http://localhost:5678`) com persistência em
PostgreSQL (banco `n8n`, no mesmo container do banco principal).

Credenciais padrão de desenvolvimento: `admin` / `atlas_n8n_password`
(definidas em `infra/docker/.env`).

## Workflows

| Arquivo                      | O que faz                                     | Quando roda        |
| ---------------------------- | --------------------------------------------- | ------------------ |
| `01-relatorio-semanal.json`  | Gera o relatório semanal com IA e monta o PDF | Segundas, 06:00    |
| `02-sincronizacao.json`      | Dispara a sincronização local ↔ Neon          | 03:00 e 18:00      |
| `03-analise-hidratacao.json` | Avisa quem está abaixo da meta de água        | Diariamente, 20:00 |

## Como importar

Os workflows ficam montados dentro do container em `/workflows` (somente
leitura). No n8n: **Workflows → Import from File** e escolha o arquivo.

## Variáveis usadas pelos workflows

Definidas em `infra/docker/.env` e injetadas no container:

| Variável               | Para quê                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATLAS_API_URL`        | Como o n8n alcança a API. Em desenvolvimento é `http://host.docker.internal:3333/api` — o container precisa sair para o host, `localhost` apontaria para ele mesmo. |
| `ATLAS_WEBHOOK_SECRET` | Segredo compartilhado da assinatura HMAC dos webhooks.                                                                                                              |

## Autenticação

Os nós HTTP usam credencial do tipo **Header Auth**. Crie uma vez no n8n:

- **Name**: `Atlas API`
- **Header Name**: `Authorization`
- **Header Value**: `Bearer <token de um usuário SUPER_ADMIN>`

A API valida o token normalmente — o n8n é apenas mais um cliente, sujeito
ao mesmo RBAC.

## Webhooks de volta para a API

O workflow do relatório semanal chama
`POST /api/ai/webhooks/weekly-report` com o header `x-atlas-signature`.

A assinatura é HMAC-SHA256 no formato `t=<timestamp>,v1=<hash>`, sobre
`<timestamp>.<corpo>`, usando `N8N_WEBHOOK_SECRET`. **Sem assinatura
válida a API responde 401** — é o que impede alguém de injetar um
relatório falso.

Implementação de referência:
[`packages/auth/src/webhook-signature.ts`](../../packages/auth/src/webhook-signature.ts).

## Rotas ainda a implementar

Dois workflows chamam rotas administrativas que estão no roadmap (Beta):

- `GET /admin/users/active`
- `GET /admin/hydration/below-goal`
- `POST /notifications/send`

Os workflows já estão prontos e passam a funcionar assim que as rotas
existirem.
