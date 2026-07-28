/**
 * Ponte entre o domínio do Atlas e a camada de IA.
 *
 * Este serviço conhece treinos e hidratação; `@atlas/ai` não conhece
 * nada disso. A tradução acontece aqui e nos templates de prompt —
 * é o que permite trocar de provedor (ou desligar a IA) sem tocar em
 * mais nada.
 *
 * Toda chamada é registrada em `AiJob`: custo, latência e conteúdo
 * ficam auditáveis.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  BaseAiProvider,
  buildWeeklyReportMessages,
  createAiProvider,
  WEEKLY_REPORT_SYSTEM_PROMPT,
  type AiFactoryConfig,
  type WeeklyReportContext,
} from '@atlas/ai';
import { AppError, ERROR_CODES, startOfWeek, toDayKey, type AiProviderName } from '@atlas/shared';
import { weeklyReportPayloadSchema, type WeeklyReportPayload } from '@atlas/validation';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/** Resumo de relatório semanal exposto nas listagens. */
export interface WeeklyReportSummary {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  summary: string | null;
  positives: string[];
  negatives: string[];
  pdfUrl: string | null;
  generatedAt: Date | null;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  private get factoryConfig(): AiFactoryConfig {
    const ai = this.config.ai;
    return {
      enabled: ai.enabled,
      defaultProvider: ai.defaultProvider,
      providers: ai.providers,
    };
  }

