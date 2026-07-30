/**
 * Contrato do protocolo de sincronização (delta-sync).
 *
 * Este arquivo é a fonte da verdade do formato trocado entre
 * dispositivo e servidor. O cliente offline (SQLite no mobile,
 * IndexedDB no web) implementa exatamente estes tipos.
 *
 * Visão completa: `docs/offline-sync.md`.
 */

import type {
  ChangeOperation,
  ConflictResolution,
  DatabaseNode,
  SyncDirection,
  SyncPhase,
  SyncRunStatus,
  SyncTrigger,
} from '../enums/sync.js';

/**
 * Campos que todo registro sincronizável carrega.
 *
 * - `version`: incrementa a cada escrita; base do Last-Write-Wins.
 * - `deletedAt`: exclusão é lógica (tombstone) — apagar de verdade
 *   impediria propagar a remoção para os outros nós.
 * - `originNode`: quem escreveu; evita que a alteração volte para a origem.
 */
export interface SyncableRecord {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  originNode: string;
}

/** Uma alteração individual trafegando na sincronização. */
export interface ChangeEnvelope<T = Record<string, unknown>> {
  /** Nome do modelo Prisma, ex.: "HydrationLog". */
  entity: string;
  entityId: string;
  operation: ChangeOperation;
  version: number;
  /** Estado completo do registro. Em DELETE, só as chaves. */
  payload: T;
  /** ISO 8601 — quando a alteração ocorreu no dispositivo/nó de origem. */
  occurredAt: string;
  originNode: string;
}

// ── Push: dispositivo → servidor ────────────────────────────────

export interface SyncPushRequest {
  deviceId: string;
  /** Cursor da última sincronização bem-sucedida deste dispositivo. */
  lastPulledAt: string | null;
  changes: ChangeEnvelope[];
}

export interface SyncPushResponse {
  /** Novo cursor: o dispositivo deve guardar e enviar no próximo pull. */
  syncedAt: string;
  accepted: number;
  rejected: SyncRejection[];
  conflicts: SyncConflictReport[];
}

export interface SyncRejection {
  entity: string;
  entityId: string;
  reason: string;
  code: string;
}

// ── Pull: servidor → dispositivo ────────────────────────────────

export interface SyncPullRequest {
  deviceId: string;
  /** null = primeira sincronização (carga completa). */
  lastPulledAt: string | null;
  /** Limita o pull a estas entidades. Vazio/ausente = todas. */
  entities?: string[];
  limit?: number;
}

export interface SyncPullResponse {
  syncedAt: string;
  changes: ChangeEnvelope[];
  /** true quando ainda há mais páginas — repita o pull com o novo cursor. */
  hasMore: boolean;
  serverNode: DatabaseNode;
}

// ── Conflitos e execuções ───────────────────────────────────────

export interface SyncConflictReport {
  entity: string;
  entityId: string;
  localVersion: number;
  remoteVersion: number;
  resolution: ConflictResolution;
  /** true quando exigiu decisão humana e ficou pendente. */
  requiresManualReview: boolean;
}

/** Resumo de uma execução de sincronização (agendada, manual ou por reconexão). */
export interface SyncRunSummary {
  id: string;
  trigger: SyncTrigger;
  direction: SyncDirection;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  pushed: number;
  pulled: number;
  conflicts: number;
  failed: number;
  errorMessage: string | null;
}

/** Estado atual da sincronização — alimenta o painel de admin e a UI do app. */
export interface SyncStatusResponse {
  activeDatabase: DatabaseNode;
  localAvailable: boolean;
  cloudAvailable: boolean;
  pendingChanges: number;
  unresolvedConflicts: number;
  lastRun: SyncRunSummary | null;
  nextScheduledRun: string | null;
}

/**
 * Progresso ao vivo da sincronização servidor↔servidor.
 *
 * O `SyncStatusResponse` acima só conta a história DEPOIS: ele lê o
 * último `SyncRun`, que só existe quando a execução terminou. Isto aqui
 * é o que permite acompanhar enquanto acontece — quanto falta, o que
 * está sendo aplicado agora e o que ainda está na fila.
 */
export interface SyncProgressResponse {
  running: boolean;
  phase: SyncPhase;
  direction: SyncDirection | null;
  startedAt: string | null;
  /** Entradas a aplicar nesta execução, medidas antes de começar. */
  total: number;
  processed: number;
  /** 0–100. Vale 100 quando não há nada a fazer — nada pendente é 100% em dia. */
  percent: number;
  /** Entidade sendo aplicada neste instante. */
  currentEntity: string | null;
  applied: number;
  conflicts: number;
  failed: number;
  /**
   * O que ainda não foi aplicado, por entidade e por sentido.
   *
   * Continua respondendo com a sincronização parada: é a resposta para
   * "o que ainda vai ser baixado" antes de qualquer execução começar.
   */
  pending: SyncPendingByEntity[];
  /** Preenchido quando um dos bancos não pôde ser consultado. */
  unavailable: DatabaseNode[];
}

export interface SyncPendingByEntity {
  entity: string;
  /** Entradas esperando para subir ao Neon. */
  toCloud: number;
  /** Entradas esperando para descer ao local. */
  toLocal: number;
}
