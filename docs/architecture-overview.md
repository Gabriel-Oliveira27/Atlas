# Arquitetura do Atlas

## O problema que a arquitetura resolve

O Atlas é usado **dentro da academia**, onde o sinal costuma ser ruim. Se
o app depender de rede para registrar uma série, ele falha exatamente no
momento de uso. Daí decorrem as duas decisões que moldam todo o resto:

1. **O banco principal é local**, não na nuvem.
2. **O aplicativo é offline-first**: escreve no dispositivo e sincroniza depois.

Tudo o que segue existe para sustentar essas duas escolhas sem perder
consistência de dados.

---

## Contexto (C4 nível 1)

```mermaid
graph TB
    Aluno["👤 Aluno"]
    Professor["👤 Professor / Admin de academia"]
    Admin["👤 Administrador geral"]

    subgraph Atlas["Plataforma Atlas"]
        Web["Web (atlas.vercel.app)<br/>Next.js PWA"]
        Mobile["Atlas App<br/>Expo / Android"]
        AdminApp["Painel Admin<br/>Next.js"]
        API["API<br/>NestJS + Fastify"]
    end

    Local[("PostgreSQL local<br/>PRINCIPAL")]
    Neon[("Neon PostgreSQL<br/>redundância / failover")]
    Redis[("Redis<br/>filas e rate limit")]
    N8N["N8N<br/>workflows"]
    Cloudinary["Cloudinary<br/>mídias"]
    Google["Google OAuth"]
    IA["Provedores de IA<br/>Claude / OpenAI / Gemini"]

    Aluno --> Web
    Aluno --> Mobile
    Professor --> AdminApp
    Admin --> AdminApp

    Web --> API
    Mobile --> API
    AdminApp --> API

    API --> Local
    API -.->|"failover"| Neon
    API --> Redis
    API --> Cloudinary
    API --> Google
    API <-->|"webhooks"| N8N
    N8N --> IA
    Local <-->|"sincronização<br/>03:00 e 18:00"| Neon
```

---

## Contêineres (C4 nível 2)

```mermaid
graph LR
    subgraph Clientes
        W["Web PWA<br/>IndexedDB"]
        M["Atlas App<br/>SQLite"]
    end

    subgraph API["API NestJS"]
        Auth["Auth<br/>OAuth · JWT · RBAC"]
        Business["Módulos de negócio<br/>treinos · hidratação · avaliações"]
        SyncEngine["Motor de sincronização"]
        Router["DatabaseRouter<br/>escolhe o banco ativo"]
        AiLayer["Camada de IA<br/>agnóstica"]
    end

    subgraph Dados
        L[("Postgres local")]
        C[("Neon")]
        R[("Redis")]
    end

    W -->|"delta-sync"| SyncEngine
    M -->|"delta-sync"| SyncEngine
    W --> Business
    M --> Business

    Business --> Router
    SyncEngine --> Router
    Router -->|"preferencial"| L
    Router -.->|"contingência"| C
    SyncEngine <-->|"reconciliação"| C
    SyncEngine --> R
    AiLayer --> R
```

---

## Camadas dentro da API

Clean Architecture aplicada por feature (feature-first). Cada módulo tem
a mesma forma:

```
modules/<feature>/
  <feature>.controller.ts   apresentação — HTTP, validação, RBAC
  <feature>.service.ts      aplicação — casos de uso, transações
  <feature>.module.ts       composição — injeção de dependências
```

**A regra que sustenta o desacoplamento:** os serviços de negócio nunca
acessam `PrismaClient` diretamente — usam `PrismaService.db`, que devolve
o cliente do banco ativo. É por isso que o failover é invisível para eles.

```mermaid
graph TD
    Controller["Controller<br/>valida entrada, aplica RBAC"]
    Service["Service<br/>regra de negócio, transação"]
    PrismaService["PrismaService<br/>abstrai qual banco está ativo"]
    Router["DatabaseRouter<br/>monitora saúde e elege o nó"]
    Local[("Local")]
    Cloud[("Neon")]

    Controller --> Service
    Service --> PrismaService
    PrismaService --> Router
    Router --> Local
    Router -.-> Cloud
```

---

## Estratégia de dados em duas camadas

### Camada A — failover de servidor (Local ↔ Neon)

Um verificador roda a cada 15 s. Enquanto o banco local responde, ele
atende tudo. Se parar de responder, o Neon assume; quando o local volta,
o sistema reconcilia automaticamente.

