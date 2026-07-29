import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAssessmentSchema,
  listAssessmentsQuerySchema,
  type CreateAssessmentInput,
  type ListAssessmentsQuery,
} from '@atlas/validation';
import { PERMISSIONS, type AuthenticatedUser } from '@atlas/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { AssessmentsService } from './assessments.service.js';

@ApiTags('Avaliações')
@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.ASSESSMENT_CREATE)
  @ApiOperation({
    summary: 'Registra uma avaliação física',
    description:
      'Sem `userId`, a avaliação é do próprio solicitante. Com `userId`, exige escopo sobre o avaliado.',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createAssessmentSchema)) body: CreateAssessmentInput,
  ) {
    return this.assessmentsService.create(user, body);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ASSESSMENT_READ)
  @ApiOperation({ summary: 'Histórico de avaliações (paginado)' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodBody(listAssessmentsQuerySchema)) query: ListAssessmentsQuery,
  ) {
    return this.assessmentsService.list(user, query);
  }

  @Get('compare')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_READ)
  @ApiOperation({ summary: 'Compara duas avaliações' })
  async compare(
    @CurrentUser() user: AuthenticatedUser,
    @Query('fromId') fromId: string,
    @Query('toId') toId: string,
  ) {
    return this.assessmentsService.compare(user, fromId, toId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_READ)
  @ApiOperation({ summary: 'Detalhe da avaliação' })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.assessmentsService.findById(user, id);
  }
}
