/**
 * Catálogo de exercícios.
 *
 * Leitura implementada por completo (é o que o front-end precisa desde
 * o primeiro dia); a administração do catálogo está esqueletada e
 * marcada no roadmap.
 */

import { Injectable } from '@nestjs/common';
import {
  AppError,
  buildPaginationMeta,
  normalizePagination,
  type PaginatedResult,
} from '@atlas/shared';
import type { ListExercisesQuery } from '@atlas/validation';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/** Mapeia o estímulo pedido na query para a coluna correspondente. */
const STIMULUS_COLUMN = {
  HYPERTROPHY: 'stimulusHypertrophy',
  STRENGTH: 'stimulusStrength',
  ENDURANCE: 'stimulusEndurance',
  CALORIC_EXPENDITURE: 'stimulusCaloricExpenditure',
  MECHANICAL_TENSION: 'stimulusMechanicalTension',
  STABILITY: 'stimulusStability',
} as const;

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListExercisesQuery, gymId?: string | null): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(query);
    const db = this.prisma.db;

    const where = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : { isActive: true }),
      ...(query.muscleGroupId
        ? {
            OR: [{ muscleGroupId: query.muscleGroupId }, { muscleSubGroupId: query.muscleGroupId }],
          }
        : {}),
      ...(query.mechanic ? { mechanic: query.mechanic } : {}),
      ...(query.force ? { force: query.force } : {}),
      ...(query.difficulty ? { difficulty: query.difficulty } : {}),
      ...(query.equipmentId ? { equipment: { some: { equipmentId: query.equipmentId } } } : {}),
      // Catálogo global + os exercícios da academia do usuário.
      ...(gymId ? { OR: [{ gymId: null }, { gymId }] } : { gymId: null }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const orderBy = query.stimulus
      ? { [STIMULUS_COLUMN[query.stimulus]]: 'desc' as const }
      : { name: 'asc' as const };

    const [items, total] = await Promise.all([
      db.exercise.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          muscleGroup: { select: { id: true, name: true, slug: true } },
          muscleSubGroup: { select: { id: true, name: true, slug: true } },
          equipment: { include: { equipment: { select: { id: true, name: true, slug: true } } } },
          media: { orderBy: { position: 'asc' }, take: 1 },
        },
      }),
      db.exercise.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }

  /**
   * Detalhe completo, com músculos, mídias, erros comuns e dicas.
   *
   * O filtro por academia repete o da listagem de propósito: sem ele,
   * bastava ter o id para ler um exercício exclusivo de outra unidade
   * — a listagem escondia, o detalhe entregava.
   */
  async findById(id: string, gymId?: string | null) {
    const exercise = await this.prisma.db.exercise.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(gymId ? { OR: [{ gymId: null }, { gymId }] } : { gymId: null }),
      },
      include: {
        muscleGroup: true,
        muscleSubGroup: true,
        muscles: { include: { muscle: true } },
        equipment: { include: { equipment: true } },
        media: { orderBy: { position: 'asc' } },
      },
    });

    if (!exercise) throw AppError.notFound('Exercício', id);

    return {
      ...exercise,
      // Reagrupa por papel: a UI mostra primários e secundários separados.
      musclesByRole: {
        primary: exercise.muscles.filter((m) => m.role === 'PRIMARY').map((m) => m.muscle),
        secondary: exercise.muscles.filter((m) => m.role === 'SECONDARY').map((m) => m.muscle),
        stabilizer: exercise.muscles.filter((m) => m.role === 'STABILIZER').map((m) => m.muscle),
      },
      stimulus: {
        hypertrophy: exercise.stimulusHypertrophy,
        strength: exercise.stimulusStrength,
        endurance: exercise.stimulusEndurance,
        caloricExpenditure: exercise.stimulusCaloricExpenditure,
        mechanicalTension: exercise.stimulusMechanicalTension,
        stability: exercise.stimulusStability,
      },
    };
  }

  /** Árvore de grupos musculares (com subgrupos) para os filtros da UI. */
  async listMuscleGroups() {
    return this.prisma.db.muscleGroup.findMany({
      where: { parentId: null },
      orderBy: { position: 'asc' },
      include: {
        children: { orderBy: { position: 'asc' } },
        muscles: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  async listEquipment() {
    return this.prisma.db.equipment.findMany({ orderBy: { name: 'asc' } });
  }

  // TODO(roadmap Beta): criação/edição/remoção de exercícios pelo
  // administrador geral, incluindo upload de mídia via Cloudinary.
  // Schemas de entrada já definidos em @atlas/validation.
}
