/**
 * Rotas de IA e o webhook de retorno do N8N.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { verifyWebhookSignature } from '@atlas/auth';
import {
  adaptExerciseSchema,
  paginationSchema,
  weeklyReportCallbackSchema,
  type AdaptExerciseInput,
  type ExerciseAdaptationPayload,
  type PaginationInput,
  type WeeklyReportCallbackInput,
} from '@atlas/validation';
import {
  AppError,
  ERROR_CODES,
  PERMISSIONS,
  WEBHOOK_SIGNATURE_HEADER,
  type AuthenticatedUser,
} from '@atlas/shared';
import {
  CurrentUser,
  Public,
  RequirePermissions,
  ThrottleFamily,
} from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AiService } from './ai.service.js';

@ApiTags('Inteligência Artificial')
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  @Get('reports')
  @ApiOperation({ summary: 'Relatórios semanais do usuário (paginado)' })
  async listReports(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodBody(paginationSchema)) query: PaginationInput,
  ) {
    return this.aiService.listReports(user.id, query);
  }

  // Cada geração é uma chamada paga ao provedor de IA: o limite é por
  // usuário e por HORA, não por minuto.
  @Post('reports/generate')
  @ThrottleFamily('ai')
  @RequirePermissions(PERMISSIONS.AI_REQUEST)
  @ApiOperation({ summary: 'Gera o relatório semanal sob demanda' })
  async generate(@CurrentUser() user: AuthenticatedUser) {
    return this.aiService.generateWeeklyReport(user.id);
  }

  /**
   * Adapta um exercício que o aluno não consegue executar agora.
   *
   * Sob demanda e síncrona — o aluno está de pé na academia, entre
   * séries. Fica na família de throttle da IA (5/hora) porque cada
   * chamada custa dinheiro real ao provedor; adaptar é excepcional, não
   * é navegação.
   */
  @Post('exercises/adapt')
  @HttpCode(HttpStatus.OK)
  @ThrottleFamily('ai')
  @ApiOperation({ summary: 'Sugere alternativas para um exercício' })
  async adaptExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(adaptExerciseSchema)) body: AdaptExerciseInput,
  ): Promise<ExerciseAdaptationPayload> {
    return this.aiService.adaptExercise(user.id, body);
  }

  /**
   * Retorno do N8N com um relatório pronto.
   *
   * Rota pública porque quem chama é o n8n, que não tem sessão de
   * usuário — a autenticação é feita pela assinatura HMAC. Sem ela,
   * qualquer um que alcançasse a API poderia injetar um relatório falso.
   */
  @Public()
  @Post('webhooks/weekly-report')
  @ApiOperation({ summary: 'Webhook do N8N com o relatório gerado' })
  async weeklyReportCallback(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers(WEBHOOK_SIGNATURE_HEADER) signature: string | undefined,
    @Body(zodBody(weeklyReportCallbackSchema)) body: WeeklyReportCallbackInput,
  ) {
    const rawBody = request.rawBody?.toString() ?? JSON.stringify(body);

    const valid = verifyWebhookSignature(rawBody, signature, this.config.n8n.webhookSecret);

    if (!valid) {
      throw new AppError(ERROR_CODES.WEBHOOK_SIGNATURE_INVALID, 'Assinatura do webhook inválida', {
        status: 401,
      });
    }

    await this.prisma.db.weeklyReport.update({
      where: { id: body.reportId },
      data: {
        status: body.status,
        ...(body.pdfUrl ? { pdfUrl: body.pdfUrl } : {}),
        ...(body.provider ? { provider: body.provider } : {}),
        ...(body.tokensUsed !== undefined ? { tokensUsed: body.tokensUsed } : {}),
        ...(body.errorMessage ? { errorMessage: body.errorMessage } : {}),
        ...(body.payload
          ? {
              summary: body.payload.summary,
              positives: body.payload.positives,
              negatives: body.payload.negatives,
              workoutSuggestion: body.payload.workoutSuggestion ?? null,
              hydrationAnalysis: body.payload.hydrationAnalysis,
              evolution: body.payload.evolution,
              frequency: body.payload.frequency,
              chartData: body.payload.chartData ?? undefined,
            }
          : {}),
        generatedAt: new Date(),
        version: { increment: 1 },
      },
    });

    return { received: true };
  }
}
