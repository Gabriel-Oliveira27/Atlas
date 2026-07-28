/** Schemas de hidratação. */

import { z } from 'zod';
import { cuidSchema, dateRangeSchema, dayKeySchema, paginationSchema } from '../common.js';

export const drinkTypeSchema = z.enum(['WATER', 'TEA', 'COFFEE', 'SPORTS_DRINK', 'OTHER']);

export const logHydrationSchema = z.object({
  /** Volume em ml. Limite de 5 L por registro barra erro de digitação. */
  amountMl: z.number().int().min(10, 'Mínimo de 10 ml').max(5000, 'Máximo de 5000 ml por registro'),
  drinkType: drinkTypeSchema.default('WATER'),
  consumedAt: z.coerce.date().default(() => new Date()),
  /** ID gerado no dispositivo — garante idempotência ao sincronizar offline. */
  clientGeneratedId: z.string().max(64).optional(),
  note: z.string().max(200).optional(),
});
export type LogHydrationInput = z.infer<typeof logHydrationSchema>;

export const updateWaterGoalSchema = z.object({
  dailyWaterGoalMl: z.number().int().min(250).max(10_000),
});
export type UpdateWaterGoalInput = z.infer<typeof updateWaterGoalSchema>;

/**
 * Lembrete de hidratação.
 *
 * `intervalMinutes` gera lembretes espaçados dentro da janela; se
 * ausente, `times` define horários fixos. Um dos dois é obrigatório.
 */
export const hydrationReminderSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Início da janela, formato HH:mm. */
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm')
      .default('08:00'),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm')
      .default('22:00'),
    intervalMinutes: z.number().int().min(15).max(480).optional(),
    times: z
      .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
      .max(24)
      .optional(),
    /** Dias da semana ativos (0=domingo … 6=sábado). */
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([0, 1, 2, 3, 4, 5, 6]),
    /** Só lembra se a meta ainda não foi batida. */
    skipWhenGoalReached: z.boolean().default(true),
  })
  .refine((reminder) => reminder.startTime < reminder.endTime, {
    message: 'O horário inicial deve ser anterior ao final',
    path: ['startTime'],
  })
  .refine((reminder) => Boolean(reminder.intervalMinutes) || Boolean(reminder.times?.length), {
    message: 'Informe um intervalo ou uma lista de horários',
    path: ['intervalMinutes'],
  });
export type HydrationReminderInput = z.infer<typeof hydrationReminderSchema>;

export const hydrationHistoryQuerySchema = paginationSchema
  .extend({
    userId: cuidSchema.optional(),
    /** Agrupamento da série retornada. */
    groupBy: z.enum(['day', 'week', 'month']).default('day'),
  })
  .and(dateRangeSchema);
export type HydrationHistoryQuery = z.infer<typeof hydrationHistoryQuerySchema>;

export const hydrationDayQuerySchema = z.object({
  day: dayKeySchema.optional(),
  userId: cuidSchema.optional(),
});
export type HydrationDayQuery = z.infer<typeof hydrationDayQuerySchema>;
