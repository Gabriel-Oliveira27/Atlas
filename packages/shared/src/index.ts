/**
 * @atlas/shared — superfície pública.
 *
 * Este package não pode depender de nada específico de servidor
 * (Prisma, Nest, Node APIs) para poder ser importado também pelo
 * web (Next.js) e pelo mobile (React Native).
 */

export * from './constants/app.js';
export * from './constants/roles.js';
export * from './constants/permissions.js';

export * from './enums/domain.js';
export * from './enums/sync.js';

export * from './errors/app-error.js';
export * from './errors/error-codes.js';

export * from './types/api.js';
export * from './types/auth.js';
export * from './types/sync.js';
export * from './types/pagination.js';

export * from './utils/date.js';
export * from './utils/health.js';
export * from './utils/identity.js';
export * from './utils/result.js';