```mermaid
stateDiagram-v2
    [*] --> Local: boot
    Local --> Nuvem: local não responde
    Nuvem --> Reconciliando: local voltou
    Reconciliando --> Local: alterações aplicadas
    Local --> Local: sincronização 03:00 / 18:00
    Nuvem --> Indisponivel: Neon também caiu
    Indisponivel --> Local: qualquer um voltou
```

### Camada B — delta-sync dos dispositivos

O app escreve no banco do dispositivo e sincroniza com `push`/`pull`
usando um cursor por dispositivo. Detalhes em
[`offline-sync.md`](offline-sync.md).

---

## Por que essas tecnologias

| Escolha                  | Motivo                                                                                  | ADR                                           |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| Turborepo + pnpm         | Cache incremental; workspaces sem hoisting fantasma                                     | [001](adr/001-monorepo-turborepo.md)          |
| NestJS sobre Fastify     | Estrutura do Nest com o throughput do Fastify                                           | [002](adr/002-nestjs-sobre-fastify.md)        |
| Postgres local principal | O uso acontece onde a rede falha                                                        | [003](adr/003-banco-local-principal.md)       |
| Outbox (`ChangeLog`)     | Detecta exclusões e preserva ordem — varrer `updatedAt` não faz nem uma coisa nem outra | [004](adr/004-sincronizacao-outbox.md)        |
| Camada de IA isolada     | Trocar (ou remover) o provedor sem tocar no domínio                                     | [005](adr/005-camada-ia-desacoplada.md)       |
| Zod compartilhado        | Uma regra de validação, usada pela API e pelos formulários                              | [006](adr/006-validacao-zod-compartilhada.md) |

---

## Fluxos principais

### Login com Google

```mermaid
sequenceDiagram
    participant U as Navegador
    participant A as API
    participant G as Google
    participant D as Banco

    U->>A: GET /auth/google
    A->>G: redirect
    G->>U: consentimento
    U->>A: GET /auth/google/callback
    A->>D: busca ou cria usuário
    A->>D: grava hash do refresh token
    A->>U: redirect com tokens no fragmento (#)
```

O token vai no **fragmento** (`#`), e não na query string: o fragmento
não é enviado ao servidor nem registrado em logs intermediários.

### Registro de treino offline

```mermaid
sequenceDiagram
    participant App as Atlas App
    participant SQLite as SQLite local
    participant API
    participant DB as Postgres

    App->>SQLite: grava série (version=1, clientGeneratedId)
    Note over App: sem rede — o usuário continua treinando
    App->>API: POST /sync/push (ao reconectar)
    API->>API: valida posse e allowlist
    API->>DB: aplica (Last-Write-Wins / união)
    API->>App: aceitos, rejeitados, conflitos
    App->>SQLite: atualiza cursor
```

---

## Segurança

| Camada         | Mecanismo                                                     |
| -------------- | ------------------------------------------------------------- |
| Autenticação   | Google OAuth 2.0                                              |
| Sessão         | JWT de acesso (15 min) + refresh rotativo (30 dias)           |
| Roubo de token | Detecção de reuso → revoga a família do dispositivo           |
| Armazenamento  | Apenas o **hash** do refresh token é gravado                  |
| Autorização    | RBAC em dois níveis (papel + permissão) e escopo por academia |
| Abuso          | Rate limit por IP via Redis                                   |
| Webhooks       | HMAC-SHA256 com janela de 5 min contra replay                 |
| Auditoria      | `AuditLog` com estado antes/depois                            |

Detalhes em [`auth-security.md`](auth-security.md).

---

## Limites conhecidos desta fase

Registrados aqui para não parecerem esquecimento:

- **Front-end não implementado** — é o escopo da próxima fase.
- **Módulos de negócio parciais** — `users`, `hydration`, `exercises`,
  `workouts` (ciclo de execução), `assessments`, `sync`, `ai` e `home`
  estão funcionais; criação de planos por professor, administração de
  academias e catálogo estão marcados no [roadmap](roadmap.md).
- **Store on-device ausente** — o protocolo servidor está pronto e
  validado; SQLite/IndexedDB vêm junto com os apps.
- **Filas BullMQ configuradas, mas pouco usadas** — a sincronização usa
  o agendador do Nest; mover para fila fará sentido quando houver mais
  de uma instância da API.
