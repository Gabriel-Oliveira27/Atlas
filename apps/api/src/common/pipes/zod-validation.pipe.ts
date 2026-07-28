/**
 * Pipe de validação com Zod.
 *
 * Usa os MESMOS schemas de `@atlas/validation` que o front-end usa nos
 * formulários — uma regra, um lugar. Substitui `class-validator`, que
 * exigiria duplicar cada regra em decorators de DTO.
 */

import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { AppError } from '@atlas/shared';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw AppError.validation('Dados inválidos', {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      throw error;
    }
  }
}

/** Açúcar sintático: `@Body(zodBody(createUserSchema))`. */
export function zodBody(schema: ZodSchema): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}
