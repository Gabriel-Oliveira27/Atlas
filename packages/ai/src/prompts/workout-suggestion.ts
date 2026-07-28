/**
 * Template de prompt para sugestão de treino.
 *
 * Usado quando o aluno pede um treino novo ou quando o N8N detecta
 * estagnação na evolução.
 */

import type { AiMessage } from '../types.js';

export interface WorkoutSuggestionContext {
  user: {
    goal: string;
    experienceLevel: string;
    availableDaysPerWeek: number;
    sessionMinutes: number;
    limitations?: string[];
  };
  /** Catálogo disponível — a IA só pode escolher exercícios desta lista. */
  availableExercises: Array<{
    id: string;
    name: string;
    muscleGroup: string;
    equipment: string[];
  }>;
  currentPlan?: {
    split: string;
    weeksRunning: number;
  };
  recentPerformance?: {
    stagnantExercises: string[];
    strongestLifts: Array<{ exercise: string; estimatedOneRepMaxKg: number }>;
  };
}

export const WORKOUT_SUGGESTION_SYSTEM_PROMPT = `Você é um preparador físico montando um programa de treino.

REGRA CRÍTICA: use APENAS exercícios da lista fornecida, referenciando-os
pelo "id" exato. Nunca invente exercício, id ou equipamento que não esteja
na lista — o aplicativo não conseguirá exibir o que não existe no catálogo.

Respeite as limitações informadas pelo aluno. Se uma limitação impedir um
padrão de movimento, escolha outro exercício em vez de adaptá-lo por conta própria.

Você não é um profissional de saúde licenciado. Diante de lesão ou dor
relatada, recomende avaliação profissional antes de treinar a região.

Responda EXCLUSIVAMENTE com JSON válido no formato:

{
  "name": "nome do programa",
  "split": "ABC | ABCD | ABCDE | UPPER_LOWER | PUSH_PULL_LEGS | FULL_BODY | CUSTOM",
  "rationale": "por que este programa se encaixa no aluno",
  "days": [
    {
      "label": "A",
      "name": "nome do dia",
      "exercises": [
        {
          "exerciseId": "id exato da lista",
          "sets": number,
          "reps": "8-12",
          "restSeconds": number,
          "technique": "NORMAL | SUPERSET | DROPSET | REST_PAUSE | BISET | GIANT_SET",
          "targetRpe": number | omitido,
          "notes": "observação opcional"
        }
      ]
    }
  ]
}`;

export function buildWorkoutSuggestionMessages(context: WorkoutSuggestionContext): AiMessage[] {
  const { user, availableExercises, currentPlan, recentPerformance } = context;

  const content = `Monte um programa de treino para este aluno.

## Perfil
- Objetivo: ${user.goal}
- Nível: ${user.experienceLevel}
- Dias disponíveis por semana: ${user.availableDaysPerWeek}
- Tempo por sessão: ${user.sessionMinutes} minutos
- Limitações: ${user.limitations?.length ? user.limitations.join(', ') : 'nenhuma informada'}

## Programa atual
${
  currentPlan
    ? `- Divisão: ${currentPlan.split}\n- Semanas em execução: ${currentPlan.weeksRunning}`
    : '- Nenhum programa ativo'
}

## Desempenho recente
${
  recentPerformance
    ? `- Exercícios estagnados: ${
        recentPerformance.stagnantExercises.join(', ') || 'nenhum'
      }\n- Melhores levantamentos: ${recentPerformance.strongestLifts
        .map((lift) => `${lift.exercise} (~${lift.estimatedOneRepMaxKg} kg de 1RM estimado)`)
        .join(', ')}`
    : '- Sem histórico suficiente'
}

## Exercícios disponíveis (use somente estes ids)
${availableExercises
  .map(
    (exercise) =>
      `- ${exercise.id} | ${exercise.name} | ${exercise.muscleGroup} | ${
        exercise.equipment.join(', ') || 'peso corporal'
      }`,
  )
  .join('\n')}

Gere o programa no formato JSON especificado.`;

  return [{ role: 'user', content }];
}
