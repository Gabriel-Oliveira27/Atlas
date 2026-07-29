# ADR 008 — Neon como banco principal, Postgres local como secundário

**Status:** aceito
**Data:** 2026-07-29
**Emenda a:** [ADR 003](003-banco-local-principal.md), que fica superado no
que diz respeito a qual banco é o principal. O resto dele — schema único,
regra de roteamento, custo da sincronização — continua valendo.

## Contexto

O [ADR 003](003-banco-local-principal.md) escolheu o Postgres local como
principal por latência: o usuário registra série a cada 60–90 segundos, e
uma escrita lenta é percebida com o halter na mão. O raciocínio estava
certo para o cenário que ele descrevia.

O que aconteceu na prática foi outro cenário. A instalação real é uma
academia com o back-end no notebook de quem mantém o sistema, exposto por
túnel ([ADR de acesso remoto](../notebook-como-backend.md)). E notebook
desliga: à noite, quando sai de casa, quando o Windows decide atualizar.
Nesse intervalo o Atlas não ficava lento — ficava **fora**.

O sintoma que motivou a mudança foi o app Android: o `.env` dele apontava
só para o IP da máquina, sem reserva configurada, então fora do Wi-Fi de
casa o aplicativo simplesmente não tinha back-end.

A latência que o ADR 003 queria proteger, além disso, nunca se
materializou como ele previa: o cliente não fala com o Postgres, fala com
a API por HTTP. Quando a API está no notebook e o celular está no mesmo
Wi-Fi, a rodada é rápida — e isso continua verdade depois desta mudança,
porque quem escolhe o endereço da API é outra decisão, no `endpoint.ts`.

## Decisão

**O Neon é o principal (`DATABASE_PRIMARY=CLOUD`, novo padrão). O
Postgres local é o secundário, e continua aceitando escrita.**

Três consequências deliberadas:

1. **O local não é descartável.** Segue recebendo tudo, segue aceitando
   escrita quando o Neon está fora, segue sendo o datasource das
   migrations. Continua havendo dois bancos que escrevem — logo o `version`,
   os tombstones e o `SyncConflict` do [ADR 004](004-sincronizacao-outbox.md)
   continuam necessários. A alternativa (local como espelho somente-leitura)
   foi considerada e recusada: ela simplificaria o motor, mas mataria o
   cenário de internet fora na academia, que é real.

2. **O roteador virou simétrico.** O `DatabaseRouter` falava "local" e
   "nuvem" onde queria dizer "principal" e "secundário". Invertido, ele
   nunca reconciliava (a recuperação era `next === LOCAL`) e nunca se
   declarava degradado (`isDegraded` exigia `primary === LOCAL`). Foram
   corrigidos, e existe agora um gancho `onSecondaryAvailable`: o
   secundário voltar **não** troca o nó ativo, então não passava por
   `onNodeChange` e ele ficava desatualizado até a próxima janela
   agendada.

3. **A escrita de controle acompanha o principal.** O `SyncRun` era
   gravado sempre no local — com o Neon principal e o notebook desligado,
   a sincronização não conseguia registrar nem que havia rodado.

## Retenção: o que apagamos e o que não

A proposta original incluía baixar para o local o que tivesse mais de 20
dias e **apagar do Neon**, para economizar espaço. Foi recusada nesta
forma, por três motivos concretos:

1. **Contraria o objetivo.** Se o histórico antigo só existe no notebook,
   notebook desligado volta a significar usuário sem histórico — o
   problema que esta ADR veio resolver, de volta pela porta dos fundos, e
   ainda por cima na parte do produto que se chama "evolução física".

2. **O motor desfaz o expurgo.** Em `applyChange`, uma linha ausente no
   destino é criada. Apagar do Neon sem mais nada faz qualquer
   `ChangeLog` pendente ou edição futura **recriar** a linha lá. Fazer o
   expurgo pelo caminho normal de escrita é pior: gera um `ChangeLog` de
   DELETE com `targetNode=LOCAL` e a sincronização seguinte **apaga o
   arquivo do local**.

3. **O espaço não está no dado do usuário.** As fotos ficam no Cloudinary
   (`AssessmentPhoto` guarda `url`, não binário), e uma linha de `SetLog`
   são datas e inteiros. O que cresce sem limite é o rastro do motor: o
   `ChangeLog` guarda uma cópia JSON integral da linha **a cada escrita**,
   para sempre, nos dois bancos.

**O que ficou implementado** (`SyncRetentionService`, diário às 04:30):
poda de `ChangeLog` já SYNCED, `SyncRun` encerrado e `SyncConflict`
resolvido acima de `SYNC_RETENTION_DAYS` (padrão 30), nos dois bancos.

É seguro porque estas três tabelas não estão em `SYNC_ENTITIES` e os
`ChangeLog` são criados explicitamente pelos serviços, não por
middleware: apagar aqui não gera outbox novo. E porque nada pendente,
falhado ou em aberto é tocado em nenhuma idade — justamente o que alguém
ainda pode precisar ver.

## Consequências

**Positivas**

- O app e o web funcionam com o notebook desligado, sem dado defasado.
- O aviso de "degradado" passou a funcionar nos dois sentidos.
- O secundário se atualiza ao voltar, em vez de esperar as 03:00.
- O crescimento do banco passou a ter teto, na tabela onde ele existia.

**Negativas**

- **Escrita normal agora atravessa a internet.** Some a latência de rede
  local no caminho comum. Aceitável para registro de treino (dezenas de
  milissegundos até o Neon em sa-east-1), e é o preço de o produto existir
  com a máquina desligada.
- **Depender do Neon estar de pé.** O plano gratuito não dá SLA. A
  mitigação é o próprio local: se o Neon cair, a API cai para ele e
  reconcilia depois — o mecanismo do ADR 003, agora no sentido inverso.
- **O `DATABASE_URL_LOCAL` continua obrigatório** mesmo onde não existe
  Postgres local, porque é o datasource do schema. Na instância do Render
  isso significa repetir ali a string do Neon; o `render.yaml` explica.

## Quando reconsiderar

Se o Atlas passar a rodar dentro de uma academia com servidor próprio na
mesma rede dos usuários, `DATABASE_PRIMARY=LOCAL` volta a ser a resposta
certa — e agora é só a variável, porque o roteador não assume mais qual
dos dois é o principal.
