# Handoff — estado real do Atlas

> Atualizado em **28/07/2026**, ao fim da sessão de blindagem pré-front.
> A sessão anterior (fundação) deixou §2 e §3 em aberto; ambos foram
> resolvidos e o registro está abaixo.
> **Nada foi enviado ao GitHub** — os dois repositórios têm apenas commits locais.

Este documento existe para você não precisar redescobrir o que já foi
decidido, nem confiar em suposições sobre o que funciona. Ele separa
**o que foi verificado rodando** do **que só existe em código**.

---

## 1. Verificado funcionando

| Item                    | Como foi comprovado                                                        |
| ----------------------- | -------------------------------------------------------------------------- |
| API no ar               | `GET /api/health` respondendo, banco ativo `LOCAL`                         |
| **Docker de pé**        | 5 containers: postgres, redis, n8n, pgadmin, minio                         |
| Neon conectado          | health reporta `up`, latência ~116 ms                                      |
| Migrations              | `00000000000000_init` + `20260728010000_login_credenciais_e_idempotencia`  |
| Seed no banco local     | 24 permissões, 4 papéis, 7 grupos musculares, 12 exercícios, 3 dicas       |
| n8n                     | `GET localhost:5678/healthz` → 200                                         |
| **Login por senha**     | `POST /auth/login` com o admin do seed → sessão emitida                    |
| **dev-login removido**  | a rota devolve 404                                                         |
| Paginação               | `/exercises?pageSize=3` → `meta.pagination` completo; `100000` → 422       |
| requestId               | `x-request-id` enviado volta no header E no envelope                       |
| **Failover automático** | Postgres local fora → API assumiu o Neon sozinha e a UI avisou o usuário   |
| Painel admin            | `pnpm --filter @atlas/admin dev` na **3002**, renderiza e faz `next build` |
| Typecheck               | `pnpm -r run typecheck` limpo — **sem precisar de filtro**                 |
| Lint                    | `pnpm -r run lint` limpo nos 9 projetos                                    |
| Formatação              | `prettier --check` limpo                                                   |
| **Testes**              | **131 passando** — 66 nos packages, 65 e2e da API                          |

O failover não foi um teste encenado: o banco local estava realmente
fora, e o sistema se comportou como projetado.

---

## 2. Docker — RESOLVIDO

Os 5 containers subiram e estão de pé:

| Container        | Porta     | Estado                        |
| ---------------- | --------- | ----------------------------- |
| `atlas-postgres` | **5433**  | healthy — banco **principal** |
| `atlas-redis`    | 6379      | healthy — filas e rate limit  |
| `atlas-n8n`      | 5678      | up, `/healthz` → 200          |
| `atlas-pgadmin`  | 5050      | up                            |
| `atlas-minio`    | 9000/9001 | healthy                       |

> A porta **5433** é deliberada: evita conflito com um Postgres já
> instalado no Windows na 5432. Não "corrija" para 5432.

Migrations e seed foram aplicados no banco local. O admin do seed agora
nasce **com senha** (ver §3.1).

### Armadilhas que custaram tempo aqui

| Sintoma                                             | Causa e solução                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Desktop não abria                            | Sockets corrompidos em `%LOCALAPPDATA%`. **Renomeie a PASTA** que contém o socket e deixe o Docker recriá-la — excluir o arquivo não funciona. |
| `atlas-pgadmin` em loop de reinício                 | O pgAdmin recusa e-mail com TLD reservado. `admin@atlas.local` era inválido; o padrão agora é `admin@atlas.dev`.                               |
| `prisma migrate dev` falha                          | É interativo e não roda por ferramenta. Use `migrate diff` para gerar o SQL e `migrate deploy` para aplicar.                                   |
| Migration com erro de sintaxe no primeiro caractere | `Out-File -Encoding utf8` do PowerShell escreve BOM, e o Postgres não engole. Escreva o `.sql` sem BOM.                                        |

### Verificação do n8n

O container estar "up" não basta:

