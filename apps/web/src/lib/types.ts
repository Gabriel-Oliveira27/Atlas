/**
 * Tipos das respostas da API consumidas pelo web.
 *
 * Espelham o que os services do NestJS devolvem (ver apps/api). Ficam em
 * um lugar só para as telas não redeclararem — quando o contrato mudar,
 * o typecheck aponta todas as telas afetadas de uma vez.
 */

// ── Exercícios ──────────────────────────────────────────────────

export interface ExerciseListItem {
  id: string;
  name: string;
  slug: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  mechanic: 'COMPOUND' | 'ISOLATION' | null;
  force: string | null;
  muscleGroup: { id: string; name: string; slug: string };
  muscleSubGroup: { id: string; name: string; slug: string } | null;
  equipment: Array<{ equipment: { id: string; name: string; slug: string } }>;
  media: Array<{ id: string; type: string; url: string }>;
  stimulusHypertrophy: number;
  stimulusStrength: number;
  stimulusEndurance: number;
}

export interface ExerciseDetail extends ExerciseListItem {
  description: string | null;
  execution: string;
  commonMistakes: string[];
  tips: string[];
  musclesByRole: {
    primary: Array<{ id: string; name: string }>;
    secondary: Array<{ id: string; name: string }>;
    stabilizer: Array<{ id: string; name: string }>;
  };
  stimulus: {
    hypertrophy: number;
    strength: number;
    endurance: number;
    caloricExpenditure: number;
    mechanicalTension: number;
    stability: number;
  };
}

export interface MuscleGroup {
  id: string;
  name: string;
  slug: string;
  children: Array<{ id: string; name: string; slug: string }>;
}

// ── Treino ──────────────────────────────────────────────────────

export type SetTechnique =
  | 'NORMAL'
  | 'SUPERSET'
  | 'BISET'
  | 'TRISET'
  | 'GIANT_SET'
  | 'DROPSET'
  | 'REST_PAUSE'
  | 'CLUSTER'
  | 'PYRAMID'
  | 'ISOMETRIC';

export interface PlanExercise {
  id: string;
  exerciseId: string;
  position: number;
  sets: number;
  reps: string;
  technique: SetTechnique;
  groupKey: string | null;
  targetWeightKg: number | null;
  targetRpe: number | null;
  targetRir: number | null;
  tempo: string | null;
  restSeconds: number;
  notes: string | null;
  exercise: {
    id: string;
    name: string;
    slug: string;
    muscleGroup: { name: string };
    media: Array<{ id: string; type: string; url: string }>;
  };
}

export interface PlanDay {
  id: string;
  label: string;
  name: string | null;
  position: number;
  weekdays: number[];
  notes: string | null;
  exercises: PlanExercise[];
}

export interface WorkoutPlan {
  id: string;
  name: string;
  description: string | null;
  split: string;
  isActive: boolean;
  days: PlanDay[];
}

export interface SetLog {
  id: string;
  exerciseId: string;
  setNumber: number;
  reps: number;
  weightKg: number;
  technique: SetTechnique;
  rpe: number | null;
  rir: number | null;
  isWarmup: boolean;
  completedAt: string;
  notes: string | null;
}

export interface OpenSession {
  id: string;
  workoutPlanId: string | null;
  workoutDayId: string | null;
  startedAt: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  sets: SetLog[];
  workoutDay: { id: string; label: string; name: string | null } | null;
}

export interface SessionListItem {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  totalVolumeLoad: number | null;
  durationSeconds: number | null;
  rating: number | null;
  workoutDay: { label: string; name: string | null } | null;
  _count: { sets: number };
}

// ── Usuário e evolução ──────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  birthDate: string | null;
  sex: 'MALE' | 'FEMALE' | 'OTHER' | 'UNDISCLOSED';
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  bmi: number | null;
  goal: string;
  experienceLevel: string;
  dailyWaterGoalMl: number;
  locale: string;
  theme: string;
  units: string;
  preferences: Record<string, unknown> | null;
  isActive: boolean;
  role: string;
  gyms: Array<{ id: string; name: string; slug: string; logoUrl: string | null }>;
}

export interface WeightLogItem {
  id: string;
  weightKg: number;
  measuredAt: string;
  dayKey: string;
  note: string | null;
}

// ── Hidratação ──────────────────────────────────────────────────

export interface HydrationDaySummary {
  dayKey: string;
  totalMl: number;
  goalMl: number;
  remainingMl: number;
  percentage: number;
  goalReached: boolean;
  entries: Array<{ id: string; amountMl: number; drinkType: string; consumedAt: string }>;
}

export interface HydrationHistoryDay {
  dayKey: string;
  totalMl: number;
  entryCount: number;
}

export interface HydrationReminder {
  id: string;
  enabled: boolean;
  startTime: string;
  endTime: string;
  intervalMinutes: number | null;
  times: string[];
  weekdays: number[];
  skipWhenGoalReached: boolean;
}
