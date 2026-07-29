import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  finishWorkoutSessionSchema,
  listWorkoutLogsQuerySchema,
  logSetSchema,
  paginationSchema,
  startWorkoutSessionSchema,
  type FinishWorkoutSessionInput,
  type ListWorkoutLogsQuery,
  type LogSetInput,
  type PaginationInput,
  type StartWorkoutSessionInput,
} from '@atlas/validation';
import { PERMISSIONS, type AuthenticatedUser } from '@atlas/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { WorkoutsService } from './workouts.service.js';

@ApiTags('Treinos')
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get('plans')
  @RequirePermissions(PERMISSIONS.WORKOUT_READ)
  @ApiOperation({ summary: 'Planos de treino do usuário (paginado)' })
  async listPlans(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodBody(paginationSchema)) query: PaginationInput,
  ) {
    return this.workoutsService.listPlans(user.id, query);
  }

  @Get('plans/active')
  @RequirePermissions(PERMISSIONS.WORKOUT_READ)
  @ApiOperation({ summary: 'Plano ativo com dias e exercícios' })
  async activePlan(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutsService.getActivePlan(user.id);
  }

  @Post('sessions')
  @RequirePermissions(PERMISSIONS.WORKOUT_LOG)
  @ApiOperation({ summary: 'Inicia uma sessão de treino' })
  async startSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(startWorkoutSessionSchema)) body: StartWorkoutSessionInput,
  ) {
    return this.workoutsService.startSession(user.id, body);
  }

  @Get('sessions/open')
  @RequirePermissions(PERMISSIONS.WORKOUT_READ)
  @ApiOperation({ summary: 'Sessão em andamento, se houver' })
  async openSession(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutsService.getOpenSession(user.id);
  }

  @Get('sessions')
  @RequirePermissions(PERMISSIONS.WORKOUT_READ)
  @ApiOperation({ summary: 'Histórico de sessões (paginado)' })
  async listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodBody(listWorkoutLogsQuerySchema)) query: ListWorkoutLogsQuery,
  ) {
    return this.workoutsService.listSessions(user, query);
  }

  @Post('sessions/:id/sets')
  @RequirePermissions(PERMISSIONS.WORKOUT_LOG)
  @ApiOperation({ summary: 'Registra uma série executada' })
  async logSet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
    @Body(zodBody(logSetSchema)) body: LogSetInput,
  ) {
    return this.workoutsService.logSet(user.id, sessionId, body);
  }

  @Post('sessions/:id/finish')
  @RequirePermissions(PERMISSIONS.WORKOUT_LOG)
  @ApiOperation({ summary: 'Finaliza a sessão e consolida os totais' })
  async finishSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
    @Body(zodBody(finishWorkoutSessionSchema)) body: FinishWorkoutSessionInput,
  ) {
    return this.workoutsService.finishSession(user.id, sessionId, body);
  }
}
