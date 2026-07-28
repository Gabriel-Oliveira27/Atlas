/** Schemas da camada de IA e dos relatórios semanais. */

import { z } from 'zod';
import { cuidSchema, dateRangeSchema, isoDateSchema, paginationSchema } from '../common.js';

export const aiProviderSchema = z.enum(['CLAUDE', 'OPENAI', 'GEMINI']);

export const jobStatusSchema = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);

/**
 * Tipos de tarefa que a camada de IA sabe executar.
 * Cada um tem um prompt-template próprio em `packages/ai/src/prompts`.
 */
export const aiTaskSchema = z.enum([
  'WEEKLY_REPORT',
  'WORKOUT_SUGGESTION',
  'HYDRATION_ANALYSIS',
  'PROGRESS_ANALYSIS',
  'EXERCISE_DESCRIPTION',
]);
export type AiTask = z.infer<typeof aiTaskSchema>;

export const requestAiAnalysisSchema = z.object({
  task: aiTaskSchema,
  userId: cuidSchema.optional(),
  /** Sobrescreve o provedor padrão do ambiente. */
  provider: aiProviderSchema.optional(),
  /** Contexto adicional injetado no prompt. */
  context: z.record(z.unknown()).optional(),
  /** Período analisado; padrão é a última semana. */
  periodStart: isoDateSchema.optional(),
  periodEnd: isoDateSchema.optional(),
});
export type RequestAiAnalysisInput = z.infer<typeof requestAiAnalysisSchema>;

/**
 * Estrutura do relatório semanal.
 *
 * O workflow do n8n exige que a IA responda EXATAMENTE neste formato
 * — é o que garante que o PDF e os gráficos possam ser montados sem
 * interpretação de texto livre.
 */
export const weeklyReportPayloadSchema = z.object({
  summary: z.string().max(3000),
  positives: z.array(z.string().max(500)).max(10),
  negatives: z.array(z.string().max(500)).max(10),
  evolution: z.object({
    weightDeltaKg: z.number().optional(),
    volumeLoadDelta: z.number().optional(),
    workoutsCompleted: z.number().int().min(0),
    workoutsPlanned: z.number().int().min(0),
    adherencePercent: z.number().min(0).max(100),
  }),
  workoutSuggestion: z.string().max(3000).optional(),
  hydrationAnalysis: z.object({
    averageDailyMl: z.number().min(0),
    goalMl: z.number().min(0),
    daysGoalReached: z.number().int().min(0).max(7),
    comment: z.string().max(1000),
  }),
  frequency: z.object({
    daysTrained: z.number().int().min(0).max(7),
    streak: z.number().int().min(0),
  }),
  /** Séries prontas para o gráfico da UI e do PDF. */
  chartData: z.record(z.array(z.object({ label: z.string(), value: z.number() }))).optional(),
});
export type WeeklyReportPayload = z.infer<typeof weeklyReportPayloadSchema>;

export const listWeeklyReportsQuerySchema = paginationSchema
  .extend({
    userId: cuidSchema.optional(),
    status: jobStatusSchema.optional(),
  })
  .and(dateRangeSchema);
export type ListWeeklyReportsQuery = z.infer<typeof listWeeklyReportsQuerySchema>;

/**
 * Callback do n8n devolvendo um relatório pronto.
 * A assinatura HMAC (header x-atlas-signature) é validada antes.
 */
export const weeklyReportCallbackSchema = z.object({
  reportId: cuidSchema,
  status: z.enum(['COMPLETED', 'FAILED']),
  payload: weeklyReportPayloadSchema.optional(),
  pdfUrl: z.string().url().optional(),
  provider: aiProviderSchema.optional(),
  tokensUsed: z.number().int().min(0).optional(),
  errorMessage: z.string().max(2000).optional(),
});
export type WeeklyReportCallbackInput = z.infer<typeof weeklyReportCallbackSchema>;
