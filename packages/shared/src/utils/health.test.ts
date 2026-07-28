import { describe, expect, it } from 'vitest';
import {
  BMI_CATEGORIES,
  calculateBmi,
  calculateBodyFatNavy,
  calculateLeanMass,
  calculateVolumeLoad,
  classifyBmi,
  estimateOneRepMax,
  suggestDailyWaterMl,
} from './health.js';

describe('calculateBmi', () => {
  it('calcula o IMC a partir de peso e altura', () => {
    // 70 kg / (1,75 m)² = 22,86
    expect(calculateBmi(70, 175)).toBe(22.86);
  });

  it('rejeita valores não positivos', () => {
    expect(() => calculateBmi(0, 175)).toThrow();
    expect(() => calculateBmi(70, 0)).toThrow();
  });
});

describe('classifyBmi', () => {
  it('usa as faixas da OMS', () => {
    expect(classifyBmi(17)).toBe(BMI_CATEGORIES.UNDERWEIGHT);
    expect(classifyBmi(22)).toBe(BMI_CATEGORIES.NORMAL);
    expect(classifyBmi(27)).toBe(BMI_CATEGORIES.OVERWEIGHT);
    expect(classifyBmi(32)).toBe(BMI_CATEGORIES.OBESE_I);
    expect(classifyBmi(37)).toBe(BMI_CATEGORIES.OBESE_II);
    expect(classifyBmi(42)).toBe(BMI_CATEGORIES.OBESE_III);
  });

  it('trata os limites das faixas', () => {
    // 18,5 e 25 são os limites inferiores de "normal" e "sobrepeso".
    expect(classifyBmi(18.5)).toBe(BMI_CATEGORIES.NORMAL);
    expect(classifyBmi(25)).toBe(BMI_CATEGORIES.OVERWEIGHT);
  });
});

describe('calculateBodyFatNavy', () => {
  it('calcula o percentual masculino a partir de pescoço e cintura', () => {
    const result = calculateBodyFatNavy({
      sex: 'MALE',
      heightCm: 180,
      neckCm: 38,
      waistCm: 85,
    });

    expect(result).toBeGreaterThan(10);
    expect(result).toBeLessThan(25);
  });

  it('exige a medida do quadril no cálculo feminino', () => {
    expect(() =>
      calculateBodyFatNavy({ sex: 'FEMALE', heightCm: 165, neckCm: 32, waistCm: 70 }),
    ).toThrow(/quadril/i);
  });

  it('mantém o resultado dentro de limites plausíveis', () => {
    // Entrada extrema não pode produzir percentual absurdo.
    const result = calculateBodyFatNavy({
      sex: 'MALE',
      heightCm: 200,
      neckCm: 30,
      waistCm: 200,
    });

    expect(result).toBeLessThanOrEqual(70);
    expect(result).toBeGreaterThanOrEqual(1);
  });
});

describe('calculateLeanMass', () => {
  it('desconta a gordura do peso total', () => {
    expect(calculateLeanMass(80, 20)).toBe(64);
  });
});

describe('suggestDailyWaterMl', () => {
  it('usa 35 ml por quilo, arredondado para múltiplo de 50', () => {
    // 70 × 35 = 2450
    expect(suggestDailyWaterMl(70)).toBe(2450);
  });

  it('acrescenta volume por minuto de treino', () => {
    expect(suggestDailyWaterMl(70, 60)).toBeGreaterThan(suggestDailyWaterMl(70));
  });

  it('sempre devolve múltiplo de 50', () => {
    for (const weight of [52, 63.5, 77, 91.2]) {
      expect(suggestDailyWaterMl(weight) % 50).toBe(0);
    }
  });
});

describe('estimateOneRepMax', () => {
  it('devolve a própria carga quando é uma repetição', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
  });

  it('aplica a fórmula de Epley acima de uma repetição', () => {
    // 100 × (1 + 10/30) = 133,33
    expect(estimateOneRepMax(100, 10)).toBe(133.33);
  });

  it('rejeita repetições inválidas', () => {
    expect(() => estimateOneRepMax(100, 0)).toThrow();
  });
});

describe('calculateVolumeLoad', () => {
  it('multiplica séries, repetições e carga', () => {
    expect(calculateVolumeLoad(3, 10, 80)).toBe(2400);
  });
});
