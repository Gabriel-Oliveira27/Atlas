# Acessar a stack local de fora da máquina

Com o Docker no ar, a API local atende o banco Postgres, o Redis e o n8n
do `docker-compose`. Este documento explica como fazer o **web publicado
na Vercel** e o **aplicativo no celular** conversarem com essa stack.

São dois caminhos diferentes, e a diferença não é preferência — é uma
regra do navegador.

---

## Resumo

| Cliente                      | Endereço da API           | Precisa de túnel? |
| ---------------------------- | ------------------------- | ----------------- |
| Web local (`localhost:3001`) | `http://localhost:3333`   | não               |
| Web no celular, mesmo Wi-Fi  | `http://192.168.x.x:3333` | não               |
| **Web publicado na Vercel**  | `https://…` (túnel)       | **sim**           |
| **App Android, mesmo Wi-Fi** | `http://192.168.x.x:3333` | não               |
| App Android, fora da rede    | `https://…` (túnel)       | sim               |

---

## Por que a Vercel exige túnel

A página servida pela Vercel vem por **HTTPS**. Um navegador **não
permite** que uma página HTTPS chame `http://192.168.0.10:3333` — é
bloqueio de conteúdo misto (_mixed content_), e ele acontece no
navegador, antes de qualquer requisição sair. Nenhuma configuração de
CORS, de servidor ou de header contorna isso.

Some-se a isso o óbvio: a Vercel está na internet e a sua máquina está
atrás do roteador. Mesmo sem o bloqueio, não haveria rota.

O túnel resolve os dois de uma vez — dá um domínio HTTPS válido e alcança
a máquina sem abrir porta no roteador.

O aplicativo Android **não** tem esse problema: é um cliente nativo, não
uma página, e fala HTTP direto com o IP da rede local.

---

## Caminho 1 — celular no mesmo Wi-Fi (o mais simples)

### 1. Suba a stack

```bash
pnpm docker:up
pnpm api:dev
```

Ao subir, a API imprime os endereços por onde é alcançável:

```
Atlas API em http://localhost:3333/api
Alcançável na rede local em http://192.168.1.5:3333/api
```

> Anote esse IP. Ele muda quando o roteador renova o DHCP — por isso a
> API o imprime a cada execução em vez de deixá-lo fixo na documentação.

### 2. Libere a porta no firewall do Windows

Na primeira execução o Windows costuma abrir um aviso. Se ele não
aparecer (ou tiver sido negado antes), rode **como administrador**:

```powershell
New-NetFirewallRule -DisplayName "Atlas API" -Direction Inbound -LocalPort 3333 -Protocol TCP -Action Allow
```

Sem isso o celular recebe timeout, sem mensagem de erro útil.

### 3. Aponte o app para o IP

No `.env` do app (`apk/atlas-app/.env`):

```
EXPO_PUBLIC_API_URL=http://192.168.1.5:3333/api
```

E confira que o valor em `eas.json`, perfil `preview`, é o mesmo — é ele
que vale no APK gerado por `npm run build:apk`.

> O `app.config.js` libera tráfego HTTP em texto claro **apenas** quando
> essa variável começa com `http://`. O APK de produção, que aponta para
> HTTPS, sai sem a permissão.

### 4. Confira

Pelo navegador do celular, abra `http://192.168.1.5:3333/api/health`.
Deve responder com `"status":"ok"` e `"activeDatabase":"LOCAL"` — a
segunda parte confirma que veio do Postgres do Docker, e não do Neon.

---

## Caminho 2 — Vercel (ou celular fora do Wi-Fi)

### 1. Abra o túnel

Com a API já rodando:

```bash
pnpm api:expose
```

O script imprime o endereço público:

```
────────────────────────────────────────────────────────────
  API pública:  https://bravo-tigre-azul.trycloudflare.com/api
  Saúde:        https://bravo-tigre-azul.trycloudflare.com/api/health
────────────────────────────────────────────────────────────
```

Requer o `cloudflared`:

```powershell
winget install --id Cloudflare.cloudflared
```

### 2. Configure a Vercel

No painel do projeto → **Settings → Environment Variables**:

```
NEXT_PUBLIC_API_URL = https://bravo-tigre-azul.trycloudflare.com/api
```

Como a variável é `NEXT_PUBLIC_*`, ela é embutida no build — depois de
alterá-la é preciso **refazer o deploy**, não basta salvar.

### 3. Não precisa mexer no CORS

`CORS_ORIGINS` já traz `https://*.trycloudflare.com` e
`https://*.vercel.app`. O curinga cobre tanto o subdomínio sorteado do
túnel quanto os deploys de preview, que ganham domínio novo a cada
branch.

> O subdomínio do túnel **muda a cada execução**. Se ele cair, refaça o
> passo 1 e atualize a variável na Vercel.

---

## Como o CORS decide

Implementação em [`apps/api/src/config/cors.ts`](../apps/api/src/config/cors.ts),
com testes em `cors.test.ts`.

| Situação                                | Resultado |
| --------------------------------------- | --------- |
| Origem exata em `CORS_ORIGINS`          | liberado  |
| Curinga: `https://*.vercel.app`         | liberado  |
| Rede privada, com `CORS_ALLOW_LAN=true` | liberado  |
| Requisição **sem** `Origin`             | liberado  |
| Qualquer outra                          | bloqueado |

Dois pontos que valem atenção:

**Requisição sem `Origin` passa.** É o caso do app Android, do `curl` e
dos healthchecks. CORS é uma proteção do _navegador_ contra uma página
maliciosa usar a sessão do usuário — um cliente nativo nem envia o
cabeçalho, e recusá-lo quebraria o app sem impedir ataque nenhum.

**O curinga cobre um rótulo do host, não um pedaço do texto.**
`https://*.vercel.app` libera `https://atlas.vercel.app` e **recusa**
`https://vercel.app.invasor.com` — que é exatamente o ataque contra quem
compara domínio com `startsWith`.

`CORS_ALLOW_LAN` deve ficar **desligado em produção**. Num servidor, uma
origem "privada" não é o seu notebook: é outra máquina do datacenter.
Sem valor definido, ele já segue esse comportamento (ligado fora de
produção, desligado em produção).

---

## Diagnóstico

| Sintoma                                        | Causa provável                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Celular dá timeout no IP da rede local         | Firewall do Windows bloqueando a 3333                                    |
| Erro de _mixed content_ no console da Vercel   | `NEXT_PUBLIC_API_URL` em `http://` — use o túnel                         |
| Erro de CORS vindo de um domínio `.vercel.app` | Falta o curinga em `CORS_ORIGINS`, ou a API não foi reiniciada           |
| `health` responde `activeDatabase: "CLOUD"`    | O Postgres local caiu; a API assumiu o Neon (é o comportamento previsto) |
| App conecta em dev e falha no APK              | `EXPO_PUBLIC_API_URL` em `http://` sem `app.config.js` no build          |
| Túnel some do nada                             | O subdomínio é sorteado por execução; reabra e atualize a Vercel         |
