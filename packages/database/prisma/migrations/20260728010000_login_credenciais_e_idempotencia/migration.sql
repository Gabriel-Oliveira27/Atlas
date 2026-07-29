-- Login por credenciais (e-mail, CPF ou telefone) e idempotência das
-- escritas restantes. Ver docs/auth-security.md e docs/offline-sync.md.

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "clientGeneratedId" TEXT;

-- AlterTable
ALTER TABLE "set_logs" ADD COLUMN     "clientGeneratedId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cpf" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "assessments_userId_clientGeneratedId_key" ON "assessments"("userId", "clientGeneratedId");

-- CreateIndex
CREATE UNIQUE INDEX "set_logs_workoutLogId_clientGeneratedId_key" ON "set_logs"("workoutLogId", "clientGeneratedId");

-- CreateIndex
CREATE UNIQUE INDEX "users_cpf_key" ON "users"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_cpf_idx" ON "users"("cpf");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");
