/** Schemas do catálogo de exercícios. */

import { z } from 'zod';
import { cuidSchema, paginationSchema, searchSchema, urlSchema } from '../common.js';

export const muscleRoleSchema = z.enum(['PRIMARY', 'SECONDARY', 'STABILIZER']);
export const exerciseMechanicSchema = z.enum(['COMPOUND', 'ISOLATION']);
export const exerciseForceSchema = z.enum(['PUSH', 'PULL', 'STATIC']);
export const mediaTypeSchema = z.enum(['IMAGE', 'GIF', 'VIDEO', 'BANNER']);
export const stimulusTypeSchema = z.enum([
  'HYPERTROPHY',
  'STRENGTH',
  'ENDURANCE',
  'CALORIC_EXPENDITURE',
  'MECHANICAL_TENSION',
  'STABILITY',
]);

/**
 * Notas de classificação do exercício (0 a 5) para cada estímulo.
 * Alimentam a sugestão de treino por objetivo e os relatórios de IA.
 */
export const stimulusRatingSchema = z.object({
  hypertrophy: z.number().min(0).max(5).default(0),
  strength: z.number().min(0).max(5).default(0),
  endurance: z.number().min(0).max(5).default(0),
  caloricExpenditure: z.number().min(0).max(5).default(0),
  mechanicalTension: z.number().min(0).max(5).default(0),
  stability: z.number().min(0).max(5).default(0),
});
export type StimulusRatingInput = z.infer<typeof stimulusRatingSchema>;

export const exerciseMediaSchema = z.object({
  type: mediaTypeSchema,
  url: urlSchema,
  /** `public_id` do Cloudinary — necessário para remover o arquivo depois. */
  publicId: z.string().max(255).optional(),
  thumbnailUrl: urlSchema.optional(),
  caption: z.string().max(200).optional(),
  position: z.number().int().min(0).default(0),
});

export const createExerciseSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Use apenas letras minúsculas, números e hífens')
    .max(180)
    .optional(),
  /** Passo a passo da execução. */
  execution: z.string().trim().min(10, 'Descreva a execução').max(5000),
  description: z.string().max(2000).optional(),
  mechanic: exerciseMechanicSchema.optional(),
  force: exerciseForceSchema.optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),

  muscleGroupId: cuidSchema,
  /** Subgrupo, ex.: "peitoral superior" dentro de "peito". */
  muscleSubGroupId: cuidSchema.optional(),

  /** Músculos com o papel de cada um no movimento. */
  muscles: z
    .array(z.object({ muscleId: cuidSchema, role: muscleRoleSchema }))
    .min(1, 'Informe ao menos um músculo'),

  equipmentIds: z.array(cuidSchema).default([]),

  /** Erros comuns e dicas — exibidos na tela do exercício. */
  commonMistakes: z.array(z.string().max(300)).max(20).default([]),
  tips: z.array(z.string().max(300)).max(20).default([]),

  stimulus: stimulusRatingSchema.default({}),
  media: z.array(exerciseMediaSchema).max(20).default([]),

  /** Exercício exclusivo de uma academia; ausente = catálogo global. */
  gymId: cuidSchema.nullable().optional(),
  isActive: z.boolean().default(true),
});
export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;

export const updateExerciseSchema = createExerciseSchema.partial();
export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;

export const listExercisesQuerySchema = paginationSchema.extend({
  search: searchSchema,
  muscleGroupId: cuidSchema.optional(),
  equipmentId: cuidSchema.optional(),
  mechanic: exerciseMechanicSchema.optional(),
  force: exerciseForceSchema.optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  /** Ordena pelo estímulo indicado (mais alto primeiro). */
  stimulus: stimulusTypeSchema.optional(),
  gymId: cuidSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListExercisesQuery = z.infer<typeof listExercisesQuerySchema>;

export const createMuscleGroupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
  /** Preenchido quando o registro é um subgrupo. */
  parentId: cuidSchema.nullable().optional(),
  imageUrl: urlSchema.optional(),
  position: z.number().int().min(0).default(0),
});
export type CreateMuscleGroupInput = z.infer<typeof createMuscleGroupSchema>;

export const createEquipmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
  imageUrl: urlSchema.optional(),
});
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