1. Abrir `http://localhost:5678` (basic auth: `admin` / `atlas_n8n_password`).
2. Importar os workflows de `infra/n8n/workflows/`.
3. Conferir que o n8n alcança a API — os workflows chamam a API por
   webhook assinado com HMAC (`N8N_WEBHOOK_SECRET`). Se o segredo do
   `.env` divergir do configurado no n8n, a API rejeita com 401 e o
   sintoma é silencioso.

**Ainda não feito:** os passos 2 e 3. O container responde, mas nenhum
workflow foi importado.

---

## 3. Blindagem pré-front — CONCLUÍDA (§3.1 a §3.6 e §3.8)

### 3.1 ✅ Autenticação de verdade — o `dev-login` morreu

`dev-login.controller.ts` foi **apagado**, junto com a referência no
`AuthModule`. A rota devolve 404.

No lugar dele entrou login por credenciais com **campo único de
identificador**: o usuário digita e-mail, CPF **ou** telefone, e a API
descobre qual é (`resolveLoginIdentifier` em `@atlas/shared`). Pedir que
ele escolha a aba certa é pedir que lembre com o que se cadastrou.

| Rota                  | O que faz                                              |
| --------------------- | ------------------------------------------------------ |
| `POST /auth/register` | cadastro; e-mail obrigatório, CPF e telefone opcionais |
| `POST /auth/login`    | `{ identifier, password }` — aceita os três tipos      |
| `POST /auth/password` | define a primeira senha ou troca a atual               |
| `GET /auth/providers` | anuncia `{ google, credentials, identifiers }`         |

Decisões que importam:

- **CPF e telefone são normalizados antes de gravar** (11 dígitos sem
  pontuação; telefone em E.164). Sem isso, `529.982.247-25` e
  `52998224725` criariam duas contas, cada uma passando na constraint de
  unicidade. O CPF é validado pelos dígitos verificadores.
- **Falha de login é sempre `INVALID_CREDENTIALS`**, e o bcrypt roda
  mesmo quando o usuário não existe — distinguir "conta inexistente" de
  "senha errada", por código ou por tempo de resposta, entregaria a
  lista de quem tem conta no Atlas.
- **`PASSWORD_NOT_SET`** é a única exceção: a conta entrou por Google e
  nunca definiu senha. Sem esse código a pessoa ficaria tentando senhas
  que não existem.
- O admin do seed nasce com senha. Em desenvolvimento é
  `atlas-admin-2026`; em produção defina `SEED_ADMIN_PASSWORD`.

