/** Blocos reutilizáveis usados pelos demais schemas. */

import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  isValidCpf,
  normalizeCpf,
  normalizePhone,
} from '@atlas/shared';

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

/**
 * CPF — validado pelos dígitos verificadores e guardado sem pontuação.
 *
 * O `transform` para a forma canônica é essencial: sem ele,
 * "529.982.247-25" e "52998224725" gerariam duas contas distintas,
 * cada uma passando na constraint de unicidade do banco.
 */
export const cpfSchema = z
  .string()
  .trim()
  .refine(isValidCpf, { message: 'CPF inválido' })
  .transform((value) => normalizeCpf(value) as string);

/**
 * Telefone brasileiro — guardado em E.164 (+55DDNNNNNNNNN).
 * Mesma razão do CPF: uma conta, uma forma canônica.
 */
export const phoneSchema = z
  .string()
  .trim()
  .refine((value) => normalizePhone(value) !== null, {
    message: 'Telefone inválido. Use DDD + número, ex.: (11) 98888-7777',
  })
  .transform((value) => normalizePhone(value) as string);

/**
 * O que o usuário digita no campo único de login: e-mail, CPF ou
 * telefone. A API resolve qual dos três é — a tela não pergunta.
 */
export const loginIdentifierSchema = z
  .string()
  .trim()
  .min(1, 'Informe e-mail, CPF ou telefone')
  .max(255);

/**
 * Senha do Atlas.
 *
 * O mínimo de 8 caracteres com letra e número é o piso que o
 * `hashPassword` já exige; exigir símbolo obrigatório empurra o usuário
 * para "Senha@123" — mais previsível, não mais forte. O comprimento
 * máximo existe porque o bcrypt trunca em 72 bytes.
 */
export const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres')
  .max(72, 'A senha deve ter no máximo 72 caracteres')
  .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
    message: 'A senha deve conter ao menos uma letra e um número',
  });

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
