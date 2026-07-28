/**
 * Schemas de treinos, sessões e séries.
 *
 * Modelo em três níveis:
 *   WorkoutPlan  → o programa (ABC, PPL, periodizado…)
 *   WorkoutDay   → o "treino A", "treino B"… com seus exercícios
 *   WorkoutLog   → uma execução real, com SetLog por série feita
 */

import { z } from 'zod';
import { cuidSchema, dateRangeSchema, paginationSchema, positiveNumberSchema } from '../common.js';

export const workoutSplitSchema = z.enum([
  'ABC',
  'ABCD',
  'ABCDE',
  'UPPER_LOWER',
  'PUSH_PULL_LEGS',
  'FULL_BODY',
  'PERIODIZED',
  'CUSTOM',
]);

export const setTechniqueSchema = z.enum([
  'NORMAL',
  'SUPERSET',
  'BISET',
  'TRISET',
  'GIANT_SET',
  'DROPSET',
  'REST_PAUSE',
  'CLUSTER',
  'PYRAMID',
  'ISOMETRIC',
]);

export const sessionStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETED', 'ABANDONED']);

/** RPE: esforço percebido de 1 a 10 (aceita meio ponto, ex.: 8.5). */
export const rpeSchema = z.number().min(1).max(10).multipleOf(0.5);
/** RIR: repetições em reserva, 0 a 10. */
export const rirSchema = z.number().int().min(0).max(10);

/**
 * Tempo de execução no formato clássico de 4 dígitos:
 * excêntrica-pausa-concêntrica-pausa, ex.: "3010" ou "20X0".
 */
export const tempoSchema = z
  .string()
  .regex(/^[0-9X]{4}$/i, 'Use 4 caracteres (dígitos ou X), ex.: 3010');

/** Faixa de repetições: número exato (10) ou intervalo ("8-12"). */
export const repRangeSchema = z
  .string()
  .regex(/^\d{1,3}(-\d{1,3})?$/, 'Use "10" ou "8-12"')
  .refine(
    (value) => {
      if (!value.includes('-')) return true;
      const [min, max] = value.split('-').map(Number);
      return min !== undefined && max !== undefined && min <= max;
    },
    { message: 'O mínimo deve ser menor ou igual ao máximo' },
  );

export const workoutExerciseSchema = z.object({
  exerciseId: cuidSchema,
  /** Ordem dentro do dia de treino. */
  position: z.number().int().min(0),
  sets: z.number().int().min(1).max(20),
  reps: repRangeSchema,
  technique: setTechniqueSchema.default('NORMAL'),
  /**
   * Agrupa exercícios que compartilham a mesma técnica: dois exercícios
   * com o mesmo `groupKey` e technique=SUPERSET formam uma supersérie.
   */
  groupKey: z.string().max(20).optional(),
  targetWeightKg: positiveNumberSchema.optional(),
  targetRpe: rpeSchema.optional(),
  targetRir: rirSchema.optional(),
  tempo: tempoSchema.optional(),
  /** Descanso entre séries, em segundos. */
  restSeconds: z.number().int().min(0).max(900).default(60),
  notes: z.string().max(500).optional(),
});
export type WorkoutExerciseInput = z.infer<typeof workoutExerciseSchema>;

export const workoutDaySchema = z.object({
  /** Rótulo do dia: "A", "B", "Push", "Upper"… */
  label: z.string().trim().min(1).max(40),
  name: z.string().trim().max(120).optional(),
  position: z.number().int().min(0),
  /** Dias da semana sugeridos (0=domingo … 6=sábado). */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  notes: z.string().max(1000).optional(),
  exercises: z.array(workoutExerciseSchema).min(1, 'Adicione ao menos um exercício'),
});
export type WorkoutDayInput = z.infer<typeof workoutDaySchema>;

export const createWorkoutPlanSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().max(2000).optional(),
    split: workoutSplitSchema,
    /** Dono do plano. Ausente = modelo da academia, ainda não atribuído. */
    userId: cuidSchema.optional(),
    gymId: cuidSchema.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    isTemplate: z.boolean().default(false),
    isActive: z.boolean().default(true),
    days: z.array(workoutDaySchema).min(1, 'Adicione ao menos um dia de treino'),
  })
  .refine((plan) => !plan.startsAt || !plan.endsAt || plan.startsAt <= plan.endsAt, {
    message: 'A data de início deve ser anterior à data de término',
    path: ['startsAt'],
  });
export type CreateWorkoutPlanInput = z.infer<typeof createWorkoutPlanSchema>;

export const updateWorkoutPlanSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().max(2000).optional(),
  split: workoutSplitSchema.optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
  days: z.array(workoutDaySchema).optional(),
});
export type UpdateWorkoutPlanInput = z.infer<typeof updateWorkoutPlanSchema>;

// ── Periodização ────────────────────────────────────────────────

export const mesocycleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  position: z.number().int().min(0),
  weeks: z.number().int().min(1).max(52),
  /** Foco do bloco: acumulação, intensificação, deload… */
  focus: z.enum(['ACCUMULATION', 'INTENSIFICATION', 'REALIZATION', 'DELOAD']).optional(),
  notes: z.string().max(1000).optional(),
});
export type MesocycleInput = z.infer<typeof mesocycleSchema>;

// ── Execução do treino ──────────────────────────────────────────

export const startWorkoutSessionSchema = z.object({
  workoutDayId: cuidSchema.optional(),
  workoutPlanId: cuidSchema.optional(),
  startedAt: z.coerce.date().default(() => new Date()),
  /** Permite ao app registrar sessões feitas offline, com a hora real. */
  clientGeneratedId: z.string().max(64).optional(),
});
export type StartWorkoutSessionInput = z.infer<typeof startWorkoutSessionSchema>;

export const logSetSchema = z.object({
  exerciseId: cuidSchema,
  /** Número da série dentro do exercício (1, 2, 3…). */
  setNumber: z.number().int().min(1).max(50),
  reps: z.number().int().min(0).max(500),
  weightKg: z.number().min(0).max(1000),
  technique: setTechniqueSchema.default('NORMAL'),
  rpe: rpeSchema.optional(),
  rir: rirSchema.optional(),
  /** Duração da série em segundos — usada em isometria e cardio. */
  durationSeconds: z.number().int().min(0).max(7200).optional(),
  restSeconds: z.number().int().min(0).max(3600).optional(),
  /** Série de aquecimento não entra no cálculo de volume. */
  isWarmup: z.boolean().default(false),
  completedAt: z.coerce.date().default(() => new Date()),
  notes: z.string().max(300).optional(),
});
export type LogSetInput = z.infer<typeof logSetSchema>;

export const finishWorkoutSessionSchema = z.object({
  finishedAt: z.coerce.date().default(() => new Date()),
  status: sessionStatusSchema.default('COMPLETED'),
  /** Avaliação geral da sessão (1 a 5). */
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(1000).optional(),
});
export type FinishWorkoutSessionInput = z.infer<typeof finishWorkoutSessionSchema>;

export const listWorkoutLogsQuerySchema = paginationSchema
  .extend({
    userId: cuidSchema.optional(),
    workoutPlanId: cuidSchema.optional(),
    status: sessionStatusSchema.optional(),
  })
  .and(dateRangeSchema);
export type ListWorkoutLogsQuery = z.infer<typeof listWorkoutLogsQuerySchema>;
