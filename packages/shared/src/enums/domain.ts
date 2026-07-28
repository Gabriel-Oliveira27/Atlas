/**
 * Enums de domínio do Atlas.
 *
 * Espelham os enums do Prisma. São declarados aqui como objetos `const`
 * (e não importados do `@prisma/client`) para que web e mobile possam
 * usá-los sem arrastar o client do Prisma para o bundle.
 *
 * REGRA: ao alterar um enum aqui, altere também em
 * `packages/database/prisma/schema.prisma`.
 */

// ── Perfil ──────────────────────────────────────────────────────

export const BIOLOGICAL_SEX = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
  UNDISCLOSED: 'UNDISCLOSED',
} as const;
export type BiologicalSex = (typeof BIOLOGICAL_SEX)[keyof typeof BIOLOGICAL_SEX];

export const FITNESS_GOAL = {
  HYPERTROPHY: 'HYPERTROPHY',
  FAT_LOSS: 'FAT_LOSS',
  STRENGTH: 'STRENGTH',
  ENDURANCE: 'ENDURANCE',
  HEALTH: 'HEALTH',
  REHAB: 'REHAB',
} as const;
export type FitnessGoal = (typeof FITNESS_GOAL)[keyof typeof FITNESS_GOAL];

export const EXPERIENCE_LEVEL = {
  BEGINNER: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
} as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVEL)[keyof typeof EXPERIENCE_LEVEL];

export const THEME_PREFERENCE = {
  LIGHT: 'LIGHT',
  DARK: 'DARK',
  SYSTEM: 'SYSTEM',
} as const;
export type ThemePreference = (typeof THEME_PREFERENCE)[keyof typeof THEME_PREFERENCE];

// ── Academia ────────────────────────────────────────────────────

export const GYM_STATUS = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
  PENDING: 'PENDING',
} as const;
export type GymStatus = (typeof GYM_STATUS)[keyof typeof GYM_STATUS];

export const MEMBERSHIP_ROLE = {
  MEMBER: 'MEMBER',
  PROFESSOR: 'PROFESSOR',
  ADMIN: 'ADMIN',
} as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLE)[keyof typeof MEMBERSHIP_ROLE];

// ── Exercícios ──────────────────────────────────────────────────

/** Como o músculo participa do exercício. */
export const MUSCLE_ROLE = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
  STABILIZER: 'STABILIZER',
} as const;
export type MuscleRole = (typeof MUSCLE_ROLE)[keyof typeof MUSCLE_ROLE];

export const EXERCISE_MECHANIC = {
  COMPOUND: 'COMPOUND',
  ISOLATION: 'ISOLATION',
} as const;
export type ExerciseMechanic = (typeof EXERCISE_MECHANIC)[keyof typeof EXERCISE_MECHANIC];

export const EXERCISE_FORCE = {
  PUSH: 'PUSH',
  PULL: 'PULL',
  STATIC: 'STATIC',
} as const;
export type ExerciseForce = (typeof EXERCISE_FORCE)[keyof typeof EXERCISE_FORCE];

export const MEDIA_TYPE = {
  IMAGE: 'IMAGE',
  GIF: 'GIF',
  VIDEO: 'VIDEO',
  BANNER: 'BANNER',
} as const;
export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];

// ── Treinos ─────────────────────────────────────────────────────

export const WORKOUT_SPLIT = {
  ABC: 'ABC',
  ABCD: 'ABCD',
  ABCDE: 'ABCDE',
  UPPER_LOWER: 'UPPER_LOWER',
  PUSH_PULL_LEGS: 'PUSH_PULL_LEGS',
  FULL_BODY: 'FULL_BODY',
  PERIODIZED: 'PERIODIZED',
  CUSTOM: 'CUSTOM',
} as const;
export type WorkoutSplit = (typeof WORKOUT_SPLIT)[keyof typeof WORKOUT_SPLIT];

