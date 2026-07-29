# Brief de front-end — Atlas

Documento de entrada para quem for construir a interface (humano ou
agente). Descreve **o que existe**, **o que precisa ser feito** e, mais
importante, **o que já está decidido e não deve ser reaberto**.

O back-end está pronto, testado e com o contrato congelado. A interface
não precisa negociar nada com ele — precisa consumi-lo bem.

---

## 1. O produto em um parágrafo

O Atlas é usado **na academia, com o celular na mão, entre séries** —
muitas vezes com a mão suada, o fone no ouvido e 40 segundos de descanso
correndo. Essa é a restrição que manda em todo o resto: se registrar uma
série exige mais de dois toques, o usuário desiste e anota no papel.

Três públicos, três aplicações:

| Quem          | Onde                           | Faz o quê                                         |
| ------------- | ------------------------------ | ------------------------------------------------- |
| **Aluno**     | `apps/web` (PWA) e app Android | Treina, registra séries, bebe água, vê evolução   |
| **Professor** | `apps/web`                     | Monta treinos, avalia alunos, acompanha progresso |
| **Admin**     | `apps/admin`                   | Academias, catálogo, sincronização, workflows     |

---

## 2. O que já existe

```
apps/web/                       Next.js 15 · App Router · Tailwind
  src/lib/api.ts                cliente HTTP: envelope, token, refresh automático
  src/lib/session.ts            sessão no cliente
  src/app/login/page.tsx        login + primeiro acesso  ← funcional
  src/app/page.tsx              Home                     ← protótipo
  src/app/hidratacao/page.tsx   hidratação               ← protótipo, grava de verdade
  src/app/exercicios/page.tsx   catálogo                 ← protótipo
  src/app/status/page.tsx       diagnóstico              ← funcional, sem login
  src/components/               app-shell, progress-ring, query-state

apps/admin/                     Next.js 15 · scaffold, sem telas
```

As telas marcadas como protótipo funcionam e consomem a API de verdade,
mas foram feitas para provar a integração — **não são referência de
design**. Trate-as como rascunho: aproveite o que servir, refaça o resto.

`src/lib/api.ts` **é** referência: resolve envelope, injeção de token e
rotação em 401 com promessa compartilhada. Não reescreva.

---

## 3. Restrições que definem o design

Não são preferências estéticas. Cada uma vem de como o produto é usado.

### 3.1 Uma mão, entre séries

- Ações primárias no **terço inferior** da tela — o polegar não alcança o topo.
- Alvos de toque de **48px** para cima. O usuário está suado e com pressa.
- Registrar uma série: **no máximo dois toques** a partir da tela de treino.
- Nada de confirmação modal em ação reversível. Desfazer > confirmar.

### 3.2 Tema escuro, e não é moda

A academia costuma ter luz baixa e o celular fica no máximo de brilho.
Fundo escuro com um acento saturado dá leitura rápida sem ofuscar.

A paleta já existe em `apps/web/tailwind.config.ts`:

| Token                                | Uso                                     |
| ------------------------------------ | --------------------------------------- |
| `base` `surface` `elevated` `border` | superfícies, do fundo ao primeiro plano |
| `accent` (+ `strong`, `soft`)        | progresso, ação, destaque               |
| `positive` `warning` `danger`        | estado                                  |
| `ink` `ink-muted` `ink-faint`        | texto, do mais forte ao mais fraco      |

Pode evoluir a paleta — mas mantenha os **nomes dos tokens**, porque o
`apps/admin` usa os mesmos.

### 3.3 Offline não é caso de exceção

O vestiário não tem sinal. O app é offline-first por projeto:

- **A UI lê sempre do armazenamento local**, nunca direto da rede.
- Toda escrita é otimista e entra numa fila de pendências.
- Precisa existir um indicador honesto de "não sincronizado" — sem
  mentir que salvou quando só enfileirou.
- Toda escrita manda `clientGeneratedId`; é o que impede a fila de
  duplicar a série no retry. Ver [`api.md`](api.md) → Idempotência.

### 3.4 Números são o produto

Carga, repetição, volume, percentual. Use **tabular-nums** em toda
métrica: sem isso os dígitos dançam quando o valor muda e a leitura
entre séries fica desconfortável.

---

## 4. O que NÃO deve ser reaberto

| Decisão                                                           | Onde está                     |
| ----------------------------------------------------------------- | ----------------------------- |
| Envelope `{ success, data, meta }` em toda resposta               | `@atlas/shared` `ApiResponse` |
| Reagir ao `error.code`, **nunca** à mensagem                      | `@atlas/shared` `ERROR_CODES` |
| Os mesmos schemas Zod da API validam o formulário                 | `@atlas/validation`           |
| Papéis e permissões vêm de constantes compartilhadas              | `@atlas/shared` `PERMISSIONS` |
| "Hoje" é sempre `America/Sao_Paulo`                               | `@atlas/shared` `toDayKey()`  |
| Paginação `page`/`pageSize`, teto de 100, meta no envelope        | `api.md`                      |
| Upload vai do cliente direto ao Cloudinary, com assinatura da API | `api.md` → Mídia              |

Duas regras que costumam ser violadas por descuido:

- **Esconder na UI exatamente o que a API recusaria — nunca mais que
  isso.** Se o botão aparece, a chamada tem que funcionar; se some, é
  porque a permissão não existe. Divergência aqui vira 403 na cara do
  usuário ou, pior, a falsa sensação de que ele não pode algo que pode.
