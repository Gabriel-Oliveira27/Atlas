/**
 * @atlas/auth — primitivas de autenticação e autorização.
 *
 * Deliberadamente livre de framework: nada de NestJS aqui. A API
 * consome estas funções dentro de guards/services, e a mesma lógica
 * de RBAC pode ser reaproveitada por qualquer outro consumidor.
 */

export * from './tokens.js';
export * from './rbac.js';
export * from './password.js';
export * from './activation.js';
export * from './webhook-signature.js';