/** Técnicas avançadas aplicáveis a um exercício dentro do treino. */
export const SET_TECHNIQUE = {
  NORMAL: 'NORMAL',
  SUPERSET: 'SUPERSET',
  BISET: 'BISET',
  TRISET: 'TRISET',
  GIANT_SET: 'GIANT_SET',
  DROPSET: 'DROPSET',
  REST_PAUSE: 'REST_PAUSE',
  CLUSTER: 'CLUSTER',
  PYRAMID: 'PYRAMID',
  ISOMETRIC: 'ISOMETRIC',
} as const;
export type SetTechnique = (typeof SET_TECHNIQUE)[keyof typeof SET_TECHNIQUE];

export const WORKOUT_SESSION_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED',
} as const;
export type WorkoutSessionStatus =
  (typeof WORKOUT_SESSION_STATUS)[keyof typeof WORKOUT_SESSION_STATUS];

/** Classificações de estímulo do exercício (spec: hipertrofia, força, ...). */
export const STIMULUS_TYPE = {
  HYPERTROPHY: 'HYPERTROPHY',
  STRENGTH: 'STRENGTH',
  ENDURANCE: 'ENDURANCE',
  CALORIC_EXPENDITURE: 'CALORIC_EXPENDITURE',
  MECHANICAL_TENSION: 'MECHANICAL_TENSION',
  STABILITY: 'STABILITY',
} as const;
export type StimulusType = (typeof STIMULUS_TYPE)[keyof typeof STIMULUS_TYPE];

// ── Hidratação / Avaliações ─────────────────────────────────────

export const DRINK_TYPE = {
  WATER: 'WATER',
  TEA: 'TEA',
  COFFEE: 'COFFEE',
  SPORTS_DRINK: 'SPORTS_DRINK',
  OTHER: 'OTHER',
} as const;
export type DrinkType = (typeof DRINK_TYPE)[keyof typeof DRINK_TYPE];

export const MEASUREMENT_SITE = {
  NECK: 'NECK',
  SHOULDER: 'SHOULDER',
  CHEST: 'CHEST',
  WAIST: 'WAIST',
  ABDOMEN: 'ABDOMEN',
  HIP: 'HIP',
  LEFT_ARM: 'LEFT_ARM',
  RIGHT_ARM: 'RIGHT_ARM',
  LEFT_FOREARM: 'LEFT_FOREARM',
  RIGHT_FOREARM: 'RIGHT_FOREARM',
  LEFT_THIGH: 'LEFT_THIGH',
  RIGHT_THIGH: 'RIGHT_THIGH',
  LEFT_CALF: 'LEFT_CALF',
  RIGHT_CALF: 'RIGHT_CALF',
} as const;
export type MeasurementSite = (typeof MEASUREMENT_SITE)[keyof typeof MEASUREMENT_SITE];

export const PHOTO_POSE = {
  FRONT: 'FRONT',
  BACK: 'BACK',
  LEFT_SIDE: 'LEFT_SIDE',
  RIGHT_SIDE: 'RIGHT_SIDE',
} as const;
export type PhotoPose = (typeof PHOTO_POSE)[keyof typeof PHOTO_POSE];

// ── IA / Notificações ───────────────────────────────────────────

export const AI_PROVIDER = {
  CLAUDE: 'CLAUDE',
  OPENAI: 'OPENAI',
  GEMINI: 'GEMINI',
} as const;
export type AiProviderName = (typeof AI_PROVIDER)[keyof typeof AI_PROVIDER];

export const JOB_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

export const NOTIFICATION_TYPE = {
  HYDRATION_REMINDER: 'HYDRATION_REMINDER',
  WORKOUT_REMINDER: 'WORKOUT_REMINDER',
  WEEKLY_REPORT: 'WEEKLY_REPORT',
  ASSESSMENT_DUE: 'ASSESSMENT_DUE',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

export const DEVICE_PLATFORM = {
  ANDROID: 'ANDROID',
  IOS: 'IOS',
  WEB: 'WEB',
} as const;
export type DevicePlatform = (typeof DEVICE_PLATFORM)[keyof typeof DEVICE_PLATFORM];
