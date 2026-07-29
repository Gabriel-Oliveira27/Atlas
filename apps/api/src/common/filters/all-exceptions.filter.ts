/**
 * Filtro global de exceções.
 *
 * Traduz qualquer erro para o envelope `ApiErrorResponse`. O front-end
 * reage ao `code` (estável), nunca à mensagem — mensagens mudam com
 * tradução e revisão de texto.
 *
 * Detalhes internos (stack, causa, erro do Prisma) vão para o log e
 * NUNCA para o cliente: um erro de banco não pode revelar a estrutura
 * das tabelas.
 */

import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ERROR_CODES, type ApiErrorResponse, type ErrorCode } from '@atlas/shared';
import { isZodError } from '../errors/is-zod-error.js';
import { REQUEST_ID_HEADER } from '../interceptors/response.interceptor.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const { status, code, message, details } = this.describe(exception);

    // 5xx é falha nossa: loga com stack. 4xx é erro do cliente: só aviso.
    if (status >= 500) {
      this.logger.error(
        { err: exception, path: request.url, method: request.method },
        `Erro não tratado: ${message}`,
      );
    } else {
      this.logger.warn({ path: request.url, code }, message);
    }

    const body: ApiErrorResponse = {
      success: false,
      error: { code, message, ...(details ? { details } : {}) },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: request.id,
      },
    };

    // O header acompanha o erro também: é justamente no erro que o
    // usuário manda o print e alguém precisa achar a linha de log.
    void reply.header(REQUEST_ID_HEADER, request.id).status(status).send(body);
  }

  private describe(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (AppError.isAppError(exception)) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    // Erro de validação Zod → lista de campos inválidos.
    if (isZodError(exception)) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Dados inválidos',
        details: {
          issues: exception.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);

      return {
        status,
        code: this.httpStatusToCode(status),
        message: Array.isArray(message) ? message.join('; ') : message,
      };
    }

    // Erros do Prisma são identificados pelo `code` (P2002, P2025…).
    // Comparar por string de mensagem quebraria a cada atualização.
    const prismaCode = (exception as { code?: string })?.code;
    if (typeof prismaCode === 'string' && prismaCode.startsWith('P')) {
      return this.describePrisma(prismaCode);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Erro interno do servidor',
    };
  }

  private describePrisma(prismaCode: string): {
    status: number;
    code: ErrorCode;
    message: string;
  } {
    switch (prismaCode) {
      case 'P2002': // violação de índice único
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'Já existe um registro com esses dados',
        };
      case 'P2025': // registro não encontrado
        return {
          status: HttpStatus.NOT_FOUND,
          code: ERROR_CODES.NOT_FOUND,
          message: 'Registro não encontrado',
        };
      case 'P2003': // chave estrangeira inválida
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Referência inválida para outro registro',
        };
      case 'P1001': // banco inacessível
      case 'P1002':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: ERROR_CODES.DATABASE_UNAVAILABLE,
          message: 'Banco de dados indisponível',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Erro ao acessar os dados',
        };
    }
  }

  private httpStatusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMITED;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ERROR_CODES.VALIDATION_ERROR;
      default:
        return status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_ERROR;
    }
  }
}
