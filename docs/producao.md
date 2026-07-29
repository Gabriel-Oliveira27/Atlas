# Ir para produção

Tudo que precisa existir antes de o Atlas atender gente de verdade.
Cada item diz **onde pegar**, **onde colocar** e **o que quebra sem ele**.

> Segredos nunca entram no git. O `.env` está no `.gitignore` — mantenha
> assim. Em serviço hospedado, use o painel de variáveis de ambiente.

---

## 1. Segredos que você mesmo gera

```bash
node infra/scripts/gerar-segredos.mjs
```

O script imprime três valores prontos para colar:

| Variável             | Para quê                          |
| -------------------- | --------------------------------- |
| `JWT_ACCESS_SECRET`  | Assina o token de acesso (15 min) |
| `JWT_REFRESH_SECRET` | Assina o refresh (30 dias)        |
| `N8N_WEBHOOK_SECRET` | HMAC dos webhooks do n8n          |

**Não são hashes.** Hash resume algo que já existe; aqui o que se quer é
o contrário — bytes imprevisíveis. São 32 bytes do gerador criptográfico
do sistema, em hex (64 caracteres), que é o tamanho da chave do
HMAC-SHA256 usado nos JWT.

As **senhas dos usuários** são outra coisa e você não gera nada: elas
viram hash com **bcrypt custo 12** dentro da própria API, no cadastro.
Nenhuma senha em texto claro é gravada nem trafega para fora do fluxo de
login.

Três regras:

- **Os dois segredos JWT precisam ser diferentes.** Iguais, um access
  token roubado passa a valer como refresh.
- **Não reaproveite os de desenvolvimento.** A API se recusa a subir em
  produção se encontrar `dev-only` ou `troque` neles.
- **Trocar um segredo JWT derruba todas as sessões ativas.** É esperado
  — e é exatamente o que se quer se um segredo vazou.

---

## 2. Cloudinary (fotos de perfil, mídia de exercício, avaliações)

Sem isto, a API sobe e loga `Cloudinary não configurado`; as rotas de
upload respondem **503** e o resto do produto funciona normalmente.

### Onde pegar

