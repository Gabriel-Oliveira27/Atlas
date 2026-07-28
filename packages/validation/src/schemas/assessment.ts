/** Schemas de avaliação física. */

import { z } from 'zod';
import { cuidSchema, dateRangeSchema, paginationSchema, urlSchema } from '../common.js';
import { heightCmSchema, weightKgSchema } from './user.js';

export const measurementSiteSchema = z.enum([
  'NECK',
  'SHOULDER',
  'CHEST',
  'WAIST',
  'ABDOMEN',
  'HIP',
  'LEFT_ARM',
  'RIGHT_ARM',
  'LEFT_FOREARM',
  'RIGHT_FOREARM',
  'LEFT_THIGH',
  'RIGHT_THIGH',
  'LEFT_CALF',
  'RIGHT_CALF',
]);

export const photoPoseSchema = z.enum(['FRONT', 'BACK', 'LEFT_SIDE', 'RIGHT_SIDE']);

export const bodyMeasurementSchema = z.object({
  site: measurementSiteSchema,
  /** Circunferência em cm. */
  valueCm: z.number().min(5).max(300),
});
export type BodyMeasurementInput = z.infer<typeof bodyMeasurementSchema>;

export const assessmentPhotoSchema = z.object({
  pose: photoPoseSchema,
  url: urlSchema,
  /** `public_id` do Cloudinary, necessário para excluir depois. */
  publicId: z.string().max(255).optional(),
});

export const createAssessmentSchema = z.object({
  userId: cuidSchema.optional(),
  assessedAt: z.coerce.date().default(() => new Date()),
  weightKg: weightKgSchema,
  heightCm: heightCmSchema,
  /**
   * Percentual de gordura. Se omitido e houver medidas de pescoço,
   * cintura (e quadril, para mulheres), a API calcula pelo método
   * US Navy — ver `calculateBodyFatNavy` em @atlas/shared.
   */
  bodyFatPercent: z.number().min(1).max(70).optional(),
  muscleMassKg: z.number().min(1).max(200).optional(),
  restingHeartRate: z.number().int().min(30).max(220).optional(),
  measurements: z.array(bodyMeasurementSchema).max(20).default([]),
  photos: z.array(assessmentPhotoSchema).max(8).default([]),
  notes: z.string().max(2000).optional(),
  /** Profissional responsável, quando feita na academia. */
  assessedById: cuidSchema.optional(),
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

export const updateAssessmentSchema = createAssessmentSchema.partial();
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;

export const listAssessmentsQuerySchema = paginationSchema
  .extend({
    userId: cuidSchema.optional(),
  })
  .and(dateRangeSchema);
export type ListAssessmentsQuery = z.infer<typeof listAssessmentsQuerySchema>;

/** Comparação entre duas avaliações — alimenta a tela de evolução. */
export const compareAssessmentsSchema = z.object({
  fromId: cuidSchema,
  toId: cuidSchema,
});
export type CompareAssessmentsInput = z.infer<typeof compareAssessmentsSchema>;
