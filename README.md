# Atlas

Plataforma de gerenciamento de treinos, evolução física, hidratação e
administração de academias.

**Este repositório contém a web e a API.** O aplicativo Android é um
repositório separado, em `apk/atlas-app/`.

```
atlas/                    ← este repositório (web + api + admin)
└── apk/                  ← ignorado por este git
    ├── atlas-app/        ← repositório próprio (Expo / Android)
    └── versions/         ← APKs gerados
```

- **Web** — `atlas` → https://atlas.vercel.app
- **Admin** — painel de academias e plataforma
- **API** — NestJS sobre Fastify
- **Atlas App** — Android (Expo), em [`apk/atlas-app`](apk/atlas-app/README.md)

> **Esta fase entrega a fundação, não as interfaces.** A arquitetura, o
> banco, a API, a infraestrutura e a estratégia offline-first estão
> prontas para que o front-end seja construído em cima, sem mudanças
> estruturais. Backlog: [`docs/task-list-frontend.md`](docs/task-list-frontend.md).

---

## Começar

Pré-requisitos: **Node 20+**, **pnpm 9+**, **Docker Desktop**.

```bash
pnpm install
pnpm bootstrap      # verifica o ambiente e cria os .env
pnpm docker:up      # Postgres, Redis, n8n, pgAdmin, MinIO
pnpm db:migrate     # migrations no banco local
pnpm db:seed        # papéis, permissões, exercícios e admin
pnpm api:dev        # API em http://localhost:3333
```

Verificação rápida:

```bash
curl http://localhost:3333/api/health
```

Documentação interativa da API: http://localhost:3333/docs

## Serviços locais

| Serviço    | URL                       | Observação                                                            |
| ---------- | ------------------------- | --------------------------------------------------------------------- |
| API        | http://localhost:3333/api | Swagger em `/docs`                                                    |
| PostgreSQL | `localhost:5433`          | **5433** para não conflitar com um PostgreSQL já instalado no Windows |
| Redis      | `localhost:6379`          | Filas e rate limit                                                    |
| n8n        | http://localhost:5678     | `admin` / `atlas_n8n_password`                                        |
| pgAdmin    | http://localhost:5050     | `admin@atlas.local`                                                   |
| MinIO      | http://localhost:9001     | Console S3 local                                                      |

## Estrutura

```
apps/
  api/        NestJS + Fastify        ← entregue e funcional
  web/        Next.js PWA (atlas)     ← scaffold
  admin/      Next.js (admin)         ← scaffold
packages/
  database/     Prisma, cliente duplo local/Neon, seed
  auth/         JWT, rotação de refresh, RBAC, assinatura de webhook
  shared/       tipos, enums, erros, utilitários (back + front)
  validation/   schemas Zod usados pela API e pelos formulários
  ai/           camada de IA agnóstica (Claude, OpenAI, Gemini)
  config/       presets de TS/ESLint/Prettier
  ui/           componentes compartilhados (a construir)
infra/
  docker/       docker-compose e init do banco
  n8n/          workflows
  scripts/      bootstrap, migrate-both
docs/           arquitetura, ADRs, modelo de dados, sync, roadmap

apk/            (fora deste git)
  atlas-app/    repositório próprio do aplicativo Android
  versions/     APKs gerados
```

### Contratos compartilhados com o app

O app não está no workspace pnpm, então não importa `@atlas/shared` por
`workspace:*`. Ele **copia** os contratos do repo principal:

```bash
cd apk/atlas-app && npm run sync:contracts
```

A fonte da verdade continua aqui; o app fica com uma cópia versionada em
`src/contracts/` para compilar sozinho. Rode o sync depois de alterar
`packages/shared` ou `packages/validation` — e ver
[ADR 007](docs/adr/007-app-repositorio-separado.md) para o porquê.

## Documentação

> **Retomando o trabalho? Comece por [`docs/HANDOFF.md`](docs/HANDOFF.md).**
> Ele registra o que está de fato rodando, o que está pendente (Docker,
> banco local, n8n) e o que precisa ser blindado na API **antes** de
> construir o front.

| Documento                                                 | Conteúdo                                 |
| --------------------------------------------------------- | ---------------------------------------- |
| [**HANDOFF.md**](docs/HANDOFF.md)                         | **Estado atual, pendências e bloqueios** |
| [architecture-overview.md](docs/architecture-overview.md) | Visão geral, diagramas C4                |
| [adr/](docs/adr/)                                         | Decisões arquiteturais e seus porquês    |
| [data-model.md](docs/data-model.md)                       | Entidades e relacionamentos              |
| [offline-sync.md](docs/offline-sync.md)                   | Estratégia offline-first e sincronização |
| [auth-security.md](docs/auth-security.md)                 | OAuth, JWT, RBAC, auditoria              |
| [api.md](docs/api.md)                                     | Rotas e contratos                        |
| [runbook.md](docs/runbook.md)                             | Operação e resolução de problemas        |
| [roadmap.md](docs/roadmap.md)                             | MVP → Beta → Produção                    |
| [task-list-frontend.md](docs/task-list-frontend.md)       | Backlog detalhado do front-end           |

## Comandos

```bash
pnpm dev              # tudo em paralelo (Turborepo)
pnpm lint             # ESLint
pnpm typecheck        # tipos
pnpm test             # Vitest
pnpm build            # build de todos os pacotes

pnpm docker:up        # sobe os serviços
pnpm docker:down      # derruba
pnpm docker:reset     # derruba E APAGA OS VOLUMES (perde dados)

pnpm db:migrate       # migrations no banco local
pnpm db:migrate:both  # migrations no local E no Neon
pnpm db:seed          # popula dados iniciais
pnpm db:studio        # Prisma Studio
```

## Configuração pendente

O `.env` já vem com valores de desenvolvimento. Estes precisam dos seus
dados para funcionar por completo:

| Variável                      | Onde obter                                                                | Sem ela                                    |
| ----------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| `DATABASE_URL_CLOUD`          | [Neon](https://console.neon.tech) → Connection string (Pooled)            | Sem failover nem sincronização com a nuvem |
| `GOOGLE_CLIENT_ID` / `SECRET` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | Login indisponível                         |
| `CLOUDINARY_*`                | [Cloudinary](https://console.cloudinary.com)                              | Uploads de mídia indisponíveis             |
| `ANTHROPIC_API_KEY`           | [Anthropic Console](https://console.anthropic.com)                        | Relatórios de IA indisponíveis             |

**Redirect URIs a autorizar no Google:**

```
http://localhost:3333/api/auth/google/callback
```

## Licença

Projeto privado.
