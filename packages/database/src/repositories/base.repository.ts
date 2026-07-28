/**
 * Repositório base do Atlas (Repository Pattern).
 *
 * Concentra o que TODO repositório sincronizável precisa fazer e que é
 * fácil esquecer numa implementação manual:
 *
 *   • incrementar `version` a cada escrita
 *   • carimbar `originNode`
 *   • usar exclusão lógica (`deletedAt`) em vez de DELETE
 *   • filtrar registros excluídos nas leituras
 *   • gravar a entrada correspondente no outbox (`ChangeLog`)
 *
 * O outbox é escrito NA MESMA TRANSAÇÃO da alteração. Se fosse depois,
 * uma queda entre as duas operações deixaria o dado gravado sem nunca
 * ser sincronizado — divergência silenciosa entre os bancos.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { CHANGE_OPERATION, DATABASE_NODE, type DatabaseNode } from '@atlas/shared';

/** Cliente ou transação — os métodos funcionam nos dois. */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface BaseRepositoryOptions {
  /** Identificador deste nó, gravado em `originNode`. */
  nodeId: string;
  /** Para onde as alterações devem ser propagadas. */
  targetNode: DatabaseNode;
  /**
   * Entidades fora desta lista não geram outbox (ex.: catálogo global
   * administrado só pelo servidor).
   */
  trackChanges?: boolean;
}

export interface SyncableFields {
  version: number;
  originNode: string;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Base genérica para repositórios de entidades sincronizáveis.
 *
 * `TDelegate` é o delegate do Prisma (ex.: `prisma.hydrationLog`). Ele
 * é recebido por parâmetro para que a classe não precise conhecer os
 * modelos concretos — só o contrato.
 */
export abstract class BaseRepository<TModel extends { id: string; version: number }> {
  protected constructor(
    protected readonly prisma: PrismaClient,
    protected readonly options: BaseRepositoryOptions,
  ) {}

  /** Nome do modelo Prisma, ex.: "HydrationLog". Usado no outbox. */
  protected abstract get entityName(): string;

  /** Delegate do Prisma correspondente ao modelo. */
  protected abstract getDelegate(client: PrismaTransaction): {
    findFirst: (args: unknown) => Promise<TModel | null>;
    findMany: (args: unknown) => Promise<TModel[]>;
    create: (args: unknown) => Promise<TModel>;
    update: (args: unknown) => Promise<TModel>;
    count: (args: unknown) => Promise<number>;
  };

  /** Campos de sincronização para uma criação. */
  protected creationStamp(): { version: number; originNode: string } {
    return { version: 1, originNode: this.options.nodeId };
  }

  /**
   * Campos de sincronização para uma atualização.
   * `version` sempre incrementa — é o que dá base ao Last-Write-Wins.
   */
  protected updateStamp(currentVersion: number): { version: number; originNode: string } {
    return { version: currentVersion + 1, originNode: this.options.nodeId };
  }

  /**
   * Grava a entrada no outbox.
   * DEVE ser chamada dentro da mesma transação da alteração.
   */
  protected async recordChange(
    tx: PrismaTransaction,
    params: {
      entityId: string;
      operation: (typeof CHANGE_OPERATION)[keyof typeof CHANGE_OPERATION];
      payload: Record<string, unknown>;
      version: number;
    },
  ): Promise<void> {
    if (this.options.trackChanges === false) return;

    await tx.changeLog.create({
      data: {
        entity: this.entityName,
        entityId: params.entityId,
        operation: params.operation,
        payload: params.payload as Prisma.InputJsonValue,
        version: params.version,
        originNode: this.options.nodeId,
        targetNode: this.options.targetNode,
      },
    });
  }

  /**
   * Filtro que exclui os tombstones.
   * Toda leitura de negócio deve usá-lo — só a sincronização enxerga
   * registros excluídos, porque precisa propagar a exclusão.
   */
  protected get notDeleted(): { deletedAt: null } {
    return { deletedAt: null };
  }

  /** Busca por ID ignorando registros excluídos. */
  async findById(id: string): Promise<TModel | null> {
    return this.getDelegate(this.prisma).findFirst({
      where: { id, ...this.notDeleted },
    });
  }

  /**
   * Exclusão lógica + entrada no outbox, em uma transação.
   *
   * Nunca faz DELETE físico: sem o tombstone, o outro banco continuaria
   * com o registro e a próxima sincronização o traria de volta.
   */
  async softDelete(id: string): Promise<TModel> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getDelegate(tx).findFirst({ where: { id, ...this.notDeleted } });

      if (!current) {
        throw new Error(`${this.entityName} não encontrado: ${id}`);
      }

      const updated = await this.getDelegate(tx).update({
        where: { id },
        data: {
          deletedAt: new Date(),
          ...this.updateStamp(current.version),
        },
      });

      await this.recordChange(tx, {
        entityId: id,
        operation: CHANGE_OPERATION.DELETE,
        payload: { id },
        version: updated.version,
      });

      return updated;
    });
  }
}

/** Opções padrão para repositórios que rodam no nó local. */
export function defaultRepositoryOptions(nodeId: string): BaseRepositoryOptions {
  return {
    nodeId,
    targetNode: DATABASE_NODE.CLOUD,
    trackChanges: true,
  };
}
