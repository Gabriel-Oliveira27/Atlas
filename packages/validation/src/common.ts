/** Blocos reutilizáveis usados pelos demais schemas. */

import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@atlas/shared';

/** IDs do Atlas são cuid (padrão do Prisma). */
export const cuidSchema = z.string().cuid({ message: 'Identificador inválido' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'E-mail inválido' })
  .max(255);

export const isoDateSchema = z
  .string()
  .datetime({ offset: true, message: 'Data deve estar no formato ISO 8601' });

/** Chave de dia `YYYY-MM-DD` no fuso do produto. */
export const dayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data deve estar no formato YYYY-MM-DD' });

export const urlSchema = z.string().url({ message: 'URL inválida' }).max(2048);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

/** Busca textual livre — usada nas listagens. */
export const searchSchema = z.string().trim().min(1).max(120).optional();

/**
 * Faixa de datas fechada, com validação de ordem.
 * Usada em históricos (hidratação, treinos, avaliações).
 */
export const dateRangeSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((range) => !range.from || !range.to || Date.parse(range.from) <= Date.parse(range.to), {
    message: 'A data inicial deve ser anterior ou igual à data final',
    path: ['from'],
  });

/** Medidas corporais e cargas nunca são negativas. */
export const positiveNumberSchema = z.number().positive({ message: 'Deve ser maior que zero' });
export const nonNegativeIntSchema = z.number().int().min(0);
