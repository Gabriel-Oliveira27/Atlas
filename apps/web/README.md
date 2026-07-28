# Atlas Web

Aplicação web do Atlas (Next.js + PWA). Alvo de deploy: **https://atlas.vercel.app**

> **Esta fase entrega apenas o scaffold.** A interface será construída na
> próxima etapa, sobre a arquitetura já pronta — ver
> [`docs/task-list-frontend.md`](../../docs/task-list-frontend.md).

## O que já está definido para você consumir

| Recurso                                   | Onde                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| Contratos da API (envelope, tipos, enums) | `@atlas/shared`                                         |
| Schemas de formulário (os mesmos da API)  | `@atlas/validation`                                     |
| Endpoints e exemplos                      | `docs/api.md` e Swagger em `http://localhost:3333/docs` |
| Protocolo offline (IndexedDB)             | `docs/offline-sync.md`                                  |

## Como rodar

```bash
pnpm --filter @atlas/web dev
```

A API precisa estar no ar (`pnpm api:dev`) e `NEXT_PUBLIC_API_URL` apontando
para ela — por padrão `http://localhost:3333/api`.

## Decisões já tomadas (não precisam ser rediscutidas)

- **Estado de servidor**: React Query (cache, revalidação, offline).
- **Estado de UI**: Zustand (leve, sem boilerplate).
- **Estilo**: TailwindCSS.
- **Autenticação**: o callback do Google devolve os tokens no _fragmento_
  da URL (`#access_token=...`). A página `/auth/callback` lê o fragmento,
  guarda os tokens e limpa a URL.
- **Envelope de resposta**: toda rota devolve
  `{ success, data, meta }` ou `{ success, error, meta }` — trate uma vez,
  no cliente HTTP, e não em cada tela.
