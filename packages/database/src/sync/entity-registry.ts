/**
 * Registro das entidades sincronizáveis.
 *
 * O motor de sincronização é genérico: ele não conhece "treino" nem
 * "hidratação". Este registro é o que diz, para cada entidade:
 *
 *   • qual delegate do Prisma usar
 *   • como resolver conflitos
 *   • se o registro pertence a um usuário (escopo do delta-sync)
 *
 * Adicionar uma entidade à sincronização = adicionar uma linha aqui.
 */

import type { PrismaClient } from '@prisma/client';
import { CONFLICT_RESOLUTION, type ConflictResolution } from '@atlas/shared';

export interface SyncEntityDefinition {
  /** Nome do modelo Prisma, ex.: "HydrationLog". */
  name: string;
  /** Chave do delegate em `PrismaClient`, ex.: "hydrationLog". */
  delegate: keyof PrismaClient;
  /** Estratégia padrão de resolução de conflito. */
  resolution: ConflictResolution;
  /**
   * Campo que liga o registro ao usuário. Nulo = entidade global
   * (catálogo), sincronizada para todos os dispositivos.
   */
  userScopeField: string | null;
  /**
   * Ordem de aplicação. Entidades referenciadas por outras precisam vir
   * antes, ou o insert falha por chave estrangeira inexistente.
   */
  order: number;
}

export const SYNC_ENTITIES: SyncEntityDefinition[] = [
  // ── Base: precisam existir antes de qualquer coisa que as referencie ──
  {
    name: 'User',
    delegate: 'user',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'id',
    order: 10,
  },
  {
    name: 'Gym',
    delegate: 'gym',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: null,
    order: 11,
  },
  {
    name: 'GymMembership',
    delegate: 'gymMembership',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'userId',
    order: 12,
  },
  {
    name: 'Exercise',
    delegate: 'exercise',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: null,
    order: 13,
  },

  // ── Treinos: plano → dia → exercício → sessão → série ──
  {
    name: 'WorkoutPlan',
    delegate: 'workoutPlan',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'userId',
    order: 20,
  },
  {
    name: 'WorkoutDay',
    delegate: 'workoutDay',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: null,
    order: 21,
  },
  {
    name: 'WorkoutExercise',
    delegate: 'workoutExercise',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: null,
    order: 22,
  },
  {
    name: 'WorkoutLog',
    delegate: 'workoutLog',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'userId',
    order: 23,
  },
  {
    name: 'SetLog',
    delegate: 'setLog',
    resolution: CONFLICT_RESOLUTION.MERGE_UNION,
    userScopeField: null,
    order: 24,
  },

  // ── Coleções append-only: dois registros offline são ambos verdadeiros ──
  {
    name: 'HydrationLog',
    delegate: 'hydrationLog',
    resolution: CONFLICT_RESOLUTION.MERGE_UNION,
    userScopeField: 'userId',
    order: 30,
  },
  {
    name: 'HydrationReminder',
    delegate: 'hydrationReminder',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'userId',
    order: 31,
  },
  {
    name: 'WeightLog',
    delegate: 'weightLog',
    resolution: CONFLICT_RESOLUTION.MERGE_UNION,
    userScopeField: 'userId',
    order: 32,
  },

  // ── Avaliações ──
  {
    name: 'Assessment',
    delegate: 'assessment',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'userId',
    order: 40,
  },
  {
    name: 'BodyMeasurement',
    delegate: 'bodyMeasurement',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: null,
    order: 41,
  },
  {
    name: 'AssessmentPhoto',
    delegate: 'assessmentPhoto',
    resolution: CONFLICT_RESOLUTION.MERGE_UNION,
    userScopeField: null,
    order: 42,
  },

  // ── Derivados e notificações ──
  {
    name: 'DailyActivity',
    delegate: 'dailyActivity',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'userId',
    order: 50,
  },
  {
    name: 'Notification',
    delegate: 'notification',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'userId',
    order: 51,
  },
  {
    name: 'DeviceToken',
    delegate: 'deviceToken',
    resolution: CONFLICT_RESOLUTION.LAST_WRITE_WINS,
    userScopeField: 'userId',
    order: 52,
  },
];

/** Entidades na ordem correta de aplicação (respeita chaves estrangeiras). */
export function syncEntitiesInOrder(): SyncEntityDefinition[] {
  return [...SYNC_ENTITIES].sort((a, b) => a.order - b.order);
}

export function findSyncEntity(name: string): SyncEntityDefinition | undefined {
  return SYNC_ENTITIES.find((entity) => entity.name === name);
}

/** Nomes válidos — usado para validar o que chega do dispositivo. */
export const SYNC_ENTITY_NAMES = SYNC_ENTITIES.map((entity) => entity.name);
