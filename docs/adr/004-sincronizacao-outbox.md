# ADR 004 — Sincronização por outbox (`ChangeLog`)

**Status:** aceito
**Data:** 2026-07-27

## Contexto

Com dois bancos que aceitam escrita ([ADR 003](003-banco-local-principal.md))
e dispositivos que escrevem offline, é preciso um mecanismo que propague
alterações de forma confiável.

## Alternativas

### 1. Varredura por `updatedAt`

"Traga tudo que mudou desde a última sincronização."

**Por que não:** falha em três pontos que importam.

- **Não detecta exclusões.** Um registro apagado simplesmente some — a
  varredura não tem o que retornar, e o outro banco fica com o dado
  para sempre.
- **Perde a ordem.** Criar um `WorkoutLog` e depois um `SetLog` que o
  referencia pode ser aplicado ao contrário, quebrando a chave estrangeira.
- **Sofre com relógios.** Se os servidores tiverem horários levemente
  diferentes, registros escapam da janela e nunca sincronizam.

### 2. Replicação lógica do PostgreSQL

**Por que não:** resolve local↔Neon, mas não atende dispositivos móveis
(um celular não é um nó de replicação), e a resolução de conflito fica
presa ao que o Postgres oferece — sem espaço para regras de domínio
como "hidratação é append-only".

### 3. CRDTs

**Por que não:** convergência automática é elegante, mas exige remodelar
todas as entidades em estruturas CRDT e traz uma biblioteca pesada.
Desproporcional para o volume de conflito real do Atlas (o mesmo usuário,
em poucos dispositivos).

### 4. Outbox transacional ← **escolhida**

Toda escrita grava, **na mesma transação**, uma entrada em `ChangeLog`
descrevendo o que mudou.

## Decisão

**Outbox transacional**, com estes campos em todo registro sincronizável:

| Campo        | Função                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| `version`    | Incrementa a cada escrita. Base do Last-Write-Wins.                       |
| `deletedAt`  | Exclusão lógica (tombstone) — é o que permite propagar remoções.          |
| `originNode` | Quem escreveu. Evita que a alteração volte para a origem em eco infinito. |
| `updatedAt`  | Desempate quando as versões são iguais.                                   |

**A entrada no outbox vai na mesma transação da alteração.** Gravá-la
depois abriria uma janela em que uma queda deixaria o dado salvo mas
nunca sincronizado — uma divergência silenciosa, o pior tipo.

### Resolução de conflitos

| Estratégia        | Quando                                 | Exemplo                  |
| ----------------- | -------------------------------------- | ------------------------ |
| `LAST_WRITE_WINS` | Registros editáveis                    | perfil, plano de treino  |
| `MERGE_UNION`     | Coleções append-only                   | hidratação, séries, peso |
| `MANUAL`          | Versões iguais com conteúdo divergente | fica em `SyncConflict`   |

`MERGE_UNION` merece destaque: dois copos de água registrados offline em
aparelhos diferentes são **ambos verdadeiros**. Aplicar Last-Write-Wins
aqui apagaria água que a pessoa realmente bebeu.

## Consequências

**Positivas**

- Exclusões propagam corretamente.
- Ordem preservada (o outbox é processado por `occurredAt`).
- Imune a diferença de relógio entre servidores (usa versão, não data).
- Trilha de auditoria completa: dá para responder "por que este registro
  está assim?".
- Funciona igual para servidor↔servidor e dispositivo↔servidor.

**Negativas**

- **`ChangeLog` cresce.** Precisa de expurgo periódico das entradas
  `SYNCED` antigas (previsto no roadmap Beta).
- **Escrita dupla.** Cada alteração grava duas linhas. O custo é pequeno
  perto do risco de divergência.
- **Disciplina obrigatória.** Toda escrita nova precisa registrar o
  outbox. `BaseRepository` centraliza isso justamente para que o padrão
  não dependa de alguém lembrar.

**Negativa aceita conscientemente**

- Tombstones nunca são removidos automaticamente. Apagá-los cedo demais
  faria um dispositivo que ficou meses offline "ressuscitar" registros
  excluídos ao sincronizar.
