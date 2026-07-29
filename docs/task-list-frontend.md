# Backlog do Front-End

Lista de tarefas para construir Web e Mobile **sobre a arquitetura já
pronta, sem alterações estruturais**.

> Leia antes: [`api.md`](api.md) (contratos) e
> [`offline-sync.md`](offline-sync.md) (protocolo offline).

## Onde cada tarefa é feita

As tags indicam o repositório:

| Tag               | Repositório             | Caminho                                                          |
| ----------------- | ----------------------- | ---------------------------------------------------------------- |
| `[web]` `[admin]` | principal (este)        | `apps/web`, `apps/admin`                                         |
| `[mobile]`        | **repositório próprio** | `apk/atlas-app` ([ADR 007](adr/007-app-repositorio-separado.md)) |

No app, os contratos vêm por `npm run sync:contracts` em vez de
`@atlas/shared` — o restante das regras abaixo vale igual para os dois.

---

## O que já está decidido — não precisa ser rediscutido

| Assunto                 | Decisão                                                | Onde                                     |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------- |
| Formato de resposta     | `{ success, data, meta }` / `{ success, error, meta }` | `@atlas/shared` → `ApiResponse`          |
| Erros                   | Reagir ao `code`, nunca à mensagem                     | `@atlas/shared` → `ERROR_CODES`          |
| Validação de formulário | Os mesmos schemas Zod da API                           | `@atlas/validation`                      |
| Papéis e permissões     | Constantes compartilhadas                              | `@atlas/shared` → `ROLES`, `PERMISSIONS` |
| Tokens                  | Access 15 min + refresh rotativo 30 dias               | `docs/auth-security.md`                  |
| Fuso de "hoje"          | `America/Sao_Paulo` fixo                               | `@atlas/shared` → `toDayKey()`           |
| Paginação               | `page` / `pageSize`, meta no envelope                  | `@atlas/shared` → `PaginationMeta`       |

---

## Fase 1 — fundação do cliente

### F1.1 Cliente HTTP `[web] [mobile]`

- Desembrulhar o envelope uma única vez; telas recebem `data` puro.
- Injetar `Authorization` e o header `x-atlas-device-id`.
- **Refresh automático em 401**: enfileirar as requisições concorrentes e
  reexecutá-las após renovar — sem isso, cinco chamadas simultâneas
  disparam cinco refreshes e a rotação invalida os tokens umas das outras.
- Em `REFRESH_TOKEN_REUSED`, limpar a sessão e mandar para o login.
- Ler `meta.servedBy`: quando for `CLOUD`, exibir aviso de contingência.

### F1.2 Autenticação `[web] [mobile]`

**Login por credenciais** (o caminho principal — já funciona):

- **Um campo só** para o identificador, rotulado "E-mail, CPF ou
  telefone". Não faça abas: o usuário não lembra com o que se cadastrou,
  e escolher a aba errada vira um erro de login que não é dele.
- `POST /api/auth/login` com `{ identifier, password, deviceId }`.
- Máscara de CPF/telefone é opcional na digitação — a API normaliza. Se
  aplicar máscara, **não** bloqueie e-mail no mesmo campo.
- Erros a tratar pelo `code`:
  - `INVALID_CREDENTIALS` → "E-mail, CPF, telefone ou senha incorretos".
    Não diga "usuário não encontrado": a API não distingue os casos de
    propósito, e a tela não deve inventar a distinção.
  - `PASSWORD_NOT_SET` → "Esta conta entra com o Google" + botão do Google.
  - `USER_INACTIVE` → conta desativada, orientar a procurar a academia.
  - `RATE_LIMITED` → usar `error.details.retryAfterSeconds` no aviso.

**Cadastro**: `POST /api/auth/register`. CPF e telefone são opcionais;
em conflito, o `code` diz o campo exato (`EMAIL_ALREADY_REGISTERED`,
`CPF_ALREADY_REGISTERED`, `PHONE_ALREADY_REGISTERED`) — destaque aquele
campo, não o formulário inteiro.

**Google OAuth** (aparece sozinho quando as credenciais existirem):

- Ler `GET /api/auth/providers` e mostrar o botão só quando
  `google === true`. Não condicione a variável de ambiente do front.
- Botão "Entrar com Google" → `GET /api/auth/google`.
- Página `/auth/callback`: ler o **fragmento** (`#access_token=...`),
  guardar os tokens e **limpar a URL** (`history.replaceState`).

**Armazenamento dos tokens**:

- Web: tokens em memória + refresh em cookie `httpOnly` quando possível.
- Mobile: `expo-secure-store` (Keystore). **Nunca AsyncStorage** — é texto puro.
- Deep link `atlasapp://auth/callback`.

### F1.3 Estado global `[web] [mobile]`

- React Query para estado de servidor; Zustand para estado de UI.
- Chaves de query padronizadas (`['home']`, `['hydration', 'today']`…).
- Invalidação após mutações que alteram a Home.

