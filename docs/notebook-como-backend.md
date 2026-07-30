# O notebook como back-end, com reserva na nuvem

Como fazer o seu computador servir a API — e o produto continuar de pé
quando ele desligar.

---

## O desenho

```
                    ┌─────────────────────────┐
   Vercel / app ───►│  1º  notebook (túnel)   │  Postgres local, rápido
                    │      HTTPS              │  é onde os dados nascem
                    └───────────┬─────────────┘
                                │ não respondeu em 2 s
                                ▼
                    ┌─────────────────────────┐
                    │  2º  API hospedada      │  Neon, sempre no ar
                    │      (Render, grátis)   │  hiberna, ~50 s para acordar
                    └─────────────────────────┘
```

O cliente sonda `/health/live` no primário com timeout curto e cai para
a reserva se não responder. A decisão fica em cache por alguns minutos e
é invalidada a cada falha de rede. Implementação em
`apps/web/src/lib/endpoint.ts` e `apk/atlas-app/src/lib/endpoint.ts`.

**Por que o timeout é curto:** com o notebook desligado a conexão não é
recusada — ela fica pendurada até o TCP desistir, dezenas de segundos. O
corte em 2 s troca a tela girando por uma queda rápida para a reserva.

---

## O que você precisa saber antes

**As duas instâncias não compartilham o mesmo banco.** O notebook usa o
Postgres local; a reserva usa o Neon. A sincronização (outbox → CLOUD)
propaga as escritas, mas **não é instantânea**.

Consequência prática: quem cria uma conta com o notebook ligado e cai
para a reserva no minuto seguinte pode não encontrar a conta ainda. Por
isso a troca aparece na interface — a tarja "servidor principal fora do
ar, usando o de reserva" existe justamente para essa situação não
parecer perda de dados.

---

## Parte 1 — expor o notebook

```bash
pnpm docker:up      # Postgres, Redis, n8n
pnpm api:dev        # API
pnpm api:expose     # túnel HTTPS
```

O `api:expose` imprime o endereço público. **Ele muda a cada execução** —
é a limitação do túnel rápido do Cloudflare, que não exige domínio nem
conta.

### Endereço fixo

Se quiser parar de reconfigurar a cada reinício, há duas saídas sem
comprar domínio:

| Opção                | Como fica                     | Custo              |
| -------------------- | ----------------------------- | ------------------ |
| **Tailscale Funnel** | `https://sua-maquina.ts.net`  | grátis             |
| **ngrok**            | `https://algo.ngrok-free.app` | grátis (1 domínio) |

Com domínio próprio, o túnel nomeado do Cloudflare
(`api.seudominio.com`) é a melhor opção — sobrevive a reinício e a queda
de luz.

Qualquer que seja, acrescente o domínio a `CORS_ORIGINS`. Os curingas
`https://*.trycloudflare.com` e `https://*.vercel.app` já estão lá.

---

## Parte 2 — Swagger acessível e protegido

Com o túnel no ar, o `/docs` fica alcançável pela internet — e ele
descreve **toda** a superfície da API. Por isso vai atrás de senha:

```bash
DOCS_USER=atlas
DOCS_PASSWORD=uma-senha-longa-de-verdade
```

O comportamento:

| Situação                         | `/docs`              |
| -------------------------------- | -------------------- |
| Desenvolvimento, sem credenciais | aberto               |
| Desenvolvimento, com credenciais | pede usuário e senha |
| Produção, sem credenciais        | **desligado**        |
| Produção, com credenciais        | pede usuário e senha |

A proteção cobre a página **e** o `/docs-json`. Proteger só a página
deixaria o contrato inteiro acessível pelo JSON, que é o primeiro lugar
que uma ferramenta automatizada busca.

A comparação da senha é de tempo constante: comparar com `===` para no
primeiro byte diferente, e medir isso repetidamente permite descobrir a
senha caractere a caractere.

---

## Parte 3 — API de reserva no Render

