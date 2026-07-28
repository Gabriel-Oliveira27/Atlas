# Handoff — estado real do Atlas

> Escrito em **28/07/2026**, ao fim da sessão de fundação.
> Commits: `c687d75` (principal, 189 arquivos) · `2ef7a5b` (app, 38 arquivos).
> **Nada foi enviado ao GitHub** — os dois repositórios têm apenas commits locais.

Este documento existe para você não precisar redescobrir o que já foi
decidido, nem confiar em suposições sobre o que funciona. Ele separa
**o que foi verificado rodando** do **que só existe em código**.

---

## 1. Verificado funcionando (eu cliquei e vi)

| Item                    | Como foi comprovado                                                      |
| ----------------------- | ------------------------------------------------------------------------ |
| API no ar               | `GET /api/health` respondendo na porta **3333**                          |
| Neon conectado          | health reporta `up`, latência 115–665 ms                                 |
| Migrations no Neon      | `00000000000000_init` aplicada (1282 linhas de SQL)                      |
| Seed no Neon            | 24 permissões, 4 papéis, 7 grupos musculares, 12 exercícios, 3 dicas     |
| Front no ar             | Next.js na porta **3001** (a 3000 está ocupada — ver §6)                 |
| Login de dev            | Emite sessão de SUPER_ADMIN; a sidebar mostra o usuário do seed          |
| Home                    | Consome `/api/home`; mostrou hidratação, treino, streak, peso e dicas    |
| Hidratação **gravando** | Cliquei em 500 ml → anel foi a 20%, entrada apareceu, persistiu no Neon  |
| Exercícios              | 12 do seed, com grupo, equipamento e notas de estímulo                   |
| Status                  | Reflete o estado real das 3 dependências                                 |
| **Failover automático** | Postgres local fora → API assumiu o Neon sozinha e a UI avisou o usuário |
| Typecheck e testes      | API e web sem erro; 33 testes passando                                   |

O failover não foi um teste encenado: o banco local estava realmente
fora, e o sistema se comportou como projetado. É a única parte da
estratégia offline-first que já tem prova de funcionamento.

---

## 2. PENDENTE — Docker (bloqueia o banco local e o n8n)

**Nada de Docker está rodando.** Nenhum container foi criado, nenhuma
imagem baixada. O `docker-compose.yml` existe e está completo, mas
**nunca foi executado**.

### O que já foi consertado nesta sessão

O Docker Desktop não abria. Três causas, todas resolvidas:

1. **7 processos zumbis** (3× Docker Desktop, 2× backend, 2× docker-ai) — encerrados.
2. **`%LOCALAPPDATA%\Docker\run\dockerInference`** corrompido — o arquivo
   não podia ser lido nem excluído. Resolvido **renomeando a pasta**
   (`run.quebrado-<timestamp>`) e deixando o Docker recriá-la.
3. **`%LOCALAPPDATA%\docker-secrets-engine\engine.sock`** — mesmo defeito,
   mesma solução.

Após isso, ambos os sockets foram recriados com sucesso e os diálogos de
erro pararam. **Se um erro parecido reaparecer em outro socket, aplique a
mesma receita:** feche o Docker, renomeie a pasta que contém o socket,
recrie-a vazia, reabra.

### O que falta — exige o usuário

O serviço `com.docker.service` está **parado** (`StartupType: Manual`). O
prompt do UAC foi cancelado 3 vezes; ele não chega ao usuário pelo
processo do agente. **Não insista por ferramenta** — peça ao usuário para
abrir o PowerShell **como administrador** e rodar:

```powershell
Set-Service com.docker.service -StartupType Automatic; Start-Service com.docker.service
```

### Armadilha: o WSL está sem distribuição

`wsl -l -v` retorna **"não tem distribuições instaladas"**. O Docker
Desktop usa backend WSL2 e precisa provisionar a distro `docker-desktop`
no primeiro boot bem-sucedido. Isso demora **vários minutos** e pode
exigir `wsl --update`. Não conclua que travou cedo demais.

### Sequência depois que o Docker subir

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

Sobem 5 containers:

| Container        | Imagem               | Porta     | Para quê                        |
| ---------------- | -------------------- | --------- | ------------------------------- |
| `atlas-postgres` | `postgres:16-alpine` | **5433**  | Banco **principal** do sistema  |
| `atlas-redis`    | `redis:7-alpine`     | 6379      | Filas, cache, rate limit        |
| `atlas-n8n`      | `n8nio/n8n:latest`   | 5678      | Workflows de IA e sincronização |
| `atlas-pgadmin`  | `dpage/pgadmin4`     | 5050      | Inspeção do banco               |
| `atlas-minio`    | `minio/minio`        | 9000/9001 | S3 local (opcional)             |

