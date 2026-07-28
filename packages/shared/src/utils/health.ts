/**
 * Cálculos de saúde/composição corporal usados nas avaliações.
 *
 * Fórmulas documentadas para auditoria — os valores aparecem no
 * histórico do usuário e nos relatórios gerados por IA.
 *
 * AVISO: são estimativas de acompanhamento, não diagnóstico clínico.
 */

/** IMC = peso(kg) / altura(m)². */
export function calculateBmi(weightKg: number, heightCm: number): number {
  if (weightKg <= 0 || heightCm <= 0) {
    throw new Error('Peso e altura devem ser maiores que zero');
  }
  const heightM = heightCm / 100;
  return round(weightKg / (heightM * heightM), 2);
}

export const BMI_CATEGORIES = {
  UNDERWEIGHT: 'UNDERWEIGHT',
  NORMAL: 'NORMAL',
  OVERWEIGHT: 'OVERWEIGHT',
  OBESE_I: 'OBESE_I',
  OBESE_II: 'OBESE_II',
  OBESE_III: 'OBESE_III',
} as const;
export type BmiCategory = (typeof BMI_CATEGORIES)[keyof typeof BMI_CATEGORIES];

/** Faixas da OMS. */
export function classifyBmi(bmi: number): BmiCategory {
  if (bmi < 18.5) return BMI_CATEGORIES.UNDERWEIGHT;
  if (bmi < 25) return BMI_CATEGORIES.NORMAL;
  if (bmi < 30) return BMI_CATEGORIES.OVERWEIGHT;
  if (bmi < 35) return BMI_CATEGORIES.OBESE_I;
  if (bmi < 40) return BMI_CATEGORIES.OBESE_II;
  return BMI_CATEGORIES.OBESE_III;
}

/**
 * Percentual de gordura pelo método de circunferências da US Navy.
 * Escolhido por depender apenas de fita métrica — o usuário consegue
 * medir sozinho, sem adipômetro ou balança de bioimpedância.
 *
 * Homens:   86.010·log10(cintura − pescoço) − 70.041·log10(altura) + 36.76
 * Mulheres: 163.205·log10(cintura + quadril − pescoço) − 97.684·log10(altura) − 78.387
 */
export function calculateBodyFatNavy(params: {
  sex: 'MALE' | 'FEMALE';
  heightCm: number;
  neckCm: number;
  waistCm: number;
  /** Obrigatório para o cálculo feminino. */
  hipCm?: number;
}): number {
  const { sex, heightCm, neckCm, waistCm, hipCm } = params;

  if (sex === 'MALE') {
    const value = 86.01 * Math.log10(waistCm - neckCm) - 70.041 * Math.log10(heightCm) + 36.76;
    return round(clamp(value, 1, 70), 2);
  }

  if (hipCm === undefined) {
    throw new Error('Medida do quadril é obrigatória para o cálculo feminino');
  }

  const value =
    163.205 * Math.log10(waistCm + hipCm - neckCm) - 97.684 * Math.log10(heightCm) - 78.387;
  return round(clamp(value, 1, 70), 2);
}

/** Massa magra (kg) a partir do peso e do percentual de gordura. */
export function calculateLeanMass(weightKg: number, bodyFatPercent: number): number {
  return round(weightKg * (1 - bodyFatPercent / 100), 2);
}

/**
 * Meta diária de água sugerida, em ml.
 * Base de 35 ml/kg + acréscimo por minuto de treino (~12 ml/min).
 */
export function suggestDailyWaterMl(weightKg: number, trainingMinutes = 0): number {
  const base = weightKg * 35;
  const training = trainingMinutes * 12;
  // Arredonda para múltiplo de 50 ml — meta "redonda" é mais fácil de acompanhar.
  return Math.round((base + training) / 50) * 50;
}

/**
 * 1RM estimado pela fórmula de Epley: carga · (1 + reps/30).
 * Usado para acompanhar evolução de força sem exigir teste máximo.
 */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (reps <= 0) throw new Error('Repetições devem ser maiores que zero');
  if (reps === 1) return round(weightKg, 2);
  return round(weightKg * (1 + reps / 30), 2);
}

/** Volume de carga de uma série: séries × reps × carga. */
export function calculateVolumeLoad(sets: number, reps: number, weightKg: number): number {
  return round(sets * reps * weightKg, 2);
}

// ── Auxiliares ──────────────────────────────────────────────────

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
