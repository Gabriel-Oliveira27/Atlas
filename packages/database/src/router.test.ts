/**
 * Testes do DatabaseRouter.
 *
 * Não precisam de Postgres: o roteador só conversa com os clientes por
 * `$queryRaw`, então dois objetos falsos bastam. Isso é de propósito —
 * a lógica de eleição é onde moram os erros sutis, e ela não deveria
 * exigir docker no ar para ser verificada.
 *
 * O foco é a simetria principal/secundário do ADR 008. A versão anterior
 * do roteador falava "local" e "nuvem" onde queria dizer "principal" e
 * "secundário", e com `DATABASE_PRIMARY=CLOUD` isso produzia dois bugs
 * silenciosos que os casos abaixo prendem:
 *
 *   • `isDegraded()` devolvia false rodando em contingência;
 *   • a reconciliação nunca disparava, porque esperava voltar ao LOCAL.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { DATABASE_NODE } from '@atlas/shared';
import { DatabaseRouter, type NodeChangeEvent, type SecondaryAvailableEvent } from './router.js';

/** Estado de disponibilidade que os clientes falsos consultam. */
interface Estado {
  local: boolean;
  cloud: boolean;
}

function clienteFalso(estado: Estado, no: keyof Estado): PrismaClient {
  return {
    $queryRaw: () =>
      estado[no] ? Promise.resolve([{ um: 1 }]) : Promise.reject(new Error(`${no} fora do ar`)),
  } as unknown as PrismaClient;
}

function montar(primary: 'LOCAL' | 'CLOUD', estado: Estado) {
  const nodeChanges: NodeChangeEvent[] = [];
  const secondaryBacks: SecondaryAvailableEvent[] = [];

  const router = new DatabaseRouter({
    clients: {
      local: clienteFalso(estado, 'local'),
      cloud: clienteFalso(estado, 'cloud'),
    },
    primary,
    // Alto de propósito: os testes chamam `checkHealth()` na mão, e um
    // intervalo curto deixaria o timer disparar no meio das asserções.
    healthCheckIntervalMs: 999_999,
    onNodeChange: (event) => {
      nodeChanges.push(event);
    },
    onSecondaryAvailable: (event) => {
      secondaryBacks.push(event);
    },
  });

  return { router, nodeChanges, secondaryBacks };
}

describe('DatabaseRouter com o Neon como principal', () => {
  it('atende pelo Neon quando os dois respondem', async () => {
    const estado: Estado = { local: true, cloud: true };
    const { router } = montar('CLOUD', estado);

    await router.start();

    expect(router.getActiveNode()).toBe(DATABASE_NODE.CLOUD);
    expect(router.isDegraded()).toBe(false);
    expect(router.secondaryNode()).toBe(DATABASE_NODE.LOCAL);

    router.stop();
  });

  it('cai para o local e se declara degradado quando o Neon sai', async () => {
    const estado: Estado = { local: true, cloud: true };
    const { router } = montar('CLOUD', estado);
    await router.start();

    estado.cloud = false;
    await router.checkHealth();

    expect(router.getActiveNode()).toBe(DATABASE_NODE.LOCAL);
    // O bug antigo: `isDegraded` exigia primary === LOCAL e devolvia
    // false aqui, então a interface não avisava ninguém.
    expect(router.isDegraded()).toBe(true);

    router.stop();
  });

  it('dispara a reconciliação quando o Neon volta', async () => {
    const estado: Estado = { local: true, cloud: true };
    const { router, nodeChanges } = montar('CLOUD', estado);
    await router.start();

    estado.cloud = false;
    await router.checkHealth();
    estado.cloud = true;
    await router.checkHealth();

    expect(router.getActiveNode()).toBe(DATABASE_NODE.CLOUD);
    expect(router.isDegraded()).toBe(false);
    // O outro bug antigo: a recuperação era `next === LOCAL`, então
    // invertida ela nunca acontecia e nada era reconciliado.
    expect(nodeChanges.filter((e) => e.recovered)).toHaveLength(1);

    router.stop();
  });

  it('avisa quando o secundário volta, sem trocar o nó ativo', async () => {
    const estado: Estado = { local: true, cloud: true };
    const { router, secondaryBacks } = montar('CLOUD', estado);
    await router.start();

    estado.local = false;
    await router.checkHealth();
    expect(router.getActiveNode()).toBe(DATABASE_NODE.CLOUD);
    expect(secondaryBacks).toHaveLength(0);

    estado.local = true;
    await router.checkHealth();

    // É o gancho que mantém o local atualizado sem esperar as 03:00.
    expect(secondaryBacks).toHaveLength(1);
    expect(secondaryBacks[0]?.node).toBe(DATABASE_NODE.LOCAL);
    expect(router.getActiveNode()).toBe(DATABASE_NODE.CLOUD);

    router.stop();
  });

  it('não avisa o secundário no primeiro check, para não sincronizar a cada reinício', async () => {
    // Sobe já com o local fora: não existe transição, então não há aviso.
    const estado: Estado = { local: false, cloud: true };
    const { router, secondaryBacks } = montar('CLOUD', estado);

    await router.start();

    expect(secondaryBacks).toHaveLength(0);
    expect(router.getActiveNode()).toBe(DATABASE_NODE.CLOUD);

    router.stop();
  });

  it('recusa atender quando nenhum dos dois responde', async () => {
    const estado: Estado = { local: false, cloud: false };
    const { router } = montar('CLOUD', estado);

    await router.start();

    expect(router.getActiveNode()).toBeNull();
    expect(() => router.getClient()).toThrow();

    router.stop();
  });
});

describe('DatabaseRouter com o local como principal (comportamento do ADR 003)', () => {
  it('continua priorizando o local e reconciliando quando ele volta', async () => {
    const estado: Estado = { local: true, cloud: true };
    const { router, nodeChanges } = montar('LOCAL', estado);
    await router.start();

    expect(router.getActiveNode()).toBe(DATABASE_NODE.LOCAL);
    expect(router.secondaryNode()).toBe(DATABASE_NODE.CLOUD);

    estado.local = false;
    await router.checkHealth();
    expect(router.getActiveNode()).toBe(DATABASE_NODE.CLOUD);
    expect(router.isDegraded()).toBe(true);

    estado.local = true;
    await router.checkHealth();
    expect(router.getActiveNode()).toBe(DATABASE_NODE.LOCAL);
    expect(nodeChanges.filter((e) => e.recovered)).toHaveLength(1);

    router.stop();
  });
});

describe('DatabaseRouter sem Neon configurado', () => {
  it('não enxerga secundário e não tenta avisar sobre ele', async () => {
    const estado: Estado = { local: true, cloud: true };
    const onSecondaryAvailable = vi.fn();

    const router = new DatabaseRouter({
      clients: { local: clienteFalso(estado, 'local'), cloud: null },
      primary: 'LOCAL',
      healthCheckIntervalMs: 999_999,
      onSecondaryAvailable,
    });

    await router.start();

    expect(router.secondaryNode()).toBeNull();
    expect(onSecondaryAvailable).not.toHaveBeenCalled();
    expect(router.getActiveNode()).toBe(DATABASE_NODE.LOCAL);

    router.stop();
  });
});
