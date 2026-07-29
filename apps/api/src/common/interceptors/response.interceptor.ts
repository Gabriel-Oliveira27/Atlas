/**
 * Envelopa toda resposta bem-sucedida em `ApiSuccessResponse`.
 *
 * Um formato único de resposta significa um único caminho de parsing
 * no web e no mobile — nada de "essa rota devolve array, aquela devolve
 * objeto". Rotas anotadas com `@RawResponse()` (ex.: redirect do OAuth)
 * ficam de fora.
 */

import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { map, type Observable } from 'rxjs';
import type { ApiSuccessResponse, PaginatedResult } from '@atlas/shared';

export const RAW_RESPONSE_KEY = 'atlas:raw-response';
export const REQUEST_ID_HEADER = 'x-request-id';

/** Desliga o envelope na rota (redirects, downloads, webhooks). */
export const RawResponse = (): MethodDecorator => SetMetadata(RAW_RESPONSE_KEY, true);

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  private readonly reflector = new Reflector();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    // O mesmo id vai no header e no envelope — é assim que o suporte
    // liga o print do usuário à linha de log. Vale inclusive nas rotas
    // sem envelope (redirect do OAuth, webhooks).
    void reply.header(REQUEST_ID_HEADER, request.id);

    if (isRaw) return next.handle();

    return next.handle().pipe(
      map((data: unknown): ApiSuccessResponse<unknown> => {
        // Resultado paginado: move `meta` para o envelope, para o cliente
        // ler paginação sempre no mesmo lugar.
        if (isPaginated(data)) {
          return {
            success: true,
            data: data.items,
            meta: {
              timestamp: new Date().toISOString(),
              requestId: request.id,
              pagination: data.meta,
            },
          };
        }

        return {
          success: true,
          data: data ?? null,
          meta: { timestamp: new Date().toISOString(), requestId: request.id },
        };
      }),
    );
  }
}

function isPaginated(value: unknown): value is PaginatedResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'meta' in value &&
    Array.isArray((value as PaginatedResult<unknown>).items)
  );
}
