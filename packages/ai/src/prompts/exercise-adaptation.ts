/**
 * Template de prompt para adaptar um exercício.
 *
 * O caso que motivou: o aluno chega na academia e a máquina que o treino
 * pede está ocupada, quebrada ou não existe naquela unidade. Sem uma
 * resposta rápida, ou ele pula o exercício ou improvisa sozinho.
 *
 * ── Por que a substituição não é uma tabela fixa ────────────────────
 * "Leg press → agachamento" parece resolver, mas a escolha depende do
 * que a substituição precisa preservar: o padrão de movimento, o grupo
 * muscular, a carga alvo, e as limitações do aluno. Um aluno com dor
 * lombar não recebe agachamento livre como alternativa de leg press,
 * ainda que o músculo seja o mesmo.
 *
 * Por isso o modelo recebe o catálogo REAL da academia e escolhe dentro
 * dele — a mesma regra do `workout-suggestion`: o app não consegue
 * exibir exercício que não existe no catálogo.
 */

import type { AiMessage } from '../types.js';

export interface ExerciseAdaptationContext {
  /** O exercício que o aluno não consegue executar agora. */
  original: {
    id: string;
    name: string;
    muscleGroup: string;
    equipment: string[];
    /** Séries e repetições prescritas, para a alternativa manter o estímulo. */
    sets: number;
    reps: string;
  };
  /** Por que precisa adaptar — muda a resposta. */
  reason: ExerciseAdaptationReason;
  /** Texto livre do aluno, quando houver. */
  reasonDetail?: string;
  user: {
    goal: string;
    experienceLevel: string;
    limitations?: string[];
  };
  /**
   * Catálogo da academia onde o aluno está. A IA só pode escolher daqui —
   * sugerir o que a unidade não tem é o mesmo que não responder.
   */
  availableExercises: Array<{
    id: string;
    name: string;
    muscleGroup: string;
    equipment: string[];
  }>;
}

export const EXERCISE_ADAPTATION_REASONS = {
  /** Máquina ocupada — a alternativa precisa ser imediata. */
  EQUIPMENT_BUSY: 'EQUIPMENT_BUSY',
  /** A academia não tem o equipamento. */
  EQUIPMENT_MISSING: 'EQUIPMENT_MISSING',
  /** Dor ou desconforto ao executar. */
  PAIN_OR_DISCOMFORT: 'PAIN_OR_DISCOMFORT',
  /** Não sabe executar com segurança. */
  TECHNIQUE_UNSURE: 'TECHNIQUE_UNSURE',
  /** Quer variar o estímulo. */
  WANTS_VARIATION: 'WANTS_VARIATION',
} as const;

export type ExerciseAdaptationReason =
  (typeof EXERCISE_ADAPTATION_REASONS)[keyof typeof EXERCISE_ADAPTATION_REASONS];

export const EXERCISE_ADAPTATION_SYSTEM_PROMPT = `Você é um preparador físico ajudando um aluno que está NA ACADEMIA, agora, e não consegue executar um exercício do treino dele.

A resposta precisa ser acionável em segundos: ele está de pé, entre séries.

REGRA CRÍTICA: escolha alternativas APENAS do catálogo fornecido, pelo "id" exato. Um exercício que a unidade não tem é o mesmo que nenhuma resposta.

Escolha preservando, nesta ordem de prioridade:
1. o grupo muscular alvo;
2. o padrão de movimento (empurrar/puxar, horizontal/vertical, uni/bilateral);
3. a possibilidade de carga semelhante.

Ajuste séries e repetições quando a alternativa exigir — um exercício com peso livre no lugar de uma máquina costuma pedir menos carga e mais atenção à execução. Explique o ajuste em uma frase.

QUANDO O MOTIVO FOR DOR OU DESCONFORTO: não sugira "a mesma coisa mais leve". Ou troque o padrão de movimento para poupar a região, ou oriente a pular o exercício. Você NÃO é um profissional de saúde licenciado: diante de dor recorrente, recomende avaliação presencial antes de insistir na região.

Respeite as limitações informadas. Uma limitação que impeça o padrão de movimento elimina a alternativa, por melhor que ela seja para o músculo.

Ofereça no máximo 3 alternativas, da melhor para a menos preferida. Menos é melhor: quem está entre séries não compara sete opções.

Responda EXCLUSIVAMENTE com JSON válido no formato:

{
  "alternatives": [
    {
      "exerciseId": "id exato do catálogo",
      "sets": number,
      "reps": "8-12",
      "whyItWorks": "uma frase: o que esta alternativa preserva do original",
      "executionCue": "uma dica curta de execução, ou omitido",
      "loadAdjustment": "LIGHTER | SAME | HEAVIER"
    }
  ],
  "skipRecommended": boolean,
  "skipRationale": "preenchido só quando skipRecommended for true",
  "seekProfessional": boolean
}`;

export function buildExerciseAdaptationMessages(context: ExerciseAdaptationContext): AiMessage[] {
  const { original, reason, reasonDetail, user, availableExercises } = context;

  const motivoLegivel: Record<ExerciseAdaptationReason, string> = {
    EQUIPMENT_BUSY: 'o equipamento está ocupado',
    EQUIPMENT_MISSING: 'a academia não tem este equipamento',
    PAIN_OR_DISCOMFORT: 'o aluno relata dor ou desconforto ao executar',
    TECHNIQUE_UNSURE: 'o aluno não se sente seguro na execução',
    WANTS_VARIATION: 'o aluno quer variar o estímulo',
  };

  const catalogo = availableExercises
    .map((e) => `- ${e.id} | ${e.name} | ${e.muscleGroup} | ${e.equipment.join(', ') || 'livre'}`)
    .join('\n');

  const content = `Adapte este exercício.

EXERCÍCIO ORIGINAL
- id: ${original.id}
- nome: ${original.name}
- grupo muscular: ${original.muscleGroup}
- equipamento: ${original.equipment.join(', ') || 'livre'}
- prescrição: ${original.sets} séries de ${original.reps}

MOTIVO
${motivoLegivel[reason]}${reasonDetail ? `\nRelato do aluno: "${reasonDetail}"` : ''}

ALUNO
- objetivo: ${user.goal}
- nível: ${user.experienceLevel}
- limitações: ${user.limitations?.length ? user.limitations.join(', ') : 'nenhuma informada'}

CATÁLOGO DISPONÍVEL NESTA ACADEMIA
${catalogo}`;

  return [{ role: 'user', content }];
}
