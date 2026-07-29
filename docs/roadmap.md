# Roadmap — MVP → Beta → Produção

**Fase 0 (concluída):** fundação — arquitetura, banco, API, infra,
estratégia offline-first. Ver [README](../README.md).

Legenda: ✅ pronto · 🔨 parcial · ⬜ a fazer

---

## MVP — o Atlas utilizável por um aluno

Objetivo: um aluno consegue entrar, ver o treino, registrar séries,
acompanhar hidratação e ver a evolução.

### Back-end

| Item                                                  | Status |
| ----------------------------------------------------- | ------ |
| Monorepo, Docker, banco local + Neon                  | ✅     |
| Schema Prisma completo + seed                         | ✅     |
| Login por e-mail, CPF ou telefone + senha             | ✅     |
| Google OAuth + JWT com rotação + RBAC                 | ✅     |
| Escopo por academia validado em toda rota             | ✅     |
| Rate limit no Redis, por família de rota              | ✅     |
| Idempotência e paginação em todo o contrato           | ✅     |
| Testes e2e da API (65, contra Postgres real)          | ✅     |
| Health check e failover local↔Neon                    | ✅     |
| Perfil, preferências, histórico de peso               | ✅     |
| Catálogo de exercícios (leitura)                      | ✅     |
| Hidratação (registro, resumo, histórico, lembretes)   | ✅     |
| Ciclo de treino (iniciar, registrar série, finalizar) | ✅     |
| Avaliações físicas + comparação                       | ✅     |
| Home agregada                                         | ✅     |
| Protocolo de sync (servidor)                          | ✅     |
| **Criação de planos de treino por professor**         | ⬜     |
| **Atribuição de plano a aluno**                       | ⬜     |
| **Duplicar plano a partir de modelo**                 | ⬜     |

### Front-end

| Item                                         | Status |
| -------------------------------------------- | ------ |
| Web: login, Home, treino, hidratação, perfil | ⬜     |
| Mobile: mesmas telas + SQLite offline        | ⬜     |
| Store offline (SQLite / IndexedDB)           | ⬜     |

**Critério de saída do MVP:** um aluno usa o app por uma semana inteira,
inclusive sem rede na academia, e nenhum dado se perde.

---

## Beta — academia operando e IA no ar

Objetivo: uma academia real administra seus alunos pelo Atlas.

### Back-end

| Item                                               | Status |
| -------------------------------------------------- | ------ |
| Camada de IA (Claude/OpenAI/Gemini)                | ✅     |
| Geração do relatório semanal                       | ✅     |
| Webhook assinado do n8n                            | ✅     |
| Upload assinado do Cloudinary                      | ✅     |
| **Administração de academias** (CRUD, bloqueio)    | ⬜     |
| **Administração do catálogo de exercícios**        | ⬜     |
| **Envio de push (Expo)**                           | ⬜     |
| **Rotas administrativas usadas pelos workflows**   | ⬜     |
| **Periodização completa** (mesociclos/microciclos) | 🔨     |
| **Expurgo do `ChangeLog`**                         | ⬜     |
| **Reconciliação sob carga alta** (fila BullMQ)     | 🔨     |

### Workflows

| Item                                    | Status |
| --------------------------------------- | ------ |
| Relatório semanal                       | ✅     |
| Sincronização agendada                  | ✅     |
| Análise de hidratação                   | ✅     |
| **Geração de PDF** (nó de renderização) | 🔨     |
| **Sugestão de treino por IA**           | ⬜     |

### Front-end

| Item                                | Status |
| ----------------------------------- | ------ |
| Painel do administrador de academia | ⬜     |
| PWA com funcionamento offline       | ⬜     |
| Telas de avaliação com fotos        | ⬜     |
| APK de teste distribuído            | ⬜     |

**Critério de saída do Beta:** uma academia com 50 alunos usa por um mês,
os relatórios semanais chegam e nenhum conflito de sincronização fica sem
resolução.

---

## Produção — escala e operação

| Item                                         | Status |
| -------------------------------------------- | ------ |
| Painel do administrador geral                | ⬜     |
| Multi-academia com isolamento verificado     | 🔨     |
| Interface de resolução de conflitos          | ⬜     |
| Estatísticas e relatórios agregados          | ⬜     |
| Pipeline de deploy (Vercel + API)            | ⬜     |
| Backup automatizado e restauração testada    | ⬜     |
| Observabilidade (métricas, tracing, alertas) | ⬜     |
| Teste de carga                               | ⬜     |
| Revisão de segurança independente            | ⬜     |
| i18n (pt-BR / en-US)                         | 🔨     |
| Publicação na Play Store                     | ⬜     |

**Critério de saída:** restauração de backup testada de verdade, alerta
disparando antes do usuário perceber, e uma revisão de segurança sem
achados críticos.

---

## Dívidas técnicas registradas

Anotadas para não parecerem esquecimento:

| Dívida                                                             | Impacto                                           | Quando resolver                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ChangeLog` cresce sem expurgo                                     | Disco e desempenho da sincronização               | Beta                                                                                       |
| Sincronização usa agendador em memória                             | Duas instâncias da API executariam em duplicidade | Ao escalar horizontalmente                                                                 |
| Swagger não deriva o corpo dos schemas Zod                         | Documentação menos precisa                        | Quando incomodar (avaliar `nestjs-zod`)                                                    |
| `bcryptjs` em vez de `argon2id`                                    | Hash mais fraco que o ideal                       | Quando `argon2` compilar sem atrito no Windows — o `needsRehash` no login já migra sozinho |
| Tombstones nunca removidos                                         | Crescimento lento das tabelas                     | Definir política de retenção antes da Produção                                             |
| Cliente HTTP duplicado se o admin copiar `apps/web/src/lib/api.ts` | Duas cópias divergem na primeira correção         | Extrair para um package na primeira tela do painel                                         |
| Rate limit degrada para memória se o Redis cair                    | O limite volta a ser por processo                 | Aceito: recusar tudo derrubaria a API junto                                                |
