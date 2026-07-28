/**
 * @atlas/database — camada de dados do Atlas.
 *
 * Exporta o cliente Prisma gerado, os dois clientes (local/nuvem), o
 * roteador de failover e as bases de repositório.
 */

export * from './client.js';
export * from './router.js';
export * from './repositories/base.repository.js';
export * from './sync/entity-registry.js';
