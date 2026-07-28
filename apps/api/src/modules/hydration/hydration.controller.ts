import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  hydrationHistoryQuerySchema,
  hydrationReminderSchema,
  logHydrationSchema,
  type HydrationHistoryQuery,
  type HydrationReminderInput,
  type LogHydrationInput,
} from '@atlas/validation';
import type { AuthenticatedUser } from '@atlas/shared';
import { CurrentUser } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { HydrationService } from './hydration.service.js';

@ApiTags('Hidratação')
@Controller('hydration')
export class HydrationController {
  constructor(private readonly hydrationService: HydrationService) {}

  @Post('logs')
  @ApiOperation({ summary: 'Registra consumo de líquido' })
  async log(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(logHydrationSchema)) body: LogHydrationInput,
  ) {
    return this.hydrationService.log(user.id, body);
  }

  @Get('today')
  @ApiOperation({ summary: 'Resumo de hidratação do dia' })
  async today(@CurrentUser() user: AuthenticatedUser, @Query('day') day?: string) {
    return this.hydrationService.getDaySummary(user.id, day);
  }

  @Get('history')
  @ApiOperation({ summary: 'Histórico agregado por dia' })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodBody(hydrationHistoryQuerySchema)) query: HydrationHistoryQuery,
  ) {
    return this.hydrationService.getHistory(user.id, query);
  }

  @Delete('logs/:id')
  @ApiOperation({ summary: 'Remove um registro de hidratação' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hydrationService.deleteLog(user.id, id);
  }

  @Get('reminder')
  @ApiOperation({ summary: 'Configuração de lembretes' })
  async getReminder(@CurrentUser() user: AuthenticatedUser) {
    return this.hydrationService.getReminder(user.id);
  }

  @Put('reminder')
  @ApiOperation({ summary: 'Cria ou atualiza os lembretes de hidratação' })
  async upsertReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(hydrationReminderSchema)) body: HydrationReminderInput,
  ) {
    return this.hydrationService.upsertReminder(user.id, body);
  }
}