### F1.4 Store offline `[mobile]` `[web]`

- Mobile: `expo-sqlite`. Web: IndexedDB.
- Tabelas espelhando as entidades de `SYNC_ENTITIES`, com `version`,
  `updatedAt`, `deletedAt`, `originNode`.
- Fila de pendências.
- **A UI lê sempre do banco local**, nunca direto da rede.

### F1.5 Motor de sincronização no cliente `[mobile]` `[web]`

- `push` → `pull` → atualizar cursor, nessa ordem.
- Disparar: ao abrir o app, ao recuperar conexão, a cada N minutos.
- Respeitar `syncOnWifiOnly` das preferências.
- Indicador visual de "sincronizando" e de pendências.

---

## Fase 2 — telas do aluno

### F2.1 Home `[web] [mobile]`

Rota única: `GET /api/home`. Traz tudo que a tela precisa.

Componentes: anel de hidratação (consumido/meta/restante), card de treino
(iniciado/finalizado), peso atual vs. meta, streak, progresso semanal (7
dias), dicas, avisos, último relatório.

### F2.2 Hidratação `[web] [mobile]`

- Botões rápidos (200/300/500 ml) e valor livre.
- `POST /api/hydration/logs` com `clientGeneratedId` (idempotência).
- Histórico com gráfico; configuração de lembretes.
- Atualização otimista: o anel se move antes da resposta.

### F2.3 Treino `[web] [mobile]`

- `GET /api/workouts/plans/active` → dias e exercícios.
- Iniciar sessão; **retomar** se `GET /api/workouts/sessions/open` retornar algo.
- Tela de execução: exercício atual, GIF, série a série, cronômetro de descanso.
- Registrar carga/reps/RPE/RIR; mostrar a carga da última vez.
- Suportar supersérie, dropset, rest-pause (agrupar por `groupKey`).
- Finalizar com avaliação da sessão.
- **Tudo isso precisa funcionar offline.**

### F2.4 Exercícios `[web] [mobile]`

- Lista com busca e filtros (grupo, equipamento, dificuldade).
- Detalhe: execução, músculos por papel, erros comuns, dicas, mídia.

### F2.5 Evolução e avaliações `[web] [mobile]`

- Gráfico de peso; gráfico de volume.
- Registrar avaliação com medidas e fotos (upload assinado do Cloudinary).
- Comparar duas avaliações (`GET /api/assessments/compare`).

### F2.6 Perfil e configurações `[web] [mobile]`

- Editar perfil; sugestão de meta de água.
- Tema, idioma, notificações, sincronização, backup.
- Informações legais.

---

## Fase 3 — administração

### F3.1 Painel da academia `[admin]`

- Listar/cadastrar/editar alunos (a API já escopa por academia).
- Criar treinos e periodizações; atribuir a alunos.
- Acompanhar evolução; gerenciar professores.

### F3.2 Painel da plataforma `[admin]`

- Academias: cadastrar, bloquear.
- Catálogo global de exercícios.
- Logs de auditoria.
- **Sincronização**: estado, disparo manual, resolução de conflitos.
- Workflows do n8n.

---

## Fase 4 — PWA e app

### F4.1 PWA `[web]`

- Manifest, ícones, service worker.
- Cache das rotas de leitura; fila offline para escrita.
- Instalável.

### F4.2 Android `[mobile]`

- Expo Notifications; registrar `pushToken` em `DeviceToken`.
- Lembretes locais de hidratação.
- Gerar APK (`eas build --profile preview`).

---

## Armadilhas conhecidas

Cada uma destas já causaria retrabalho se descoberta tarde:

| Armadilha                                          | O que fazer                                 |
| -------------------------------------------------- | ------------------------------------------- |
| Enviar `temperature` para modelos Claude atuais    | Já tratado na API — não replicar no cliente |
| Guardar o cursor de sync antes de aplicar o `pull` | Guardar **depois**, ou perde alterações     |
| `DELETE` físico no banco local                     | Usar tombstone (`deletedAt`)                |
| Gerar `id` no servidor                             | O `id` é gerado no cliente (cuid)           |
| Ler `data` sem checar `success`                    | Sempre checar o envelope                    |
| Reagir à mensagem de erro em vez do `code`         | Mensagens mudam com tradução                |
| Calcular "hoje" com o fuso do aparelho             | Usar `toDayKey()` de `@atlas/shared`        |
| Vários refreshes simultâneos                       | Enfileirar (ver F1.1)                       |

---

## Definição de pronto

Uma tarefa está concluída quando:

- [ ] funciona offline (quando aplicável) e sincroniza ao reconectar;
- [ ] estados de carregamento, vazio e erro estão tratados;
- [ ] a validação usa o schema de `@atlas/validation`;
- [ ] o RBAC da UI corresponde ao da API;
- [ ] `pnpm lint`, `typecheck` e `test` passam;
- [ ] testado em tela pequena (360 px).
