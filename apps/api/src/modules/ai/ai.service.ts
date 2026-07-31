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
  EXERCISE_ADAPTATION_SYSTEM_PROMPT,
  buildExerciseAdaptationMessages,
  WEEKLY_REPORT_SYSTEM_PROMPT,
  type AiFactoryConfig,
  type WeeklyReportContext,
} from '@atlas/ai';
import {
  AppError,
  ERROR_CODES,
  buildPaginationMeta,
  normalizePagination,
  startOfWeek,
  toDayKey,
  type AiProviderName,
  type PaginatedResult,
} from '@atlas/shared';
import {
  exerciseAdaptationPayloadSchema,
  weeklyReportPayloadSchema,
  type AdaptExerciseInput,
  type ExerciseAdaptationPayload,
  type PaginationInput,
  type WeeklyReportPayload,
} from '@atlas/validation';
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

  /**
   * Adapta um exercício que o aluno não consegue executar agora.
   *
   * Síncrono e no caminho crítico: ele está de pé, entre séries. Por isso
   * não passa pelo N8N — ver `infra/n8n/README.md`.
   */
  async adaptExercise(
    userId: string,
    input: AdaptExerciseInput,
  ): Promise<ExerciseAdaptationPayload> {
    if (!this.config.ai.enabled) {
      throw new AppError(ERROR_CODES.AI_DISABLED, 'A camada de IA está desabilitada', {
        status: 503,
      });
    }

    const [usuario, original] = await Promise.all([
      this.prisma.db.user.findUnique({
        where: { id: userId },
        select: { goal: true, experienceLevel: true },
      }),
      this.prisma.db.exercise.findFirst({
        where: { id: input.exerciseId, deletedAt: null },
        select: {
          id: true,
          name: true,
          muscleGroupId: true,
          muscleGroup: { select: { name: true } },
          equipment: { select: { equipment: { select: { name: true } } } },
        },
      }),
    ]);

    if (!usuario) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Usuário não encontrado', { status: 404 });
    }

    if (!original) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Exercício não encontrado', { status: 404 });
    }

    const alternativas = await this.buildAdaptationCatalog(
      userId,
      original.muscleGroupId,
      original.id,
    );

    if (alternativas.length === 0) {
      // Sem catálogo não há o que sugerir, e gastar uma chamada ao modelo
      // para ele responder "nenhuma" seria pagar por um "não" que já
      // sabemos. Pular é a resposta honesta.
      return {
        alternatives: [],
        skipRecommended: true,
        skipRationale: 'Não há outro exercício cadastrado para este grupo muscular nesta academia.',
        seekProfessional: false,
      };
    }

    const provider = createAiProvider(this.factoryConfig);

    const job = await this.prisma.db.aiJob.create({
      data: {
        userId,
        task: 'EXERCISE_ADAPTATION',
        status: 'RUNNING',
        provider: provider.id.toUpperCase() as AiProviderName,
        model: provider.model,
        startedAt: new Date(),
      },
    });

    try {
      const response = await provider.complete({
        system: EXERCISE_ADAPTATION_SYSTEM_PROMPT,
        messages: buildExerciseAdaptationMessages({
          original: {
            id: original.id,
            name: original.name,
            muscleGroup: original.muscleGroup.name,
            equipment: original.equipment.map((e) => e.equipment.name),
            sets: input.sets,
            reps: input.reps,
          },
          reason: input.reason,
          ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
          user: { goal: usuario.goal, experienceLevel: usuario.experienceLevel },
          availableExercises: alternativas,
        }),
        responseFormat: 'json',
        maxTokens: this.config.ai.maxTokens,
        timeoutMs: this.config.ai.timeoutMs,
      });

      const raw = BaseAiProvider.extractJson(response.content);
      const payload = exerciseAdaptationPayloadSchema.parse(raw);

      // O modelo é instruído a usar só ids do catálogo, mas instrução não
      // é garantia: um id inventado quebraria a tela do aluno com um
      // exercício que não existe. Filtrar aqui é barato e definitivo.
      const idsValidos = new Set(alternativas.map((e) => e.id));
      const alternativasValidas = payload.alternatives.filter((a) => idsValidos.has(a.exerciseId));

      if (alternativasValidas.length < payload.alternatives.length) {
        this.logger.warn(
          `Adaptação descartou ${payload.alternatives.length - alternativasValidas.length} ` +
            'alternativa(s) com id fora do catálogo.',
        );
      }

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

      return {
        ...payload,
        alternatives: alternativasValidas,
        // Sem alternativa válida sobrando, pular deixa de ser opção e
        // passa a ser a resposta.
        skipRecommended: payload.skipRecommended || alternativasValidas.length === 0,
      };
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

      this.logger.error({ err: error }, `Falha ao adaptar o exercício ${input.exerciseId}`);

      throw new AppError(ERROR_CODES.AI_PROVIDER_ERROR, 'Não foi possível adaptar o exercício', {
        status: 502,
        cause: error,
      });
    }
  }

  /**
   * Catálogo que a IA pode escolher: mesmo grupo muscular, disponível
   * para este aluno.
   *
   * Recortado pelo grupo muscular de propósito. Mandar o catálogo inteiro
   * encareceria a chamada e pioraria a resposta — o modelo escolheria
   * entre centenas de itens quando a pergunta é "o que substitui ISTO".
   *
   * `gymId: null` são os exercícios globais; os demais só entram se o
   * aluno for membro daquela academia. Sugerir equipamento de uma unidade
   * onde ele não está é o mesmo que não responder.
   */
  private async buildAdaptationCatalog(
    userId: string,
    muscleGroupId: string,
    excludeExerciseId: string,
  ): Promise<Array<{ id: string; name: string; muscleGroup: string; equipment: string[] }>> {
    const academias = await this.prisma.db.gymMembership.findMany({
      where: { userId, deletedAt: null },
      select: { gymId: true },
    });

    const exercicios = await this.prisma.db.exercise.findMany({
      where: {
        muscleGroupId,
        isActive: true,
        deletedAt: null,
        id: { not: excludeExerciseId },
        OR: [{ gymId: null }, { gymId: { in: academias.map((a) => a.gymId) } }],
      },
      select: {
        id: true,
        name: true,
        muscleGroup: { select: { name: true } },
        equipment: { select: { equipment: { select: { name: true } } } },
      },
      take: 60,
    });

    return exercicios.map((e) => ({
      id: e.id,
      name: e.name,
      muscleGroup: e.muscleGroup.name,
      equipment: e.equipment.map((x) => x.equipment.name),
    }));
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
  async listReports(
    userId: string,
    query: PaginationInput,
  ): Promise<PaginatedResult<WeeklyReportSummary>> {
    const { page, pageSize, skip, take } = normalizePagination(query);
    const db = this.prisma.db;
    const where = { userId, deletedAt: null };

    const [items, total] = await Promise.all([
      db.weeklyReport.findMany({
        where,
        orderBy: { periodStart: 'desc' },
        skip,
        take,
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
      }),
      db.weeklyReport.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }
}
