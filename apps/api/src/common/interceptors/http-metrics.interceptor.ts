/**
 * Latência por rota.
 *
 * O `pino-http` já registra o tempo de resposta, mas só conhece a
 * requisição CRUA — e nela a URL vem com o id concreto
 * (`/api/users/clx123abc`). Agrupar métrica por isso produz uma série
 * por usuário e não responde "esta rota está lenta?".
 *
 * Aqui temos a requisição do Fastify, que carrega o padrão da rota
 * (`/api/users/:id`) — a chave por onde a latência realmente se agrupa.
 *
 * O log sai como evento estruturado (`event: 'http.request'`) para o
 * pipeline de observabilidade derivar p95 por rota sem depender de
 * parsing de texto.
 */

import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, tap, throwError, type Observable } from 'rxjs';

export const HTTP_REQUEST_EVENT = 'http.request';

/** Acima disto, a requisição merece atenção mesmo tendo dado certo. */
const SLOW_REQUEST_MS = 1_000;

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpMetrics');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const startedAt = process.hrtime.bigint();

    const durationMs = (): number => Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    return next.handle().pipe(
      tap(() => {
        const elapsed = durationMs();

        this.write(elapsed, {
          event: HTTP_REQUEST_EVENT,
          requestId: request.id,
          method: request.method,
          route: routeOf(request),
          statusCode: reply.statusCode,
          durationMs: Number(elapsed.toFixed(2)),
        });
      }),
      catchError((error: unknown) => {
        const elapsed = durationMs();

        // A rota que falhou também conta para a latência: excluí-la
        // esconderia justamente o timeout que se quer enxergar.
        this.write(elapsed, {
          event: HTTP_REQUEST_EVENT,
          requestId: request.id,
          method: request.method,
          route: routeOf(request),
          statusCode: statusOf(error) ?? 500,
          durationMs: Number(elapsed.toFixed(2)),
          failed: true,
        });

        return throwError(() => error);
      }),
    );
  }

  private write(elapsedMs: number, fields: Record<string, unknown>): void {
    if (elapsedMs >= SLOW_REQUEST_MS) {
      this.logger.warn(fields, `Requisição lenta: ${fields.route as string}`);
      return;
    }

    this.logger.debug(fields, `${fields.method as string} ${fields.route as string}`);
  }
}

/** Padrão da rota do Fastify, com os parâmetros como `:id`. */
function routeOf(request: FastifyRequest): string {
  const candidate = request as FastifyRequest & {
    routeOptions?: { url?: string };
    routerPath?: string;
  };

  return candidate.routeOptions?.url ?? candidate.routerPath ?? request.url ?? 'desconhecida';
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}
