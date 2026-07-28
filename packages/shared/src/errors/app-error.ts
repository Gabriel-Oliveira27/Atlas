/**
 * Erro de aplicação do Atlas.
 *
 * Carrega um `ErrorCode` estável e um status HTTP. A API converte
 * qualquer `AppError` em resposta padronizada (ver `ApiErrorResponse`);
 * o front-end reage ao `code`.
 */

import { ERROR_CODES, type ErrorCode } from './error-codes.js';

export interface AppErrorOptions {
  /** Status HTTP a devolver. Padrão: 400. */
  status?: number;
  /** Dados extras seguros para expor ao cliente (ex.: campos inválidos). */
  details?: Record<string, unknown>;
  /** Erro original, preservado para o log. Nunca é enviado ao cliente. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details;

    // Mantém o stack apontando para quem lançou, não para este construtor.
    Error.captureStackTrace?.(this, AppError);
  }

  /** Serialização segura para o cliente (sem `cause`, sem stack). */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }

  // ── Atalhos para os casos mais comuns ─────────────────────────

  static notFound(resource: string, id?: string): AppError {
    return new AppError(
      ERROR_CODES.NOT_FOUND,
      id ? `${resource} não encontrado: ${id}` : `${resource} não encontrado`,
      { status: 404, details: id ? { resource, id } : { resource } },
    );
  }

  static validation(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, message, { status: 422, details });
  }

  static unauthenticated(message = 'Autenticação necessária'): AppError {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, message, { status: 401 });
  }

  static forbidden(message = 'Acesso negado'): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, message, { status: 403 });
  }

  static conflict(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(ERROR_CODES.CONFLICT, message, { status: 409, details });
  }

  /**
   * Nenhum dos bancos (local nem Neon) respondeu. É a única situação
   * em que o Atlas não consegue atender a requisição.
   */
  static allDatabasesUnavailable(): AppError {
    return new AppError(
      ERROR_CODES.ALL_DATABASES_UNAVAILABLE,
      'Nenhum banco de dados disponível (local e nuvem inacessíveis)',
      { status: 503 },
    );
  }

  static internal(message = 'Erro interno', cause?: unknown): AppError {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, message, { status: 500, cause });
  }

  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}
