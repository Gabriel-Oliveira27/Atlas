/** Schemas de academias e vínculos. */

import { z } from 'zod';
import { cuidSchema, emailSchema, paginationSchema, searchSchema, urlSchema } from '../common.js';

export const gymStatusSchema = z.enum(['ACTIVE', 'BLOCKED', 'PENDING']);
export const membershipRoleSchema = z.enum(['MEMBER', 'PROFESSOR', 'ADMIN']);

/** CNPJ apenas com dígitos (14). A formatação fica a cargo da UI. */
export const cnpjSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ''))
  .refine((value) => value.length === 14, { message: 'CNPJ deve ter 14 dígitos' });

export const addressSchema = z.object({
  street: z.string().max(200).optional(),
  number: z.string().max(20).optional(),
  complement: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2, 'UF deve ter 2 letras').optional(),
  zipCode: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 0 || value.length === 8, { message: 'CEP inválido' })
    .optional(),
});

export const createGymSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(160),
  /** Identificador em URL, ex.: atlas.vercel.app/g/academia-central */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Use apenas letras minúsculas, números e hífens')
    .min(3)
    .max(60),
  cnpj: cnpjSchema.optional(),
  email: emailSchema.optional(),
  phone: z.string().max(20).optional(),
  logoUrl: urlSchema.optional(),
  address: addressSchema.optional(),
  status: gymStatusSchema.default('ACTIVE'),
});
export type CreateGymInput = z.infer<typeof createGymSchema>;

export const updateGymSchema = createGymSchema.partial();
export type UpdateGymInput = z.infer<typeof updateGymSchema>;

/** Bloqueio de academia (ação de administrador geral) exige justificativa. */
export const blockGymSchema = z.object({
  reason: z.string().trim().min(5, 'Descreva o motivo do bloqueio').max(500),
});
export type BlockGymInput = z.infer<typeof blockGymSchema>;

export const listGymsQuerySchema = paginationSchema.extend({
  search: searchSchema,
  status: gymStatusSchema.optional(),
});
export type ListGymsQuery = z.infer<typeof listGymsQuerySchema>;

export const createMembershipSchema = z.object({
  userId: cuidSchema,
  gymId: cuidSchema,
  role: membershipRoleSchema.default('MEMBER'),
  startedAt: z.coerce.date().default(() => new Date()),
});
export type CreateMembershipInput = z.infer<typeof createMembershipSchema>;
