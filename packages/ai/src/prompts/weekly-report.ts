/**
 * Template de prompt do relatório semanal.
 *
 * É AQUI que o domínio do Atlas encontra a IA. O provedor não sabe o
 * que é treino ou hidratação; este template traduz os dados do usuário
 * em texto e exige a resposta no formato exato que o PDF e os gráficos
 * consomem (ver `weeklyReportPayloadSchema` em @atlas/validation).
 */

import type { AiMessage } from '../types.js';

export interface WeeklyReportContext {
  user: {
    name: string;
    goal: string;
    experienceLevel: string;
    weightKg?: number;
    targetWeightKg?: number;
    dailyWaterGoalMl: number;
  };
  period: { start: string; end: string };
  workouts: {
    planned: number;
    completed: number;
    totalVolumeLoad: number;
    previousVolumeLoad?: number;
    byDay: Array<{ day: string; completed: boolean; durationMinutes?: number }>;
  };
  hydration: {
    dailyTotalsMl: Array<{ day: string; totalMl: number }>;
    averageDailyMl: number;
    daysGoalReached: number;
  };
  bodyMetrics: {
    weightStartKg?: number;
    weightEndKg?: number;
    bodyFatPercent?: number;
  };
  streak: number;
}

export const WEEKLY_REPORT_SYSTEM_PROMPT = `Você é um preparador físico experiente analisando a semana de treino de um aluno.

Escreva em português do Brasil, em tom direto e encorajador, sem jargão desnecessário.
Baseie TODA afirmação nos dados fornecidos — nunca invente números, medidas ou eventos.
Quando um dado não existir, diga que não há informação suficiente em vez de estimar.

Você não é um profissional de saúde licenciado: não faça diagnósticos nem
prescreva tratamento. Se algo nos dados sugerir risco à saúde, recomende
procurar um profissional.

Responda EXCLUSIVAMENTE com um objeto JSON válido, sem texto antes ou depois,
seguindo exatamente este formato:

{
  "summary": "resumo da semana em 2 a 4 frases",
  "positives": ["ponto positivo", "..."],
  "negatives": ["ponto de atenção", "..."],
  "evolution": {
    "weightDeltaKg": number | omitido,
    "volumeLoadDelta": number | omitido,
    "workoutsCompleted": number,
    "workoutsPlanned": number,
    "adherencePercent": number
  },
  "workoutSuggestion": "sugestão para a próxima semana",
  "hydrationAnalysis": {
    "averageDailyMl": number,
    "goalMl": number,
    "daysGoalReached": number,
    "comment": "análise da hidratação"
  },
  "frequency": { "daysTrained": number, "streak": number }
}`;

/** Monta as mensagens do relatório semanal a partir dos dados do usuário. */
export function buildWeeklyReportMessages(context: WeeklyReportContext): AiMessage[] {
  const { user, period, workouts, hydration, bodyMetrics, streak } = context;

  const adherence =
    workouts.planned > 0 ? Math.round((workouts.completed / workouts.planned) * 100) : 0;

  const content = `Analise a semana de ${period.start} a ${period.end}.

## Aluno
- Nome: ${user.name}
- Objetivo: ${user.goal}
- Nível: ${user.experienceLevel}
- Peso atual: ${user.weightKg ?? 'não informado'} kg
- Peso meta: ${user.targetWeightKg ?? 'não definido'} kg
- Meta diária de água: ${user.dailyWaterGoalMl} ml

## Treinos
- Planejados: ${workouts.planned}
- Concluídos: ${workouts.completed} (aderência ${adherence}%)
- Volume de carga total: ${workouts.totalVolumeLoad} kg
- Volume da semana anterior: ${workouts.previousVolumeLoad ?? 'sem dados'}
- Detalhe por dia:
${workouts.byDay
  .map(
    (day) =>
      `  - ${day.day}: ${day.completed ? 'treinou' : 'não treinou'}${
        day.durationMinutes ? ` (${day.durationMinutes} min)` : ''
      }`,
  )
  .join('\n')}

## Hidratação
- Média diária: ${hydration.averageDailyMl} ml
- Dias em que bateu a meta: ${hydration.daysGoalReached} de 7
- Totais por dia:
${hydration.dailyTotalsMl.map((entry) => `  - ${entry.day}: ${entry.totalMl} ml`).join('\n')}

## Composição corporal
- Peso no início: ${bodyMetrics.weightStartKg ?? 'sem dados'} kg
- Peso no fim: ${bodyMetrics.weightEndKg ?? 'sem dados'} kg
- Percentual de gordura: ${bodyMetrics.bodyFatPercent ?? 'sem dados'}%

## Sequência
- Streak atual: ${streak} dias

Gere o relatório no formato JSON especificado.`;

  return [{ role: 'user', content }];
}