  /**
   * Gera o relatório semanal de um usuário.
   *
   * Normalmente chamado pelo workflow do N8N (agendado), mas exposto
   * também para geração sob demanda.
   */
  async generateWeeklyReport(
    userId: string,
    options: { periodStart?: Date; provider?: AiProviderName } = {},
  ): Promise<WeeklyReportPayload> {
    if (!this.config.ai.enabled) {
      throw new AppError(ERROR_CODES.AI_DISABLED, 'A camada de IA está desabilitada', {
        status: 503,
      });
    }

    const periodStart = options.periodStart ?? startOfWeek();
    const periodEnd = new Date(periodStart.getTime() + 7 * 86_400_000);

    const context = await this.buildWeeklyContext(userId, periodStart, periodEnd);

    const providerId = options.provider
      ? (options.provider.toLowerCase() as 'claude' | 'openai' | 'gemini')
      : undefined;

    const provider = createAiProvider(this.factoryConfig, providerId);

    const job = await this.prisma.db.aiJob.create({
      data: {
        userId,
        task: 'WEEKLY_REPORT',
        status: 'RUNNING',
        provider: provider.id.toUpperCase() as AiProviderName,
        model: provider.model,
        startedAt: new Date(),
      },
    });

    try {
      const response = await provider.complete({
        system: WEEKLY_REPORT_SYSTEM_PROMPT,
        messages: buildWeeklyReportMessages(context),
        responseFormat: 'json',
        maxTokens: this.config.ai.maxTokens,
        timeoutMs: this.config.ai.timeoutMs,
      });

      // A IA pode devolver JSON embrulhado em ``` — o extrator lida com isso.
      const raw = BaseAiProvider.extractJson(response.content);
      // Validar a saída é obrigatório: sem isso, uma resposta fora do
      // formato quebraria a geração do PDF sem explicação clara.
      const payload = weeklyReportPayloadSchema.parse(raw);

      await this.prisma.db.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          latencyMs: response.latencyMs,
          response: response.content.slice(0, 10_000),
        },
      });

      await this.persistWeeklyReport(
        userId,
        periodStart,
        periodEnd,
        payload,
        provider.id,
        response.usage.totalTokens,
      );

      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.prisma.db.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: message,
          attempts: { increment: 1 },
        },
      });

      this.logger.error({ err: error }, `Falha ao gerar relatório semanal do usuário ${userId}`);

      throw new AppError(ERROR_CODES.AI_PROVIDER_ERROR, 'Não foi possível gerar o relatório', {
        status: 502,
        cause: error,
      });
    }
  }

  /** Reúne os dados da semana que alimentam o prompt. */
  private async buildWeeklyContext(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<WeeklyReportContext> {
    const db = this.prisma.db;

    const [user, workoutLogs, hydrationByDay, activities, weightLogs, assessment] =
      await Promise.all([
        db.user.findFirstOrThrow({
          where: { id: userId, deletedAt: null },
          select: {
            name: true,
            goal: true,
            experienceLevel: true,
            weightKg: true,
            targetWeightKg: true,
            dailyWaterGoalMl: true,
          },
        }),
        db.workoutLog.findMany({
          where: {
            userId,
            deletedAt: null,
            startedAt: { gte: periodStart, lt: periodEnd },
          },
          select: { startedAt: true, status: true, durationSeconds: true, totalVolumeLoad: true },
        }),
        db.hydrationLog.groupBy({
          by: ['dayKey'],
          where: {
            userId,
            deletedAt: null,
            consumedAt: { gte: periodStart, lt: periodEnd },
          },
          _sum: { amountMl: true },
        }),
        db.dailyActivity.findMany({
          where: { userId, dayKey: { gte: toDayKey(periodStart), lt: toDayKey(periodEnd) } },
          orderBy: { dayKey: 'asc' },
        }),
        db.weightLog.findMany({
          where: { userId, deletedAt: null, measuredAt: { gte: periodStart, lt: periodEnd } },
          orderBy: { measuredAt: 'asc' },
        }),
        db.assessment.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { assessedAt: 'desc' },
          select: { bodyFatPercent: true },
        }),
      ]);

    const completed = workoutLogs.filter((log) => log.status === 'COMPLETED');
    const totalVolumeLoad = completed.reduce((sum, log) => sum + (log.totalVolumeLoad ?? 0), 0);

    const dailyTotals = hydrationByDay.map((row) => ({
      day: row.dayKey,
      totalMl: row._sum.amountMl ?? 0,
    }));

    const averageDailyMl =
      dailyTotals.length > 0
        ? Math.round(dailyTotals.reduce((sum, row) => sum + row.totalMl, 0) / 7)
        : 0;

    return {
      user: {
        name: user.name,
        goal: user.goal,
        experienceLevel: user.experienceLevel,
        ...(user.weightKg !== null ? { weightKg: user.weightKg } : {}),
        ...(user.targetWeightKg !== null ? { targetWeightKg: user.targetWeightKg } : {}),
        dailyWaterGoalMl: user.dailyWaterGoalMl,
      },
      period: { start: toDayKey(periodStart), end: toDayKey(periodEnd) },
      workouts: {
        // Sem plano atribuído, a meta assumida é a frequência habitual.
        planned: activities.length || 7,
        completed: completed.length,
        totalVolumeLoad,
        byDay: activities.map((activity) => ({
          day: activity.dayKey,
          completed: activity.workoutCompleted,
          durationMinutes: activity.activeMinutes,
        })),
      },
      hydration: {
        dailyTotalsMl: dailyTotals,
        averageDailyMl,
        daysGoalReached: activities.filter((activity) => activity.hydrationGoalMet).length,
      },
      bodyMetrics: {
        ...(weightLogs[0] ? { weightStartKg: weightLogs[0].weightKg } : {}),
        ...(weightLogs.at(-1) ? { weightEndKg: weightLogs.at(-1)?.weightKg } : {}),
        ...(assessment?.bodyFatPercent ? { bodyFatPercent: assessment.bodyFatPercent } : {}),
      },
      streak: activities.at(-1)?.streak ?? 0,
    };
  }

  private async persistWeeklyReport(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    payload: WeeklyReportPayload,
    provider: string,
    tokensUsed: number,
  ): Promise<void> {
    await this.prisma.db.weeklyReport.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      update: {
        status: 'COMPLETED',
        summary: payload.summary,
        positives: payload.positives,
        negatives: payload.negatives,
        workoutSuggestion: payload.workoutSuggestion ?? null,
        hydrationAnalysis: payload.hydrationAnalysis,
        evolution: payload.evolution,
        frequency: payload.frequency,
        chartData: payload.chartData ?? undefined,
        provider: provider.toUpperCase() as AiProviderName,
        tokensUsed,
        generatedAt: new Date(),
        version: { increment: 1 },
      },
      create: {
        userId,
        periodStart,
        periodEnd,
        status: 'COMPLETED',
        summary: payload.summary,
        positives: payload.positives,
        negatives: payload.negatives,
        workoutSuggestion: payload.workoutSuggestion ?? null,
        hydrationAnalysis: payload.hydrationAnalysis,
        evolution: payload.evolution,
        frequency: payload.frequency,
        chartData: payload.chartData ?? undefined,
        provider: provider.toUpperCase() as AiProviderName,
        tokensUsed,
        generatedAt: new Date(),
        originNode: this.config.nodeId,
      },
    });
  }

  /**
   * Retorno anotado explicitamente: sem a anotação o TypeScript infere
   * tipos internos do Prisma que não são "nomeáveis" a partir de outro
   * package no pnpm (TS2742).
   */
  async listReports(userId: string, limit = 12): Promise<WeeklyReportSummary[]> {
    return this.prisma.db.weeklyReport.findMany({
      where: { userId, deletedAt: null },
      orderBy: { periodStart: 'desc' },
      take: limit,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        summary: true,
        positives: true,
        negatives: true,
        pdfUrl: true,
        generatedAt: true,
      },
    });
  }
}