1. **[render.com](https://render.com)** → New → **Blueprint** → aponte
   para o repositório. O `render.yaml` na raiz descreve o serviço.
2. Preencha no painel as variáveis marcadas como `sync: false`:

   ```
   DATABASE_URL_CLOUD    ← Neon (a mesma do .env)
   DATABASE_URL_LOCAL    ← o mesmo valor do Neon; esta instância não tem banco local
   JWT_ACCESS_SECRET     ← OS MESMOS do notebook (ver abaixo)
   JWT_REFRESH_SECRET    ← idem
   REDIS_URL             ← OPCIONAL, pode deixar em branco (ver abaixo)
   DOCS_USER / DOCS_PASSWORD
   ```

> **`REDIS_URL` virou opcional.** Sem Redis o rate limit cai para um
> contador em memória do processo, e nada mais é perdido — não há fila
> BullMQ no projeto. Até 30/07/2026 um Redis inalcançável era pior que
> não ter: o comando ficava pendurado, e como o rate limit roda em TODA
> requisição, o health check nunca respondia e o deploy morria em
> "service unhealthy" com a API no ar e muda. Corrigido; hoje um Redis
> ausente degrada em vez de travar.

> **Os segredos JWT precisam ser IGUAIS nas duas instâncias.** É o que
> permite um token emitido pelo notebook continuar valendo na reserva.
> Diferentes, todo mundo é deslogado no momento em que o notebook cai —
> exatamente quando você menos quer isso.

3. Anote a URL (`https://atlas-api-reserva.onrender.com`).

### Alternativa: a mesma API na Vercel

O `apps/api/vercel.json` publica a API como função serverless, num
projeto Vercel **separado** do web (Root Directory apontando para
`apps/api`; os dois arquivos `vercel.json` não se atrapalham porque a
Vercel lê só o do diretório configurado).

A vantagem sobre o Render gratuito é direta: **não hiberna**. Some o
cold start de 50 s que faz o app desistir da reserva.

O que essa instância **não** faz, por ser serverless:

|                                     | Render         | Vercel       |
| ----------------------------------- | -------------- | ------------ |
| Atende HTTP                         | sim            | sim          |
| Hiberna                             | ~15 min → 50 s | não          |
| Cron de sincronização (03:00/18:00) | roda           | **não roda** |
| Poda de retenção                    | roda           | **não roda** |

Uma função acorda, responde e congela — não existe processo para segurar
um agendamento. Por isso o perfil da Vercel nasce com `SYNC_ENABLED=false`
e `SYNC_RETENTION_ENABLED=false`: ela é uma boca de HTTP sobre o Neon.
Quem sincroniza e poda é o notebook, que tem os dois bancos e um processo
de verdade.

Variáveis: as mesmas do Render, mais as duas acima. Os segredos JWT
seguem tendo que ser idênticos aos do notebook.

### Limite do plano gratuito do Render

O serviço hiberna após ~15 min sem tráfego e leva uns 50 s para acordar.
Para uma reserva é aceitável. Se incomodar, um cron simples chamando
`/api/health/live` a cada 10 min mantém acordado — ao custo das horas
gratuitas do mês.

---

## Parte 4 — ligar os clientes

**Vercel** → Settings → Environment Variables:

```bash
NEXT_PUBLIC_API_URL=https://SEU-TUNEL/api              # notebook
NEXT_PUBLIC_API_FALLBACK_URL=https://atlas-api-reserva.onrender.com/api
```

Refaça o deploy depois de alterar — variáveis `NEXT_PUBLIC_*` são
embutidas no build.

**App** — já configurado em `eas.json`. Confira que
`EXPO_PUBLIC_API_URL` (notebook) e `EXPO_PUBLIC_API_FALLBACK_URL`
(reserva) apontam para os endereços certos.

Sem `*_FALLBACK_URL`, o comportamento é o de antes: só o primário, sem
sondagem.

---

## Diagnóstico

| Sintoma                                           | Causa provável                                         |
| ------------------------------------------------- | ------------------------------------------------------ |
| Tarja "usando o de reserva" com o notebook ligado | O túnel caiu, ou a URL na Vercel é de um túnel antigo  |
| Login funciona no notebook e falha na reserva     | Segredos JWT diferentes entre as instâncias            |
| Conta recém-criada não existe na reserva          | Sincronização ainda não propagou — é o previsto        |
| Primeira chamada à reserva demora ~50 s           | Serviço hibernado no plano gratuito                    |
| `/docs` responde 401 no navegador                 | Correto: informe `DOCS_USER` e `DOCS_PASSWORD`         |
| `/docs` responde 404 em produção                  | Faltam as credenciais — sem elas a API não serve a doc |
