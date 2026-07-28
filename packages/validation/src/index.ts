/**
 * @atlas/validation — schemas Zod compartilhados.
 *
 * A MESMA definição valida o corpo da requisição na API (via
 * ZodValidationPipe) e o formulário no front-end (via react-hook-form
 * + zodResolver). Uma regra, um lugar.
 */

export * from './common.js';
export * from './env.js';
export * from './schemas/auth.js';
export * from './schemas/user.js';
export * from './schemas/gym.js';
export * from './schemas/exercise.js';
export * from './schemas/workout.js';
export * from './schemas/hydration.js';
export * from './schemas/assessment.js';
export * from './schemas/sync.js';
export * from './schemas/ai.js';
