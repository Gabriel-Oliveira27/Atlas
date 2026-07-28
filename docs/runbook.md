# Runbook — operação e problemas comuns

---

## Subir o ambiente do zero

```bash
pnpm install
pnpm bootstrap      # verifica o ambiente e cria os .env
pnpm docker:up      # Postgres, Redis, n8n, pgAdmin, MinIO
pnpm db:migrate     # migrations no banco local
pnpm db:seed        # papéis, permissões, exercícios, admin
pnpm api:dev
```

Conferir:

```bash
curl http://localhost:3333/api/health
```

Esperado: `status: "ok"` e `checks.databaseLocal.status: "up"`.

---

## Problemas comuns

### Docker Desktop não inicia / `docker` trava

**Sintoma:** `docker ps` fica pendurado ou retorna
`the docker client must be run with elevated privileges`.

**Causa:** o daemon não está no ar. No Windows, o Docker Desktop precisa
estar **aberto e com o ícone verde** — o CLI sozinho não basta.

**Solução:**

1. Abra o Docker Desktop e aguarde "Engine running".
2. Na primeira execução ele pode pedir aceite de termos ou atualização do
   WSL2 — isso **exige interação na janela**.
3. Confirme: `docker version` deve mostrar a seção `Server`.
4. Se persistir: `wsl --update` e reinicie o Docker Desktop.

### Porta 5433 ocupada

O Atlas usa a **5433** justamente para não conflitar com um PostgreSQL já
instalado no Windows (que usa 5432). Se ainda assim houver conflito,
altere `POSTGRES_PORT` em `infra/docker/.env` **e** a porta em
`DATABASE_URL_LOCAL` no `.env` da raiz — os dois precisam bater.

### `Environment variable not found: DATABASE_URL_LOCAL`

O Prisma procura o `.env` no diretório do schema; o nosso está na raiz.
Use sempre os scripts do package (`pnpm db:migrate`), que carregam o env
com `dotenv-cli`. Rodar `npx prisma` direto de dentro de
`packages/database` falha por isso.

### API sobe mas `/health` diz `databaseLocal: down`

1. Os containers estão no ar? `docker compose ps`
2. O Postgres terminou de inicializar? `docker compose logs postgres`
3. A senha do `.env` da raiz bate com a de `infra/docker/.env`?

### `TS2742: The inferred type ... cannot be named`

Atrito conhecido entre pnpm e Prisma: os tipos gerados ficam dentro de
`packages/database/node_modules` e não são "nomeáveis" a partir de outro
package.

**Solução:** anote explicitamente o tipo de retorno do método — o que
também é boa prática para API pública. Exemplos em `users.service.ts`
(`UserPreferencesView`) e `ai.service.ts` (`WeeklyReportSummary`).

### Google OAuth não funciona

Verifique se `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` estão no `.env`.
Sem eles, a estratégia **não é registrada** (de propósito — a API precisa
subir em uma máquina nova sem exigir o Google configurado) e as rotas
`/auth/google` respondem 404. O log de boot avisa.

No Google Cloud Console, autorize o redirect URI **exato**:

```
http://localhost:3333/api/auth/google/callback
```

### Sincronização não roda

```bash
curl http://localhost:3333/api/sync/status -H "Authorization: Bearer <token>"
```

- `cloudAvailable: false` → `DATABASE_URL_CLOUD` ausente ou inválido.
- `SYNC_ENABLED=false` no `.env` desliga o agendamento.
- Uma execução por vez: um disparo durante outra em andamento é recusado.

---

## Operações

### Aplicar migrations nos dois bancos

```bash
pnpm db:migrate:both
```

Os dois bancos **precisam** ter estrutura idêntica — uma coluna faltando
de um lado quebraria a reconciliação em produção, não no deploy.

### Backup do banco local

```bash
docker exec atlas-postgres pg_dump -U atlas atlas > backup-$(date +%F).sql
```

Restaurar:

```bash
cat backup.sql | docker exec -i atlas-postgres psql -U atlas -d atlas
```

> Backup só vale se a **restauração** já tiver sido testada.

### Recomeçar do zero (apaga dados)

```bash
pnpm docker:reset   # derruba e APAGA OS VOLUMES
pnpm docker:up
pnpm db:migrate
pnpm db:seed
```

### Inspecionar o banco

- Prisma Studio: `pnpm db:studio`
- pgAdmin: http://localhost:5050 (servidor Atlas já pré-registrado)

### Conflitos de sincronização pendentes

```sql
SELECT entity, "entityId", "localVersion", "cloudVersion", "createdAt"
FROM sync_conflicts
WHERE resolved = false
ORDER BY "createdAt" DESC;
```

A interface de resolução está no roadmap (Produção); até lá, a análise é
por consulta.

### Fila do outbox travada

```sql
SELECT entity, status, COUNT(*)
FROM change_logs
GROUP BY entity, status;
```

Entradas em `FAILED` esgotaram as tentativas. Investigue `lastError`,
corrija a causa e devolva para a fila:

```sql
UPDATE change_logs SET status = 'PENDING', attempts = 0
WHERE status = 'FAILED' AND entity = '<entidade>';
```

---

## Monitoramento

| O quê           | Como                                           |
| --------------- | ---------------------------------------------- |
| Saúde geral     | `GET /api/health`                              |
| Banco ativo     | `activeDatabase` na resposta do health         |
| Contingência    | `status: "degraded"`                           |
| Sincronização   | `GET /api/sync/status`                         |
| Custo de IA     | Tabela `AiJob` (tokens e latência por chamada) |
| Ações sensíveis | Tabela `AuditLog`                              |

**Alertas que valem configurar antes da produção:**

- `status != "ok"` por mais de 5 minutos
- `pendingChanges` acima de 1000
- `unresolvedConflicts` maior que zero
- Nenhuma `SyncRun` bem-sucedida nas últimas 24 h
