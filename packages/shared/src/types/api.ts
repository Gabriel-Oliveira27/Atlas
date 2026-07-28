/**
 * Formato de resposta da API do Atlas.
 *
 * Toda rota responde no envelope abaixo — o front-end tem um único
 * caminho de tratamento de sucesso e de erro.
 */

import type { ErrorCode } from '../errors/error-codes.js';
import type { DatabaseNode } from '../enums/sync.js';

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ApiResponseMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: ApiResponseMeta;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface ApiResponseMeta {
  /** ISO 8601 — momento em que a resposta foi gerada. */
  timestamp: string;
  /** Correlaciona a resposta com a linha de log correspondente. */
  requestId?: string;
  /**
   * Qual banco atendeu esta requisição. Permite ao cliente avisar
   * o usuário quando está operando em modo de contingência (CLOUD).
   */
  servedBy?: DatabaseNode;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** Resposta de `GET /health`. */
export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptimeSeconds: number;
  nodeId: string;
  /** Banco que está atendendo as requisições agora. */
  activeDatabase: DatabaseNode | null;
  checks: {
    databaseLocal: DependencyHealth;
    databaseCloud: DependencyHealth;
    redis: DependencyHealth;
  };
}

export interface DependencyHealth {
  status: 'up' | 'down' | 'disabled';
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}
