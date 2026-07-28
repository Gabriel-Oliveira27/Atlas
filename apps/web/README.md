# Atlas Web

Aplicação web do Atlas (Next.js + PWA). Alvo de deploy: **https://atlas.vercel.app**

## Como rodar

```bash
pnpm --filter @atlas/web dev
```

A API precisa estar no ar (`pnpm api:dev`) e `NEXT_PUBLIC_API_URL` apontando
para ela — por padrão `http://localhost:3333/api`.

## Telas

| Rota               | O que faz                                                       |
| ------------------ | --------------------------------------------------------------- |
| `/`                | Home agregada (`GET /home`) — água, treino, streak, peso, dicas |
| `/login`           | Senha, primeiro acesso e cadastro; Google quando configurado    |
| `/auth/callback`   | Lê os tokens do fragmento da URL e limpa a barra de endereço    |
| `/hidratacao`      | Registro otimista, histórico e lembretes                        |
| `/treino`          | Plano ativo, retomar sessão aberta, histórico                   |
| `/treino/sessao`   | Execução série a série, cronômetro de descanso, finalização     |
| `/exercicios`      | Catálogo com busca e filtro por grupo muscular                  |
| `/exercicios/[id]` | Execução, músculos por papel, erros comuns, dicas, estímulos    |
| `/evolucao`        | Gráfico de peso, volume por sessão, histórico                   |
| `/perfil`          | Dados pessoais, meta de água, preferências                      |
| `/status`          | Estado das dependências — **público**, funciona sem login       |
| `/offline`         | Servida pelo service worker quando não há rede nem cache        |

## Estrutura

```
src/
├── app/          rotas (App Router)
├── components/   app-shell, ícones, gráficos, modal, estados de query
└── lib/          cliente HTTP, sessão, formatação, tipos das respostas
```

## Decisões já tomadas (não precisam ser rediscutidas)

- **Estado de servidor**: React Query. **Estado de UI**: Zustand.
- **Estilo**: TailwindCSS. Os tokens vivem em `tailwind.config.ts`;
  utilitários compostos (`.card`, `.btn-primary`, `.input`, `.chip`) em
  `globals.css`.
- **Tema escuro fixo.** O app é consultado na academia, quase sempre com
  pouca luz — um tema claro seria ofuscante no uso real.
- **Gráficos em SVG escrito à mão** (`components/charts.tsx`): são duas
  formas simples, e uma biblioteca de charts pesaria mais no bundle do
  que o produto ganha. As cores saem dos tokens `chart.*`, mais fechados
  que o acento da interface — o porquê está comentado no config.
- **Envelope de resposta**: tratado uma vez em `lib/api.ts`, nunca na
  tela. O mesmo arquivo enfileira o refresh em 401 e rastreia
  `meta.servedBy` para o aviso global de contingência.
- **Autenticação**: o callback do Google devolve os tokens no _fragmento_
  da URL (`#access_token=...`), que não é enviado ao servidor nem
  registrado em logs intermediários.
- **PWA**: `public/manifest.webmanifest` + `public/sw.js`. O service
  worker **nunca** cacheia `/api/` — os dados são por-sessão, e cacheá-los
  vazaria informação entre contas no mesmo aparelho.

## Contratos

| Recurso                                   | Onde                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| Contratos da API (envelope, tipos, enums) | `@atlas/shared`                                         |
| Schemas de formulário (os mesmos da API)  | `@atlas/validation`                                     |
| Endpoints e exemplos                      | `docs/api.md` e Swagger em `http://localhost:3333/docs` |
| Protocolo offline (IndexedDB)             | `docs/offline-sync.md`                                  |

> As formas das respostas que as telas consomem estão em `lib/types.ts`.
> Não são contrato da API — são o que **este** cliente lê de cada rota.
