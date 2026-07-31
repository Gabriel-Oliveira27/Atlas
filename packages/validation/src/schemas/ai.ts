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
  'EXERCISE_ADAPTATION',
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

// ─────────────────────────────────────────────────────────────────────
// Agente de adaptação de exercício
//
// O aluno está NA academia e não consegue executar o que o treino pede.
// A entrada é curta de propósito: quem está entre séries não preenche
// formulário. O resto do contexto (catálogo da unidade, limitações,
// prescrição) a API busca sozinha — pedir isso ao cliente seria confiar
// nele para dizer quais exercícios existem.
// ─────────────────────────────────────────────────────────────────────

export const exerciseAdaptationReasonSchema = z.enum([
  'EQUIPMENT_BUSY',
  'EQUIPMENT_MISSING',
  'PAIN_OR_DISCOMFORT',
  'TECHNIQUE_UNSURE',
  'WANTS_VARIATION',
]);
export type ExerciseAdaptationReason = z.infer<typeof exerciseAdaptationReasonSchema>;

export const adaptExerciseSchema = z.object({
  /** Exercício do treino que precisa ser substituído. */
  exerciseId: cuidSchema,
  reason: exerciseAdaptationReasonSchema,
  /** Relato livre do aluno. Curto: é digitado de pé, no celular. */
  reasonDetail: z.string().trim().max(280).optional(),
  /**
   * Sessão em andamento, quando houver. Serve para a adaptação ficar
   * registrada junto do treino que estava sendo feito.
   */
  workoutLogId: cuidSchema.optional(),
});
export type AdaptExerciseInput = z.infer<typeof adaptExerciseSchema>;

/**
 * Saída do modelo, validada antes de chegar ao aplicativo.
 *
 * Sem esta validação, uma resposta fora do formato quebraria a tela sem
 * dizer por quê — o mesmo motivo pelo qual o relatório semanal valida a
 * dele (ADR 005).
 */
export const exerciseAdaptationPayloadSchema = z.object({
  alternatives: z
    .array(
      z.object({
        exerciseId: cuidSchema,
        sets: z.number().int().min(1).max(20),
        reps: z.string().trim().min(1).max(20),
        whyItWorks: z.string().trim().min(1).max(300),
        executionCue: z.string().trim().max(300).optional(),
        loadAdjustment: z.enum(['LIGHTER', 'SAME', 'HEAVIER']),
      }),
    )
    // Zero alternativas é resposta válida: significa "pule este
    // exercício", e nesse caso `skipRecommended` explica o porquê.
    .max(3),
  skipRecommended: z.boolean(),
  skipRationale: z.string().trim().max(300).optional(),
  seekProfessional: z.boolean(),
});
export type ExerciseAdaptationPayload = z.infer<typeof exerciseAdaptationPayloadSchema>;
