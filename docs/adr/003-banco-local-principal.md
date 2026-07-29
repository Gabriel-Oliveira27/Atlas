# ADR 003 — PostgreSQL local como banco principal, Neon como secundário

**Status:** parcialmente superado pelo
[ADR 008](008-neon-principal-local-secundario.md) — desde 29/07/2026 o
principal é o Neon. O motivo está lá: o notebook desliga, e o produto
saía do ar com ele. Continua valendo daqui o schema único, a regra de
roteamento (que virou simétrica), o custo de sincronização e a seção
"quando reconsiderar" — que é justamente o que se cumpriu.
**Data:** 2026-07-27

## Contexto

A especificação define que o banco principal é um PostgreSQL local, e o
Neon atua como redundância, backup e operação temporária. Isso inverte o
padrão usual (nuvem primeiro), então vale registrar o porquê e as
implicações.

O Atlas é usado **dentro da academia**. Nesse ambiente:

- o sinal de celular costuma ser fraco (subsolos, salas com estrutura metálica);
- o usuário registra séries a cada 60–90 segundos, entre exercícios;
- uma escrita que falha no meio do treino é percebida imediatamente.

Latência de rede aqui não é métrica de dashboard: é o usuário parado
esperando o app responder com o halter na mão.

## Decisão

**PostgreSQL local é o principal. O Neon é secundário.**

Regra de roteamento, implementada em `DatabaseRouter`:

```
banco local acessível     → SEMPRE usa o local
banco local inacessível   → usa o Neon temporariamente
banco local voltou        → volta ao local + reconcilia
```

Um schema Prisma único vale para os dois bancos; o que muda em runtime é
apenas a URL do datasource.

## Consequências

**Positivas**

- Leitura e escrita em rede local: latência de milissegundos.
- Funciona com a internet fora — cenário real, não hipotético.
- Custo previsível: o volume de dados fica no hardware próprio.
- O Neon garante que uma falha de hardware não perca dados.

**Negativas**

- **Complexidade de sincronização.** É o custo central desta decisão:
  dois bancos que aceitam escrita exigem versionamento, tombstones,
  detecção e resolução de conflito. Endereçado no
  [ADR 004](004-sincronizacao-outbox.md).
- **Janela de divergência.** Entre o local cair e a reconciliação
  terminar, os bancos diferem. Aceitável para dados de treino; não seria
  para um sistema financeiro.
- **Operação em máquina própria.** Backup, atualização e disco passam a
  ser responsabilidade de quem hospeda.

**Mitigações adotadas**

- Health check a cada 15 s com timeout de 3 s — sem o timeout, um banco
  inacessível prenderia a requisição até o timeout de TCP do sistema
  operacional (dezenas de segundos) em vez de cair para o Neon em poucos.
- Reconciliação automática ao restabelecer, sem intervenção manual.
- `GET /health` expõe qual banco está atendendo; a Home devolve
  `degraded: true` para que o app avise o usuário.
- Conflitos que a resolução automática não cobre ficam em
  `SyncConflict` para decisão humana, em vez de sumirem.

## Quando reconsiderar

Se o Atlas passar a atender **muitas academias em locais diferentes**, um
banco local por instalação deixa de fazer sentido — cada unidade teria
sua própria ilha de dados. Nesse cenário, o modelo natural passa a ser
Neon como principal, com cache local por unidade. O `DatabaseRouter` já
suporta a inversão: basta `DATABASE_PRIMARY=CLOUD`.