> A porta **5433** é deliberada: evita conflito com um Postgres já
> instalado no Windows na 5432. Não "corrija" para 5432.

Depois:

```bash
pnpm --filter @atlas/database migrate:deploy   # migrations no banco LOCAL
pnpm --filter @atlas/database seed             # seed no banco LOCAL
```

**Importante:** o Neon já tem schema e seed. O banco local está vazio. Ao
subir, o `DatabaseRouter` vai preferir o local (que estará vazio) e a
Home ficará sem dados até o seed rodar. **Rode o seed antes de testar.**

### Verificação de que o n8n está de fato ok

Não basta o container estar "up":

1. Abrir `http://localhost:5678` (basic auth: `admin` / `atlas_n8n_password`).
2. Importar os workflows de `infra/n8n/workflows/`.
3. Conferir que o n8n alcança a API — os workflows chamam a API por
   webhook assinado com HMAC (`N8N_WEBHOOK_SECRET`). Se o segredo do
   `.env` divergir do configurado no n8n, a API rejeita com 401 e o
   sintoma é silencioso.

---

## 3. ANTES DO FRONT — blindagem e melhorias no back

Ordem pensada para que nenhum item force retrabalho no front depois.
As três primeiras são **bloqueantes**; as demais podem correr em paralelo
ao front.

### 3.1 🔴 Remover o `dev-login` e ligar o Google OAuth — BLOQUEANTE

`apps/api/src/modules/auth/dev-login.controller.ts` emite sessão de
**SUPER_ADMIN sem senha alguma**.

Existem três travas independentes (o controller nem é registrado fora de
`NODE_ENV=development`, valida o ambiente em runtime e loga um WARN alto
no boot). Ainda assim: **é uma porta dos fundos, e portas dos fundos
vazam.** Enquanto ela existir, ninguém pode publicar nada.

O que fazer:

1. Criar credenciais em `console.cloud.google.com/apis/credentials`.
2. Preencher `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env`.
3. Testar o fluxo real (`GET /api/auth/google`).
4. **Apagar o arquivo e a referência no `AuthModule`.**

O front já está pronto para os dois cenários: `/login` consulta
`GET /api/auth/providers` e troca o botão sozinho.

### 3.2 🔴 Rate limit compartilhado no Redis — BLOQUEANTE para produção

`apps/api/src/app.module.ts:52` — `ThrottlerModule.forRoot()` **sem
storage configurado**, ou seja, contador **em memória do processo**.

Consequências reais:

- Duas instâncias da API ⇒ o limite efetivo dobra.
- Todo restart zera os contadores ⇒ um atacante só precisa esperar um deploy.

Correção: `@nest-lab/throttler-storage-redis` (ou equivalente) apontando
para o Redis que o compose já sobe.

**Além disso, o limite hoje é único e global** (`RATE_LIMIT_MAX=120/min`
para tudo). Antes do front chegar, diferencie por rota — senão o front
vai ser escrito contra um comportamento que muda depois:

| Rota                      | Limite sugerido | Motivo                           |
| ------------------------- | --------------- | -------------------------------- |
| `POST /auth/*`            | 5–10 / min      | Alvo de força bruta              |
| `POST /sync/push`, `pull` | 10 / min        | Cargas grandes, custo alto       |
| `POST /ai/reports/*`      | 2–5 / hora      | Cada chamada custa dinheiro real |
| Leituras em geral         | 120 / min       | Atual serve                      |

### 3.3 🔴 Testes da API — BLOQUEANTE na prática

Os 33 testes que passam cobrem **apenas os packages**: `rbac.test.ts`,
`webhook-signature.test.ts`, `health.test.ts`.

**Nenhum teste toca a API.** Zero cobertura em controllers, guards, no
motor de sincronização e no fluxo de refresh token. Construir o front
inteiro sobre uma API sem teste significa que toda regressão vai ser
descoberta pela tela — o lugar mais caro e mais lento para descobrir.

Mínimo antes do front:

- **RBAC de verdade** (e2e): usuário comum recebe 403 nas rotas de admin;
  admin de academia **não** enxerga aluno de outra academia. Este é o
  teste que impede vazamento de dados entre academias.
