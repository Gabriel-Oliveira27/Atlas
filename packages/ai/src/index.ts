/**
 * @atlas/ai — camada de inteligência artificial.
 *
 * PRINCÍPIO DE DESIGN: este package não conhece o Atlas.
 * Não importa Prisma, não importa NestJS, não conhece "treino" nem
 * "hidratação". Ele recebe mensagens e devolve texto/JSON.
 *
 * Toda a tradução entre o domínio e o modelo acontece nos templates
 * de prompt (`prompts/`) e no chamador (AiModule da API). Trocar de
 * provedor — ou remover a IA por completo — não afeta o resto.
 */

export * from './types.js';
export * from './provider.js';
export * from './factory.js';
export * from './providers/claude.js';
export * from './providers/openai.js';
export * from './providers/gemini.js';
export * from './prompts/exercise-adaptation.js';
export * from './prompts/weekly-report.js';
export * from './prompts/workout-suggestion.js';