**O Google OAuth continua pronto e desligado** — falta preencher
`GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. O front lê
`/auth/providers` e mostra o botão sozinho quando isso acontecer.
Passo a passo em [`google-oauth-setup.md`](google-oauth-setup.md).

### 3.2 ✅ Rate limit no Redis, por família de rota

O contador saiu da memória do processo e foi para o Redis
(`RedisThrottlerStorage`): o limite passa a ser do sistema e sobrevive a
restart. Quando o Redis cai, degrada para contagem em memória com um
WARN — recusar tudo transformaria queda do Redis em queda do Atlas.

| Família | Limite    | Rotas                              |
| ------- | --------- | ---------------------------------- |
| `auth`  | 10 / min  | register, login, password, refresh |
| `sync`  | 10 / min  | push, pull, trigger                |
| `ai`    | 5 / hora  | reports/generate                   |
| padrão  | 120 / min | todo o resto                       |

Ajustáveis por ambiente (`RATE_LIMIT_AUTH_MAX` etc.) — apertar um limite
sob ataque não deveria exigir deploy.

> ⚠️ **Armadilha do `@nestjs/throttler`:** todo throttler declarado no
> módulo é avaliado em TODA rota. Declarar o de IA (5/hora) e supor que
> ele vale só para `/ai/*` faz a API inteira responder 429 depois de
> cinco requisições. Foi exatamente o que aconteceu, e o que os testes
> pegaram. O isolamento está em `buildThrottlers` + `@ThrottleFamily`.
> Não declare um throttler novo sem passar por lá.

A contagem é **por usuário** quando há token válido, e por IP quando não
há. Numa academia inteira atrás do mesmo NAT, contar por IP faria o
primeiro usuário consumir a cota de todos.

### 3.3 ✅ Testes e2e da API — 65, contra Postgres de verdade

`apps/api/test/`, banco `atlas_test`, aplicação real via `app.inject()`.
Nada de mock: um teste de vazamento entre academias contra um Prisma
falso provaria apenas que o falso foi bem escrito.

| Arquivo                  | Cobre                                                    |
| ------------------------ | -------------------------------------------------------- |
| `auth.e2e.test.ts`       | login pelos 3 identificadores, rotação de refresh, reuso |
| `rbac.e2e.test.ts`       | permissão por papel e **escopo por academia**            |
| `sync.e2e.test.ts`       | push→pull, conflito persistido, payload hostil           |
| `contract.e2e.test.ts`   | envelope, requestId, paginação, idempotência             |
| `rate-limit.e2e.test.ts` | limites, isolamento entre famílias, contagem por usuário |

Para rodar, **o Docker precisa estar de pé** (Postgres e Redis):

```bash
pnpm --filter @atlas/api test
```

> **Uma execução por vez no `atlas_test`.** As suítes truncam tabelas no
> `beforeEach`; duas rodadas simultâneas apagam as linhas uma da outra e
> a falha mente — vira um `P2025` ("Record to update not found") no meio
> de um login que acabou de achar o usuário. Para rodar em paralelo, dê
> um banco a cada execução com `TEST_DATABASE_URL`.

> O Vitest da API usa **SWC**, não esbuild. O Nest resolve dependências
> pelos tipos do construtor, que só existem em runtime se o compilador
> emitir `design:paramtypes` — o esbuild não emite, e o sintoma é
> confuso: todos os serviços sobem com as dependências `undefined`.

### 3.4 ✅ Escopo por academia — três vazamentos fechados

Todos reais, todos com teste que falha se voltarem:

1. **`POST /assessments` aceitava `userId` do corpo sem checagem
   alguma.** Qualquer conta com `assessment:create` gravava avaliação na
   ficha de qualquer usuário do sistema, inclusive de outra academia.
2. **`GET /exercises/:id` não filtrava por academia.** A listagem
   escondia os exercícios exclusivos de outra unidade; o detalhe
   entregava, bastando ter o id.
3. **`POST /sync/push` podia sobrescrever registro alheio.** A
   verificação de posse olhava o `userId` do _payload_ — texto vindo do
   cliente. Mandando o `entityId` de um registro da vítima com o próprio
   id no payload, o update passava, sobrescrevia e reatribuía o dado.

A checagem virou serviço (`UserScopeService`, global): toda rota que
aceita um `userId` de fora passa por ele. Antes, dependia de cada
service lembrar — e bastava um esquecimento.

### 3.5 ✅ Idempotência em todas as escritas

`clientGeneratedId` agora existe em `SetLog` e `Assessment` (com unique
no schema), somando-se a `HydrationLog` e `WorkoutLog`. O app é
offline-first e a fila **vai** reenviar; sem isso, cada retry viraria
uma série a mais no treino do usuário.

### 3.6 ✅ Paginação consistente

`/workouts/plans`, `/workouts/sessions`, `/assessments`,
`/users/me/weight/history`, `/hydration/history` e `/ai/reports`
devolvem `meta.pagination` completo. `pageSize` acima de 100 é recusado
com 422 — sem teto, um cliente pede `pageSize=100000` e derruba a API.

### 3.8 ✅ Observabilidade

- **`requestId`**: gerado no `genReqId` do Fastify (ou reaproveitado do
  `x-request-id` de quem chamou), devolvido no header **e** no envelope,
  e presente na linha de log. É o que liga o print do usuário à query.
- **Latência por rota**: `HttpMetricsInterceptor` emite
  `event: 'http.request'` com a rota **normalizada** (`/api/users/:id`,
  não `/api/users/clx123`) — agrupar por URL crua produziria uma série
  por usuário, que não responde nada. Acima de 1 s vira WARN.
- **Alerta de failover**: virar para `CLOUD` agora é `logger.error` com
  `event: 'database.failover.cloud'` (código estável, alertável) **e**
  registro em `AuditLog`. O log some com a rotação; a auditoria responde
  "quando o banco principal caiu semana passada?" meses depois.

---

## 3B. O que continua em aberto

Nada aqui bloqueia o front.

### 🟡 Cloudinary

`CLOUDINARY_*` está vazio; o `MediaService` loga "Cloudinary não
configurado" no boot e as rotas de upload não funcionam. Bloqueia foto
de perfil, mídia de exercício e fotos de avaliação. **Precisa das suas
credenciais.**

A rota `GET /media/upload-signature` já implementa **upload assinado** —
o arquivo vai do cliente direto ao Cloudinary, sem passar pela API. Não
troque isso por upload via API.

### 🟢 Módulos de administração

| Local                  | O que falta                                |
| ---------------------- | ------------------------------------------ |
| `exercises.service.ts` | CRUD de exercícios pelo super-admin        |
| `workouts.service.ts`  | Criação/atribuição de planos por professor |

Ambos são de **administração**, não do fluxo do aluno. O front do aluno
pode ser construído sem eles; o painel admin, não.

### 🟢 Workflows do n8n não importados

Ver o fim da §2.

---

## 3C. Achados da varredura final

Coisas que não estavam na lista do handoff e apareceram ao revisar o
conjunto. Todas corrigidas.

| Achado                                              | Por que importava                                                                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`apps/admin` sem scaffold**                       | Sem `tsconfig.json`, o `tsc --noEmit` imprimia a ajuda do compilador e saía com código 1 — `pnpm -r run typecheck` falhava sempre na raiz. Agora tem scaffold Next 15 completo, na porta **3002**.                    |
| **ESLint da raiz não resolvia `@atlas/config`**     | O `eslint.config.mjs` importava um package que o pnpm não linkava, porque não estava declarado nas devDependencies da raiz. **Nenhum lint do monorepo rodava** — falhava antes de chegar a qualquer regra.            |
| **Presets `nest.mjs` e `next.mjs` nunca aplicados** | Existiam em `packages/config/eslint/` sem nenhum app referenciá-los. Tudo caía no preset base.                                                                                                                        |
| **`consistent-type-imports` ligada na API**         | Sério: o `--fix` converteria os imports das classes injetadas em `import type`, **apagando o import na compilação** e quebrando a injeção de dependência em runtime. Desligada no preset `nest`, com a razão escrita. |
| **Limites de rate limit liam `process.env` cru**    | Contornavam o schema Zod, que é justamente onde o projeto valida ambiente no boot. Um valor inválido viraria um limite silenciosamente errado em produção. Agora passam por `envSchema` e `EnvConfig`.                |
| **`emailLoginSchema` órfão**                        | Substituído por `credentialsLoginSchema` e sem nenhum consumidor. Removido.                                                                                                                                           |
| **`.env.example` desatualizado**                    | Faltavam `SEED_ADMIN_PASSWORD` e os limites por família.                                                                                                                                                              |
| **Docs com contrato antigo**                        | `api.md`, `auth-security.md`, `data-model.md`, `task-list-frontend.md`, `roadmap.md` e o README descreviam o mundo pré-mudança. O front seria construído contra a documentação errada.                                |
| **Suíte frágil a rodadas concorrentes**             | Duas execuções no mesmo `atlas_test` truncam os dados uma da outra e produzem um `P2025` enganoso. Documentado em `test/env.ts`, com saída por `TEST_DATABASE_URL`. É do arranjo de teste, não do produto.            |

---

## 4. Ordem sugerida

Os passos 1 a 6 do plano anterior estão **feitos**. O contrato da API
está congelado: `{ success, data, meta }` em toda rota, paginação com
teto, idempotência por `clientGeneratedId`, e testes que quebram se
qualquer um dos três mudar.

**O front pode começar.**

Em paralelo, quando fizer sentido:

```
Cloudinary (precisa das suas credenciais)
Google OAuth (precisa das suas credenciais)
Workflows do n8n
CRUD de administração + apps/admin
```

---

## 5. Armadilhas que já custaram tempo

Registradas para não se repetirem.

| Armadilha                                       | Detalhe                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`tsBuildInfoFile` em tsconfig compartilhado** | Resolve relativo ao **arquivo de config**, não ao projeto. API e todos os packages gravavam no mesmo cache; cada build achava que já emitira tudo → `MODULE_NOT_FOUND` só em runtime. Por isso `incremental: false` em `packages/config/tsconfig/base.json` — **não religue sem ler o comentário lá.** |
| **Packages precisam de build**                  | O Nest roda em CommonJS e faz `require`. `main` aponta para `dist/`, não para `src/*.ts`. Rode `pnpm -r --filter './packages/*' run build` **antes** de subir a API.                                                                                                                                   |
| **`turbo` não acha o pnpm**                     | Com o pnpm vindo do corepack, `turbo run` falha com "Unable to find package manager binary". Use `pnpm -r --filter ... run <script>` — o pnpm resolve a ordem topológica sozinho.                                                                                                                      |
| **Aspa sobrando na URL do Neon**                | O `.env` tinha `"'postgresql://...`. Falha silenciosa e confusa. Se o Neon "não conecta sem motivo", olhe o começo da string.                                                                                                                                                                          |
| **`pkill` não mata processo Windows**           | Use `Get-NetTCPConnection -LocalPort <p>` + `Stop-Process`. Senão você reinicia a API achando que reiniciou e continua testando a instância antiga.                                                                                                                                                    |
| **Socket corrompido do Docker**                 | Não tente excluir o arquivo — renomeie a **pasta**.                                                                                                                                                                                                                                                    |
| **`instanceof ZodError` mente no monorepo**     | O erro pode vir de outra instância do pacote `zod` (build CJS vs ESM). O `instanceof` devolve `false` e um 422 com a lista de campos vira 500 "erro interno". Use `isZodError` (`common/errors/is-zod-error.ts`), que checa a estrutura.                                                               |
| **`keyPrefix` do ioredis e `KEYS`/`DEL`**       | O prefixo é aplicado de formas diferentes conforme o comando; as chaves voltam prefixadas e o `DEL` prefixa de novo. Resultado: apaga nada, em silêncio. Para varrer por padrão, use uma conexão sem `keyPrefix` e monte os nomes à mão.                                                               |

---

## 6. Configuração do ambiente atual

- **Portas dos apps**: web na 3000 por padrão, mas a 3000 costuma estar
  ocupada pelo dev server de `C:\dev\landing-page` — nesse caso suba com
  `--port 3001`. `CORS_ORIGINS` aceita as duas. O **painel admin é a
  3002**, escolhida para não colidir com nenhuma das duas.
- **Segredos JWT no `.env` são de desenvolvimento** e estão marcados como
  tal. Gere novos para produção.
- **`.env` não está versionado** (só `.env.example`). O `.env` atual contém
  a credencial real do Neon — não commite.
- **Banco de testes separado**: `atlas_test`, no mesmo Postgres. As suítes
  truncam tabelas; apontar para `atlas` apagaria o seu trabalho.
- **App Android**: `apk/atlas-app`, **repositório git próprio**, ignorado
  pelo git do principal. Contratos entram por `npm run sync:contracts`
  (ver `docs/adr/007-app-repositorio-separado.md`).

---

## 7. Como subir tudo do zero

```bash
pnpm install
pnpm -r --filter './packages/*' run build     # obrigatório antes da API
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d
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

Entre com **`admin@atlas.local` / `atlas-admin-2026`** (senha do seed em
desenvolvimento).

Conferir em `http://localhost:3001/status` — é a página que mostra a
verdade sobre as três dependências, e funciona **sem login** justamente
para quando nada mais funciona.

---

## Leitura recomendada, nesta ordem

1. `docs/architecture-overview.md` — visão geral e diagramas C4
2. `docs/adr/` — 7 decisões com o porquê de cada uma
3. `docs/api.md` — o contrato que o front vai consumir
4. `docs/offline-sync.md` — o protocolo, se for mexer em sincronização
5. `docs/auth-security.md` — antes de tocar em qualquer coisa de auth
6. `docs/brief-front-end.md` — **ponto de partida para construir a interface**
7. `docs/task-list-frontend.md` — backlog de front já detalhado
8. `docs/google-oauth-setup.md` — quando for ligar o login com Google
