import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listUsersQuerySchema,
  logWeightSchema,
  paginationSchema,
  updatePreferencesSchema,
  updateProfileSchema,
  type ListUsersQuery,
  type LogWeightInput,
  type PaginationInput,
  type UpdatePreferencesInput,
  type UpdateProfileInput,
} from '@atlas/validation';
import { PERMISSIONS, type AuthenticatedUser } from '@atlas/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

@ApiTags('Usuários')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Atualiza o perfil' })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.usersService.updateProfile(user.id, body);
  }

  @Patch('me/preferences')
  @ApiOperation({ summary: 'Atualiza preferências (tema, idioma, notificações)' })
  async updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updatePreferencesSchema)) body: UpdatePreferencesInput,
  ) {
    return this.usersService.updatePreferences(user.id, body);
  }

  @Get('me/water-goal/suggestion')
  @ApiOperation({ summary: 'Sugestão de meta diária de água com base no peso' })
  async suggestWaterGoal(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.suggestWaterGoal(user.id);
  }

  @Post('me/weight')
  @ApiOperation({ summary: 'Registra o peso do dia' })
  async logWeight(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(logWeightSchema)) body: LogWeightInput,
  ) {
    return this.usersService.logWeight(user.id, body);
  }

  @Get('me/weight/history')
  @ApiOperation({ summary: 'Histórico de peso (paginado)' })
  async weightHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodBody(paginationSchema)) query: PaginationInput,
  ) {
    return this.usersService.getWeightHistory(user.id, query);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.USER_READ_ANY)
  @ApiOperation({ summary: 'Lista usuários (escopo da academia)' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodBody(listUsersQuerySchema)) query: ListUsersQuery,
  ) {
    return this.usersService.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USER_READ_ANY)
  @ApiOperation({ summary: 'Detalhe de um usuário' })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.findByIdScoped(user, id);
  }
}
