/**
 * Enums da camada de sincronização.
 *
 * A estratégia completa está em `docs/offline-sync.md`.
 */

/** Qual banco está atendendo as requisições no momento. */
export const DATABASE_NODE = {
  LOCAL: 'LOCAL',
  CLOUD: 'CLOUD',
} as const;
export type DatabaseNode = (typeof DATABASE_NODE)[keyof typeof DATABASE_NODE];

/** Operação registrada no outbox (`ChangeLog`). */
export const CHANGE_OPERATION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
} as const;
export type ChangeOperation = (typeof CHANGE_OPERATION)[keyof typeof CHANGE_OPERATION];

/** Ciclo de vida de uma entrada do outbox. */
export const CHANGE_STATUS = {
  PENDING: 'PENDING',
  SYNCED: 'SYNCED',
  CONFLICT: 'CONFLICT',
  FAILED: 'FAILED',
} as const;
export type ChangeStatus = (typeof CHANGE_STATUS)[keyof typeof CHANGE_STATUS];

/** O que disparou uma execução de sincronização. */
export const SYNC_TRIGGER = {
  /** Agendamento fixo: 03:00 e 18:00 (America/Sao_Paulo). */
  SCHEDULED: 'SCHEDULED',
  /**
   * Um dos bancos voltou a responder — reconciliação imediata. Vale para
   * o principal voltando (reconcilia nos dois sentidos) e para o
   * secundário voltando (recebe o que perdeu enquanto esteve fora).
   */
  RECONNECT: 'RECONNECT',
  /** Disparo manual (admin ou workflow do n8n). */
  MANUAL: 'MANUAL',
  /** Push/pull originado de um dispositivo. */
  DEVICE: 'DEVICE',
} as const;
export type SyncTrigger = (typeof SYNC_TRIGGER)[keyof typeof SYNC_TRIGGER];

export const SYNC_DIRECTION = {
  LOCAL_TO_CLOUD: 'LOCAL_TO_CLOUD',
  CLOUD_TO_LOCAL: 'CLOUD_TO_LOCAL',
  BIDIRECTIONAL: 'BIDIRECTIONAL',
} as const;
export type SyncDirection = (typeof SYNC_DIRECTION)[keyof typeof SYNC_DIRECTION];

export const SYNC_RUN_STATUS = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
} as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUS)[keyof typeof SYNC_RUN_STATUS];

/**
 * Como um conflito foi (ou será) resolvido.
 *
 * - LAST_WRITE_WINS: vence o maior `version`; empate desempata por `updatedAt`.
 * - MERGE_UNION: coleções append-only (ex.: HydrationLog) — mantém os dois lados.
 * - MANUAL: divergência que exige decisão humana; fica registrada em `SyncConflict`.
 */
export const CONFLICT_RESOLUTION = {
  LAST_WRITE_WINS: 'LAST_WRITE_WINS',
  MERGE_UNION: 'MERGE_UNION',
  LOCAL_WINS: 'LOCAL_WINS',
  CLOUD_WINS: 'CLOUD_WINS',
  MANUAL: 'MANUAL',
} as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTION)[keyof typeof CONFLICT_RESOLUTION];
