import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { listExercisesQuerySchema, type ListExercisesQuery } from '@atlas/validation';
import { PERMISSIONS, type AuthenticatedUser } from '@atlas/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { ExercisesService } from './exercises.service.js';

@ApiTags('Exercícios')
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EXERCISE_READ)
  @ApiOperation({ summary: 'Lista exercícios do catálogo' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodBody(listExercisesQuerySchema)) query: ListExercisesQuery,
  ) {
    return this.exercisesService.list(query, user.gymId);
  }

  @Get('muscle-groups')
  @RequirePermissions(PERMISSIONS.EXERCISE_READ)
  @ApiOperation({ summary: 'Grupos musculares e subgrupos' })
  async muscleGroups() {
    return this.exercisesService.listMuscleGroups();
  }

  @Get('equipment')
  @RequirePermissions(PERMISSIONS.EXERCISE_READ)
  @ApiOperation({ summary: 'Equipamentos disponíveis' })
  async equipment() {
    return this.exercisesService.listEquipment();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EXERCISE_READ)
  @ApiOperation({ summary: 'Detalhe do exercício' })
  async findOne(@Param('id') id: string) {
    return this.exercisesService.findById(id);
  }
}
