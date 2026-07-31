/**
 * Consultas operacionais para automação.
 *
 * Exigem `USER_READ_ANY` porque devolvem dados de OUTRAS pessoas — é o
 * mesmo recorte de permissão que já protege a listagem de alunos. O n8n
 * autentica com o token de um SUPER_ADMIN, então passa pelo mesmo RBAC
 * de qualquer outro cliente (ver `infra/n8n/README.md`).
 */

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@atlas/shared';
import { RequirePermissions } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { AdminService, type ActiveUser, type HydrationBelowGoal } from './admin.service.js';

const activeUsersQuerySchema = z.object({
  /** Janela de atividade. O relatório é semanal, daí o padrão. */
  days: z.coerce.number().int().min(1).max(90).default(7),
});

@ApiTags('Administração')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users/active')
  @RequirePermissions(PERMISSIONS.USER_READ_ANY)
  @ApiOperation({ summary: 'Alunos com treino ou hidratação no período' })
  async activeUsers(
    @Query(zodBody(activeUsersQuerySchema)) query: { days: number },
  ): Promise<ActiveUser[]> {
    return this.adminService.listActiveUsers(query.days);
  }

  @Get('hydration/below-goal')
  @RequirePermissions(PERMISSIONS.USER_READ_ANY)
  @ApiOperation({ summary: 'Alunos abaixo da meta de água hoje' })
  async belowWaterGoal(): Promise<HydrationBelowGoal[]> {
    return this.adminService.listBelowWaterGoal();
  }
}
