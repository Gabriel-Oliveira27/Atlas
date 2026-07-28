/** Schemas de perfil e preferências do usuário. */

import { z } from 'zod';
import { cuidSchema, emailSchema, paginationSchema, searchSchema, urlSchema } from '../common.js';

export const biologicalSexSchema = z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']);
export const fitnessGoalSchema = z.enum([
  'HYPERTROPHY',
  'FAT_LOSS',
  'STRENGTH',
  'ENDURANCE',
  'HEALTH',
  'REHAB',
]);
export const experienceLevelSchema = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
export const themePreferenceSchema = z.enum(['LIGHT', 'DARK', 'SYSTEM']);

/**
 * Limites físicos plausíveis. Servem como barreira contra erro de
 * digitação (ex.: 700 kg em vez de 70), que contaminaria os gráficos
 * de evolução e os relatórios gerados por IA.
 */
export const weightKgSchema = z.number().min(20).max(400);
export const heightCmSchema = z.number().min(80).max(260);
export const ageSchema = z.number().int().min(10).max(120);

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120).optional(),
  avatarUrl: urlSchema.nullable().optional(),
  birthDate: z.coerce.date().optional(),
  sex: biologicalSexSchema.optional(),
  heightCm: heightCmSchema.optional(),
  weightKg: weightKgSchema.optional(),
  targetWeightKg: weightKgSchema.nullable().optional(),
  goal: fitnessGoalSchema.optional(),
  experienceLevel: experienceLevelSchema.optional(),
  /** Meta diária de água em ml (250 ml a 10 L). */
  dailyWaterGoalMl: z.number().int().min(250).max(10_000).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s()-]{8,20}$/, 'Telefone inválido')
    .nullable()
    .optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const updatePreferencesSchema = z.object({
  theme: themePreferenceSchema.optional(),
  locale: z.enum(['pt-BR', 'en-US']).optional(),
  /** Desliga todas as notificações de uma vez. */
  notificationsEnabled: z.boolean().optional(),
  hydrationRemindersEnabled: z.boolean().optional(),
  workoutRemindersEnabled: z.boolean().optional(),
  weeklyReportEnabled: z.boolean().optional(),
  /** Sincronizar apenas em Wi-Fi (mobile). */
  syncOnWifiOnly: z.boolean().optional(),
  units: z.enum(['METRIC', 'IMPERIAL']).optional(),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

/** Criação de usuário por administrador de academia. */
export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  gymId: cuidSchema.optional(),
  role: z.enum(['USER', 'PROFESSOR', 'GYM_ADMIN']).default('USER'),
  sex: biologicalSexSchema.optional(),
  birthDate: z.coerce.date().optional(),
  heightCm: heightCmSchema.optional(),
  weightKg: weightKgSchema.optional(),
  goal: fitnessGoalSchema.optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  search: searchSchema,
  gymId: cuidSchema.optional(),
  role: z.enum(['USER', 'PROFESSOR', 'GYM_ADMIN', 'SUPER_ADMIN']).optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Registro de peso na linha do tempo de evolução. */
export const logWeightSchema = z.object({
  weightKg: weightKgSchema,
  measuredAt: z.coerce.date().default(() => new Date()),
  note: z.string().max(500).optional(),
});
export type LogWeightInput = z.infer<typeof logWeightSchema>;