- **A UI não é a autoridade de permissão.** O RBAC já está no back-end.
  Esconder é cortesia, não segurança.

---

## 5. Telas, por ordem de valor

### 5.1 Autenticação — **pronta na API, refazer o visual**

Já funciona em `apps/web/src/app/login/page.tsx`, incluindo o primeiro
acesso. O que precisa é acabamento.

- **Um campo só** para o identificador: "E-mail, CPF ou telefone". Não
  faça abas — o usuário não lembra com o que se cadastrou, e escolher a
  aba errada vira um erro que não é dele.
- Quando a API responde `FIRST_ACCESS_REQUIRED`, a tela **vira** o
  formulário de criação de senha, com o identificador já preenchido.
  Nunca mostre um beco sem saída.
- Erros a tratar pelo código: `INVALID_CREDENTIALS` (senha errada **e**
  conta inexistente — a API não distingue de propósito, a tela também
  não deve), `ACTIVATION_CODE_INVALID`, `PASSWORD_NOT_SET` (oferecer o
  Google), `USER_INACTIVE`, `RATE_LIMITED` (usar `retryAfterSeconds`).
- O botão do Google aparece a partir de `GET /auth/providers`, não de
  variável de ambiente do front.

### 5.2 Home — a tela mais aberta do app

`GET /api/home` devolve tudo em **uma** chamada: hidratação do dia,
treino, peso, streak, progresso da semana, dicas, avisos e último
relatório. Não faça seis requisições.

Hierarquia sugerida: o que fazer **agora** no topo (treino de hoje ou
"registrar água"), progresso do dia em seguida, o resto abaixo.

O streak merece cuidado: é o principal gancho de retorno. Mostre a
sequência sem transformá-la em ansiedade — quebrar um streak de 40 dias
por um dia de descanso legítimo é uma péssima experiência.

### 5.3 Execução de treino — **a tela mais importante do produto**

É aqui que o app ganha ou perde o usuário. Fluxo:
`POST /workouts/sessions` → `POST /sessions/:id/sets` (uma por série) →
`POST /sessions/:id/finish`.

- Exercício atual em foco, próximos visíveis mas discretos.
- Carga e repetições **pré-preenchidas com a última execução** — na
  maioria das séries o usuário só confirma.
- Timer de descanso automático ao registrar a série, visível com o
  celular na bancada, a um toque de distância.
- Série de aquecimento marcada, e visivelmente fora do volume.
- Só existe **uma** sessão aberta por vez (a API devolve 409). Ao abrir
  o app com sessão em andamento, retome — não pergunte.

### 5.4 Hidratação

Anel de progresso e atalhos de volume (200/300/500 ml). Um toque = um
registro. O protótipo em `hidratacao/page.tsx` já grava de verdade e
serve de ponto de partida funcional.

### 5.5 Evolução

Peso, medidas e avaliações ao longo do tempo. Comparação entre duas
avaliações via `GET /assessments/compare`. Fotos lado a lado quando o
Cloudinary estiver ligado.

Cuidado real de produto: **essa tela mexe com a autoimagem de quem
abre.** Evite linguagem de julgamento, evite vermelho para "piorou".
Mostre o dado; o juízo é do usuário.

### 5.6 Painel administrativo

Começar pelas rotas que já existem e estão testadas: `GET /users`
(escopado por academia), `GET /sync/status`, `POST /sync/trigger`,
`GET /health`. O scaffold em `apps/admin` já lista essas quatro.

---

## 6. Acessibilidade — o piso

- Contraste AA (4.5:1) em texto; teste o acento sobre `surface`.
- Foco visível em tudo que recebe teclado (o `:focus-visible` já está
  em `globals.css`).
- Erro de formulário associado ao campo e anunciado (`role="alert"`).
- Ícone **nunca** sozinho como significado: sempre rótulo ou `aria-label`.
- Alvo mínimo de 48px — aqui isso é acessibilidade **e** usabilidade.

---

## 7. Como rodar

```bash
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d
pnpm -r --filter './packages/*' run build
pnpm --filter @atlas/database migrate:deploy
pnpm --filter @atlas/database seed        # imprime o código de ativação
pnpm --filter @atlas/api dev              # :3333
pnpm --filter @atlas/web dev              # :3000
```

Primeiro acesso: entre com o CPF `025.157.183-10`, informe o código que
o seed imprimiu e crie a senha.

`http://localhost:3333/docs` tem o Swagger com todas as rotas.
`http://localhost:3000/status` funciona **sem login** e mostra o estado
real das dependências — é por onde começar quando algo não responde.

---

## 8. Leitura obrigatória antes da primeira linha

1. [`api.md`](api.md) — o contrato inteiro: envelope, paginação, idempotência, erros
2. [`auth-security.md`](auth-security.md) — sessão, tokens, primeiro acesso
3. [`offline-sync.md`](offline-sync.md) — o protocolo, antes de encostar em estado local
4. [`task-list-frontend.md`](task-list-frontend.md) — backlog já detalhado por fase

---

## 9. O que seria um bom resultado

Não é "bonito". É:

- Um usuário registra uma série **sem tirar o fone e sem parar de
  descansar** — dois toques, sem procurar nada.
- O app abre e a pessoa entende em **três segundos** o que fazer agora.
- Cair o sinal no meio do treino **não muda nada** visível.
- O professor abre a evolução de um aluno e enxerga a tendência sem
  interpretar gráfico.
- Nada na tela mente sobre o que foi salvo.

Se o design for bonito e falhar em qualquer um desses, ele falhou.
