#!/bin/bash
# ---------------------------------------------------------------
# Executado UMA ÚNICA VEZ, quando o volume do Postgres é criado.
# Cria os bancos auxiliares que o Atlas precisa além do banco
# principal (criado pelo próprio POSTGRES_DB).
#
# Para reexecutar:  pnpm docker:reset  (apaga os volumes)
# ---------------------------------------------------------------
set -euo pipefail

echo "[atlas] criando bancos auxiliares..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Banco de trabalho do Prisma Migrate. O Prisma cria e destrói
    -- um "shadow database" a cada migration para detectar drift;
    -- criá-lo aqui evita exigir privilégio de CREATEDB em produção.
    SELECT 'CREATE DATABASE atlas_shadow OWNER $POSTGRES_USER'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'atlas_shadow')\gexec

    -- Banco de persistência do n8n (workflows, execuções, credenciais).
    SELECT 'CREATE DATABASE n8n OWNER $POSTGRES_USER'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')\gexec
EOSQL

# Extensões usadas pelo schema do Atlas.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Busca textual sem acento no catálogo de exercícios
    CREATE EXTENSION IF NOT EXISTS unaccent;
    -- Similaridade / busca aproximada por nome de exercício
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    -- Funções de criptografia (hash de refresh tokens em nível de banco, se preciso)
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
EOSQL

echo "[atlas] bancos auxiliares e extensões prontos."
