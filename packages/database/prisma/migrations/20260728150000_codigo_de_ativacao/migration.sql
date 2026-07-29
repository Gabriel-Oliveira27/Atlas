-- Código de ativação do primeiro acesso.
--
-- A conta nasce sem senha; o código (hash) prova a posse na hora de
-- criar a primeira senha. Ver packages/auth/src/activation.ts.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activationCodeHash" TEXT,
ADD COLUMN     "activationExpiresAt" TIMESTAMP(3);
