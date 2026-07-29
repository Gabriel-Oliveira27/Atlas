/**
 * Delta-sync dos dispositivos (Camada B da estratégia offline-first).
 *
 * Contrato:
 *   push → dispositivo envia o que alterou offline
 *   pull → dispositivo recebe o que mudou desde `lastPulledAt`
 *
 * O cursor por dispositivo (`SyncCursor`) é o que torna o pull
 * incremental: sem ele, cada abertura do app baixaria a base inteira.
 *
 * SEGURANÇA: o payload vem de um cliente offline e não é confiável.
 * Duas defesas obrigatórias, aplicadas aqui:
 *   1. a entidade precisa estar na allowlist (`SYNCABLE_ENTITIES`)
 *   2. o registro precisa pertencer ao usuário autenticado — sem isso,
 *      um cliente poderia alterar dados de outra pessoa
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  findSyncEntity,
  syncEntitiesInOrder,
  type PrismaClient,
  type SyncEntityDefinition,
} from '@atlas/database';
import {
  CHANGE_OPERATION,
  CONFLICT_RESOLUTION,
  DATABASE_NODE,
  ERROR_CODES,
  type ChangeEnvelope,
  type SyncConflictReport,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncRejection,
} from '@atlas/shared';
import type { SyncPullInput, SyncPushInput } from '@atlas/validation';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class DeviceSyncService {
  private readonly logger = new Logger(DeviceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  /** Recebe e aplica as alterações vindas de um dispositivo. */
  async push(userId: string, input: SyncPushInput): Promise<SyncPushResponse> {
    const db = this.prisma.db;
    const syncedAt = new Date();

    const rejected: SyncRejection[] = [];
    const conflicts: SyncConflictReport[] = [];
    let accepted = 0;

    // Ordena por dependência: um SetLog não pode ser gravado antes do
    // WorkoutLog que ele referencia.
    const entityOrder = new Map(syncEntitiesInOrder().map((entity, index) => [entity.name, index]));
    const changes = [...input.changes].sort(
      (a, b) => (entityOrder.get(a.entity) ?? 99) - (entityOrder.get(b.entity) ?? 99),
    );

    for (const change of changes) {
      const definition = findSyncEntity(change.entity);

      if (!definition) {
        rejected.push({
          entity: change.entity,
          entityId: change.entityId,
          reason: 'Entidade não sincronizável',
          code: ERROR_CODES.VALIDATION_ERROR,
        });
        continue;
      }

      // Verificação de posse do que o cliente AFIRMA ser dele. A posse
      // do registro que já existe no servidor é conferida dentro de
      // `applyDeviceChange` — ver a nota lá sobre por que as duas são
      // necessárias.
      if (definition.userScopeField) {
        const ownerId =
          definition.userScopeField === 'id'
            ? change.entityId
            : (change.payload as Record<string, unknown>)[definition.userScopeField];

        if (ownerId !== userId) {
          this.logger.warn(
            { userId, entity: change.entity, entityId: change.entityId },
            'Dispositivo tentou sincronizar registro de outro usuário — rejeitado.',
          );
          rejected.push({
            entity: change.entity,
            entityId: change.entityId,
            reason: 'Registro não pertence ao usuário autenticado',
            code: ERROR_CODES.FORBIDDEN,
          });
          continue;
        }
      }

      try {
        const outcome = await this.applyDeviceChange(db, userId, change, definition);

        if (outcome.rejection) {
          rejected.push(outcome.rejection);
        } else if (outcome.conflict) {
          conflicts.push(outcome.conflict);
        } else {
          accepted += 1;
        }
      } catch (error) {
        rejected.push({
          entity: change.entity,
          entityId: change.entityId,
          reason: error instanceof Error ? error.message : String(error),
          code: ERROR_CODES.INTERNAL_ERROR,
        });
      }
    }

    await this.updateCursor(userId, input.deviceId, { lastPushedAt: syncedAt });

    return {
      syncedAt: syncedAt.toISOString(),
      accepted,
      rejected,
      conflicts,
    };
  }

  /** Entrega ao dispositivo tudo que mudou desde o cursor dele. */
  async pull(userId: string, input: SyncPullInput): Promise<SyncPullResponse> {
    const db = this.prisma.db;
    const syncedAt = new Date();
    const since = input.lastPulledAt ? new Date(input.lastPulledAt) : null;

    const requestedNames = new Set<string>(input.entities ?? []);
    const requested = requestedNames.size
      ? syncEntitiesInOrder().filter((entity) => requestedNames.has(entity.name))
      : syncEntitiesInOrder();

    const changes: ChangeEnvelope[] = [];
    let hasMore = false;

    for (const definition of requested) {
      if (changes.length >= input.limit) {
        hasMore = true;
        break;
      }

      const delegate = (db as unknown as Record<string, PullDelegate>)[
        definition.delegate as string
      ];
      if (!delegate) continue;

      const where: Record<string, unknown> = {
        ...(since ? { updatedAt: { gt: since } } : {}),
        // Entidades com dono só trafegam os registros do próprio usuário.
        ...(definition.userScopeField
          ? { [definition.userScopeField]: definition.userScopeField === 'id' ? userId : userId }
          : {}),
      };

      const rows = await delegate.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        take: input.limit - changes.length,
      });

      for (const row of rows) {
        const record = row as Record<string, unknown> & {
          id: string;
          version: number;
          updatedAt: Date;
          deletedAt: Date | null;
          originNode: string;
        };

        changes.push({
          entity: definition.name,
          entityId: record.id,
          // Tombstone vira DELETE para o dispositivo remover localmente.
          operation: record.deletedAt ? CHANGE_OPERATION.DELETE : CHANGE_OPERATION.UPDATE,
          version: record.version,
          payload: record,
          occurredAt: record.updatedAt.toISOString(),
          originNode: record.originNode,
        });
      }
    }

    await this.updateCursor(userId, input.deviceId, { lastPulledAt: syncedAt });

    return {
      syncedAt: syncedAt.toISOString(),
      changes,
      hasMore,
      serverNode: this.prisma.activeNode ?? DATABASE_NODE.LOCAL,
    };
  }

  private async applyDeviceChange(
    db: PrismaClient,
    userId: string,
    change: SyncPushInput['changes'][number],
    definition: SyncEntityDefinition,
  ): Promise<{ conflict?: SyncConflictReport; rejection?: SyncRejection }> {
    const delegate = (db as unknown as Record<string, PushDelegate>)[definition.delegate as string];
    if (!delegate) throw new Error(`Delegate ausente: ${String(definition.delegate)}`);

    const existing = (await delegate.findUnique({ where: { id: change.entityId } })) as
      (Record<string, unknown> & { version?: number }) | null;

    const payload = { ...change.payload } as Record<string, unknown>;
    // O cliente não define estes campos: quem manda é o servidor.
    delete payload.id;
    delete payload.version;
    delete payload.originNode;

    if (!existing) {
      if (change.operation === CHANGE_OPERATION.DELETE) return {};

      await delegate.create({
        data: {
          ...payload,
          id: change.entityId,
          version: change.version,
          originNode: change.originNode,
        },
      });
      return {};
    }

    // Posse do registro que JÁ EXISTE no servidor.
    //
    // A checagem em `push` valida o dono declarado no payload, que é
    // texto vindo do cliente. Sem esta segunda checagem, bastava enviar
    // `entityId` de um registro alheio com `userId` próprio no payload:
    // a primeira passava, e o update reescrevia — e reatribuía — o dado
    // de outra pessoa.
    if (definition.userScopeField) {
      const currentOwner =
        definition.userScopeField === 'id'
          ? (existing.id as string)
          : (existing[definition.userScopeField] as string | undefined);

      if (currentOwner !== userId) {
        this.logger.warn(
          { userId, entity: change.entity, entityId: change.entityId },
          'Dispositivo tentou sobrescrever registro existente de outro usuário — rejeitado.',
        );

        return {
          rejection: {
            entity: change.entity,
            entityId: change.entityId,
            reason: 'Registro não pertence ao usuário autenticado',
            code: ERROR_CODES.FORBIDDEN,
          },
        };
      }

      // Reatribuir dono via sincronização nunca é legítimo.
      delete payload[definition.userScopeField];
    }

    const existingVersion = existing.version ?? 0;

    // Append-only: o registro já existe com o mesmo id — nada a fazer.
    if (definition.resolution === CONFLICT_RESOLUTION.MERGE_UNION) return {};

    if (change.version > existingVersion) {
      await delegate.update({
        where: { id: change.entityId },
        data: {
          ...payload,
          version: change.version,
          originNode: change.originNode,
          ...(change.operation === CHANGE_OPERATION.DELETE ? { deletedAt: new Date() } : {}),
        },
      });
      return {};
    }

    if (change.version === existingVersion) {
      const conflict: SyncConflictReport = {
        entity: change.entity,
        entityId: change.entityId,
        localVersion: change.version,
        remoteVersion: existingVersion,
        resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
        requiresManualReview: false,
      };

      // Registrar o conflito é o ponto: antes ele só aparecia na
      // resposta daquela requisição e sumia. Persistido, os dois lados
      // ficam disponíveis para inspeção — nenhum dado se perde em
      // silêncio, que é a regra do protocolo (ver docs/offline-sync.md).
      await this.recordConflict(db, change, existing, existingVersion);

      return { conflict };
    }

    // Alteração antiga: o servidor já tem versão mais nova. Descartada.
    return {};
  }

  /** Guarda os dois lados da divergência para inspeção posterior. */
  private async recordConflict(
    db: PrismaClient,
    change: SyncPushInput['changes'][number],
    serverRecord: Record<string, unknown>,
    serverVersion: number,
  ): Promise<void> {
    await db.syncConflict.create({
      data: {
        entity: change.entity,
        entityId: change.entityId,
        localVersion: change.version,
        cloudVersion: serverVersion,
        localPayload: change.payload as never,
        cloudPayload: serverRecord as never,
        resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
        resolved: false,
        note: 'Divergência de versão em push de dispositivo',
      },
    });
  }

  private async updateCursor(
    userId: string,
    deviceId: string,
    data: { lastPulledAt?: Date; lastPushedAt?: Date },
  ): Promise<void> {
    await this.prisma.db.syncCursor.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      update: data,
      create: { userId, deviceId, ...data },
    });
  }
}

interface PullDelegate {
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy: Record<string, string>;
    take: number;
  }) => Promise<unknown[]>;
}

interface PushDelegate {
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
}