- **Refresh token**: rotação funciona; **reuso de token revogado derruba a
  família inteira** (a lógica existe em `packages/auth` — falta e2e).
- **Sync**: `push` → `pull` fecha o ciclo; conflito vira registro em
  `SyncConflict` em vez de perder dado silenciosamente.
- **Envelope**: toda rota devolve `{ success, data, meta }`. O front
  inteiro depende desse formato.

### 3.4 🟡 Auditoria de escopo por academia

O `RbacGuard` é global e valida **papel**. O que ele **não** faz é garantir
que todo repositório filtre por `gymId`. Hoje isso depende de cada
service lembrar de aplicar o filtro.

Um `GYM_ADMIN` que consiga ler aluno de outra academia é o pior bug
possível neste produto. Faça uma varredura rota a rota antes do front, e
considere mover o filtro para o repositório base (`packages/database/src/repositories/base.repository.ts`)
em vez de confiar em cada chamada.

### 3.5 🟡 Idempotência além da hidratação

`POST /hydration/logs` aceita `clientGeneratedId` e é idempotente. As
demais rotas de escrita **não são**.

Isso importa porque o app é offline-first: a fila **vai** reenviar. Sem
idempotência, cada retry vira uma série duplicada no treino do usuário.

Aplique o mesmo padrão em `POST /workouts/sessions/:id/sets`,
`POST /workouts/sessions` e `POST /assessments`.

### 3.6 🟡 Paginação consistente

Confirme que **toda** rota de lista devolve `PaginationMeta` no envelope e
respeita `page`/`pageSize`, com um teto de `pageSize` (sugestão: 100).
Sem teto, um cliente pede `pageSize=100000` e derruba a API.

O front vai construir listas infinitas sobre esse contrato — mudá-lo
depois obriga a reescrever as telas.

### 3.7 🟡 Cloudinary

`CLOUDINARY_*` está vazio; o `MediaService` loga
`"Cloudinary não configurado"` no boot e as rotas de upload não
funcionam. Bloqueia: foto de perfil, mídia de exercício e fotos de
avaliação.

A rota `GET /media/upload-signature` já implementa **upload assinado** —
o arquivo vai do cliente direto ao Cloudinary, sem passar pela API. Não
troque isso por upload via API.

### 3.8 🟢 Observabilidade

O logger (pino) já redige `authorization` e `cookie`. Falta:

- `requestId` propagado em **todas** as respostas (o envelope já tem o
  campo — confirme que sempre é preenchido).
- Métricas de latência por rota.
- Alerta quando `activeDatabase` virar `CLOUD` — hoje o usuário vê o
  banner, mas **ninguém é notificado**. É o sinal de que o banco
  principal caiu.

### 3.9 🟢 Módulos com regra de negócio ainda em aberto

Apenas dois TODOs reais no código, ambos deliberados:

| Local                      | O que falta                                |
| -------------------------- | ------------------------------------------ |
| `exercises.service.ts:127` | CRUD de exercícios pelo super-admin        |
| `workouts.service.ts:327`  | Criação/atribuição de planos por professor |

Ambos são de **administração**, não do fluxo do aluno. O front do aluno
pode ser construído sem eles; o painel admin, não.

---

## 4. Ordem sugerida

```
1. Docker sobe (§2)  ──►  migrations + seed local  ──►  verificar n8n
2. §3.1  Google OAuth + apagar dev-login
3. §3.2  Rate limit no Redis + limites por rota
4. §3.3  Testes e2e de RBAC, refresh e sync
5. §3.4  Varredura de escopo por academia
6. §3.5–3.6  Idempotência e paginação
   └── a partir daqui o contrato está estável: front pode começar
7. §3.7–3.9  Cloudinary, observabilidade, CRUD admin (em paralelo ao front)
```

O corte no passo 6 é o que importa: **antes dele, o contrato da API ainda
pode mudar.** Começar o front antes disso gera retrabalho garantido.

---

## 5. Armadilhas que já custaram tempo nesta sessão

Registradas para não se repetirem.

