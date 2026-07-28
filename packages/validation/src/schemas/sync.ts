/**
 * Schemas do protocolo de sincronização.
 *
 * Espelham os tipos de `@atlas/shared/types/sync`. O servidor valida
 * tudo que chega do dispositivo — payload de sync vem de cliente
 * offline e não pode ser considerado confiável.
 */

import { z } from 'zod';
import { isoDateSchema } from '../common.js';

export const changeOperationSchema = z.enum(['CREATE', 'UPDATE', 'DELETE']);

export const syncTriggerSchema = z.enum(['SCHEDULED', 'RECONNECT', 'MANUAL', 'DEVICE']);

export const syncDirectionSchema = z.enum(['LOCAL_TO_CLOUD', 'CLOUD_TO_LOCAL', 'BIDIRECTIONAL']);

/**
 * Entidades que participam da sincronização.
 *
 * Allowlist explícita: sem ela, um cliente malicioso poderia mandar
 * alterações para QUALQUER tabela — inclusive `Role` ou `Permission`.
 */
export const SYNCABLE_ENTITIES = [
  'User',
  'WorkoutPlan',
  'WorkoutDay',
  'WorkoutExercise',
  'WorkoutLog',
  'SetLog',
  'HydrationLog',
  'HydrationReminder',
  'Assessment',
  'BodyMeasurement',
  'AssessmentPhoto',
  'WeightLog',
  'DailyActivity',
  'Notification',
  'DeviceToken',
] as const;

export const syncableEntitySchema = z.enum(SYNCABLE_ENTITIES);
export type SyncableEntity = z.infer<typeof syncableEntitySchema>;

export const changeEnvelopeSchema = z.object({
  entity: syncableEntitySchema,
  entityId: z.string().min(1).max(64),
  operation: changeOperationSchema,
  /** Versão do registro na origem; base do Last-Write-Wins. */
  version: z.number().int().min(1),
  payload: z.record(z.unknown()),
  occurredAt: isoDateSchema,
  originNode: z.string().min(1).max(64),
});
export type ChangeEnvelopeInput = z.infer<typeof changeEnvelopeSchema>;

export const deviceIdSchema = z.string().min(1).max(128);

export const syncPushSchema = z.object({
  deviceId: deviceIdSchema,
  lastPulledAt: isoDateSchema.nullable(),
  /** Lote limitado a 1000 alterações para não estourar memória/timeout. */
  changes: z.array(changeEnvelopeSchema).max(1000),
});
export type SyncPushInput = z.infer<typeof syncPushSchema>;

export const syncPullSchema = z.object({
  deviceId: deviceIdSchema,
  /** null = primeira sincronização (carga completa). */
  lastPulledAt: isoDateSchema.nullable(),
  entities: z.array(syncableEntitySchema).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type SyncPullInput = z.infer<typeof syncPullSchema>;

/** Disparo manual de sincronização (admin ou workflow do n8n). */
export const triggerSyncSchema = z.object({
  direction: syncDirectionSchema.default('BIDIRECTIONAL'),
  entities: z.array(syncableEntitySchema).optional(),
  /** Ignora o cursor e reprocessa tudo. Operação cara — use com cuidado. */
  fullResync: z.boolean().default(false),
});
export type TriggerSyncInput = z.infer<typeof triggerSyncSchema>;

/** Resolução manual de um conflito registrado em `SyncConflict`. */
export const resolveConflictSchema = z.object({
  conflictId: z.string().min(1),
  resolution: z.enum(['LOCAL_WINS', 'CLOUD_WINS', 'MANUAL']),
  /** Payload final quando `resolution = MANUAL`. */
  mergedPayload: z.record(z.unknown()).optional(),
  note: z.string().max(500).optional(),
});
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;