1. Crie a conta em **[cloudinary.com](https://cloudinary.com)** — o
   plano gratuito cobre bem o início (25 créditos/mês).
2. No **Dashboard**, o bloco **Product Environment Credentials** mostra
   os três valores de uma vez. O `API Secret` vem oculto; clique no olho
   para revelar.

### Onde colocar

```bash
CLOUDINARY_CLOUD_NAME=seu-cloud-name    # ex.: dq3xk9abc
CLOUDINARY_API_KEY=123456789012345      # numérico
CLOUDINARY_API_SECRET=abcDEF...         # ← este é segredo de verdade
CLOUDINARY_FOLDER=atlas                 # pasta raiz; deixe como está
```

### Como o Atlas usa

O arquivo **não passa pela API**. O cliente pede uma assinatura em
`GET /media/upload-signature`, e envia o arquivo **direto ao
Cloudinary**. Isso evita banda, memória e timeout no servidor, e mantém
o `api_secret` só no back-end.

Consequência prática: **o `CLOUDINARY_API_SECRET` nunca vai para o
front-end.** Se você se pegar colocando ele numa variável
`NEXT_PUBLIC_*` ou `EXPO_PUBLIC_*`, parou — essas são embutidas no
pacote e visíveis para qualquer usuário.

As mídias ficam em `atlas/avatars`, `atlas/exercises`,
`atlas/assessments`, `atlas/gyms` e `atlas/reports`.

---

## 3. Banco de dados

### Neon (nuvem) — obrigatório em produção

A API **recusa subir** em produção sem `DATABASE_URL_CLOUD`. É a
redundância: se o banco principal cair, ela assume o Neon sozinha.

1. Crie o projeto em **[console.neon.tech](https://console.neon.tech)**,
   região `sa-east-1` (São Paulo) para latência menor.
2. **Connection Details** → copie a **Pooled connection string**.

```bash
DATABASE_URL_CLOUD="postgresql://USUARIO:SENHA@ep-xxx-pooler.sa-east-1.aws.neon.tech/atlas?sslmode=require"
```

> **A string precisa das aspas e nada antes delas.** Uma aspa sobrando
> no começo já custou uma sessão de depuração aqui — o sintoma é "o Neon
> não conecta sem motivo".

Aplique o schema:

```bash
pnpm --filter @atlas/database migrate:cloud
```

### Qual banco atende

`DATABASE_PRIMARY` decide quem é o principal. `GET /api/health` responde
`activeDatabase: "LOCAL" | "CLOUD"` — é como você confere qual está
atendendo agora.

---

## 4. Google OAuth (login com Google)

Opcional: sem ele, a tela de login mostra só o formulário de senha —
`GET /auth/providers` avisa o front sozinho.

Passo a passo em [`google-oauth-setup.md`](google-oauth-setup.md).
Resumo do que vai no `.env`:

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_CALLBACK_URL=https://SUA-API/api/auth/google/callback
OAUTH_SUCCESS_REDIRECT_WEB=https://SEU-WEB/auth/callback
OAUTH_SUCCESS_REDIRECT_MOBILE=atlasapp://auth/callback
```

O `GOOGLE_CALLBACK_URL` precisa bater **exatamente** com o autorizado no
console do Google — inclusive `https` e barra final.

---

## 5. IA (relatórios semanais)

Opcional: sem chave, a geração de relatório responde erro e nada mais
quebra.

| Variável            | Onde pegar                                                                |
| ------------------- | ------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys         |
| `OPENAI_API_KEY`    | [platform.openai.com](https://platform.openai.com/api-keys) (alternativa) |

Cada chamada custa dinheiro real — por isso o rate limit de IA é o mais
apertado da API (5/hora), e ele é por usuário, não por IP.

---

## 6. Redis

Necessário em produção: é onde vive o rate limit compartilhado. Sem ele,
o contador volta a ser por processo — duas instâncias dobram o limite
efetivo, e todo restart zera os contadores.

- Local: já sobe no `docker-compose`.
- Hospedado: [Upstash](https://upstash.com) tem plano gratuito.

```bash
REDIS_URL=rediss://default:SENHA@host.upstash.io:6379
```

---

## 7. Variáveis do front-end

**Web (Vercel)** — Settings → Environment Variables:

```bash
NEXT_PUBLIC_API_URL=https://SUA-API/api
```

Como é `NEXT_PUBLIC_*`, ela é embutida no build: depois de alterar é
preciso **refazer o deploy**, não basta salvar.

**App (eas.json)** — perfil `production`:

```json
"env": { "EXPO_PUBLIC_API_URL": "https://SUA-API/api" }
```

> Tudo com prefixo `NEXT_PUBLIC_` ou `EXPO_PUBLIC_` é **público** — vai
> dentro do JavaScript entregue ao usuário. Nunca coloque segredo aí.

---

## 8. Deploy do web na Vercel

O repositório tem **dois** apps Next (`web` e `admin`). Sem dizer qual,
a Vercel escolhe um — e foi assim que o primeiro deploy publicou o
painel administrativo, que é só scaffold.

No painel do projeto:

| Campo              | Valor      |
| ------------------ | ---------- |
| **Root Directory** | `apps/web` |
| Framework Preset   | Next.js    |

O `apps/web/vercel.json` cuida do resto. O ponto que ele resolve não é
óbvio: `@atlas/shared` e `@atlas/validation` resolvem para `dist/`, que
**não existe antes de compilar**. O comando
`pnpm --filter "@atlas/web..." build` compila os pacotes na ordem certa
antes do Next — sem ele, o build falha mesmo com a pasta correta.

---

## 9. Antes de considerar pronto

- [ ] Segredos JWT gerados, diferentes entre si, fora do git
- [ ] `DATABASE_URL_CLOUD` preenchido e migrations aplicadas
- [ ] `REDIS_URL` apontando para um Redis de verdade
- [ ] `CORS_ORIGINS` com o domínio real do web
- [ ] **`CORS_ALLOW_LAN` desligado** — em servidor, origem "privada" não
      é o seu notebook, é outra máquina do datacenter
- [ ] `NODE_ENV=production` (é o que ativa as travas de segredo fraco)
- [ ] `GET /api/health` responde `ok` com os três serviços `up`
- [ ] Login real funcionando de ponta a ponta
- [ ] CI verde na `main`

### O que a própria API recusa em produção

Não é checklist opcional — ela **não sobe**:

- Segredo JWT contendo `dev-only` ou `troque`
- `DATABASE_URL_CLOUD` ausente

---

## 10. Onde cada segredo pode aparecer

| Segredo                 | Back-end | Front-end | Git |
| ----------------------- | -------- | --------- | --- |
| `JWT_*_SECRET`          | sim      | **nunca** | não |
| `CLOUDINARY_API_SECRET` | sim      | **nunca** | não |
| `DATABASE_URL_*`        | sim      | **nunca** | não |
| `ANTHROPIC_API_KEY`     | sim      | **nunca** | não |
| `N8N_WEBHOOK_SECRET`    | sim      | **nunca** | não |
| `CLOUDINARY_CLOUD_NAME` | sim      | ok        | ok  |
| `NEXT_PUBLIC_*`         | —        | ok        | ok  |

Se um segredo da primeira metade vazou: gere outro **e** revogue o
antigo no provedor. Só trocar no `.env` deixa o vazado válido.