| Armadilha                                       | Detalhe                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`tsBuildInfoFile` em tsconfig compartilhado** | Resolve relativo ao **arquivo de config**, não ao projeto. API e todos os packages gravavam no mesmo cache; cada build achava que já emitira tudo → `MODULE_NOT_FOUND` só em runtime. Por isso `incremental: false` em `packages/config/tsconfig/base.json` — **não religue sem ler o comentário lá.** |
| **Packages precisam de build**                  | O Nest roda em CommonJS e faz `require`. `main` aponta para `dist/`, não para `src/*.ts`. Rode `turbo run build --filter='./packages/*'` **antes** de subir a API.                                                                                                                                     |
| **Aspa sobrando na URL do Neon**                | O `.env` tinha `"'postgresql://...`. Falha silenciosa e confusa. Se o Neon "não conecta sem motivo", olhe o começo da string.                                                                                                                                                                          |
| **`pkill` não mata processo Windows**           | Use `Get-NetTCPConnection -LocalPort <p>` + `Stop-Process`. Senão você reinicia a API achando que reiniciou e continua testando a instância antiga.                                                                                                                                                    |
| **Socket corrompido do Docker**                 | Não tente excluir o arquivo — renomeie a **pasta**.                                                                                                                                                                                                                                                    |

---

## 6. Configuração do ambiente atual

- **Front na porta 3001**, não 3000. A 3000 está ocupada pelo dev server
  do projeto `C:\dev\landing-page` (rodando desde 23/07). `CORS_ORIGINS` e
  `NEXT_PUBLIC_APP_URL` já refletem a 3001. Se liberar a 3000, reverta os dois.
- **Segredos JWT no `.env` são de desenvolvimento** e estão marcados como
  tal. Gere novos para produção.
- **`.env` não está versionado** (só `.env.example`). O `.env` atual contém
  a credencial real do Neon — não commite.
- **App Android**: `apk/atlas-app`, **repositório git próprio**, ignorado
  pelo git do principal. Contratos entram por `npm run sync:contracts`
  (ver `docs/adr/007-app-repositorio-separado.md`).

---

## 7. Como subir tudo do zero

```bash
pnpm install
npx turbo run build --filter='./packages/*'     # obrigatório antes da API
docker compose -f infra/docker/docker-compose.yml up -d
pnpm --filter @atlas/database migrate:deploy
pnpm --filter @atlas/database seed
```

API (de um terminal, na raiz):

```bash
pnpm --filter @atlas/api dev
```

Web (de outro):

```bash
pnpm --filter @atlas/web dev -- --port 3001
```

Conferir em `http://localhost:3001/status` — é a página que mostra a
verdade sobre as três dependências, e funciona **sem login** justamente
para quando nada mais funciona.

---

---

## 8. Front-end — o que existe hoje (28/07/2026)

> Escrito depois da sessão de front. O §3 acima descreve a ordem
> planejada; parte dela foi feita em paralelo, em outro worktree.

**Web** (`apps/web`) — 12 rotas, `typecheck`, `lint` e `build` passando.
Verificado no navegador contra a API real: cadastro, login, home,
hidratação gravando, treino livre com série registrada (volume 800 kg
conferido), finalização com avaliação, evolução, perfil. Testado em
1280 px e em 360 px, sem estouro horizontal.

**App Android** (`apk/atlas-app`) — 12 telas em `expo-router`,
`tsc --noEmit` limpo. Espelha o web em funcionalidade, com o que é
próprio do aparelho: tokens no Keystore (`expo-secure-store`), vibração
ao fim do descanso, notificações locais de hidratação, deep link
`atlasapp://auth/callback`.

### Bugs pré-existentes corrigidos nesta sessão

| Onde                                       | O que estava quebrado                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `package.json` da raiz                     | `eslint.config.mjs` importa `@atlas/config`, que não estava nas devDependencies — **todo `lint` falhava**                |
| `apk/atlas-app/scripts/sync-contracts.mjs` | Copiava `@atlas/shared` sem reescrever ⇒ `TS2307`; e mantinha a extensão `.js`, que o Metro não resolve ⇒ bundle falhava |

Os dois eram invisíveis até alguém rodar `lint` ou empacotar o app.

### O que continua pendente no front

- **F1.4 / F1.5 — banco local e motor de sincronização.** As telas leem
  direto da rede. A escrita já manda `clientGeneratedId`, então a fila
  offline entra depois sem reescrever tela.
- **Fase 3 — painéis de administração** (`apps/admin` segue vazio).
- **Upload de mídia** — bloqueado pelas credenciais do Cloudinary (§3.7).

---

## Leitura recomendada, nesta ordem

1. `docs/architecture-overview.md` — visão geral e diagramas C4
2. `docs/adr/` — 7 decisões com o porquê de cada uma
3. `docs/offline-sync.md` — o protocolo, se for mexer em sincronização
4. `docs/auth-security.md` — antes de tocar em qualquer coisa de auth
5. `docs/task-list-frontend.md` — backlog de front já detalhado
