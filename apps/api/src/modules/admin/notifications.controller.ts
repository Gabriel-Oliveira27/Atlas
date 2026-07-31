/**
 * Envio de notificação por automação.
 *
 * `USER_MANAGE` porque a rota escreve na caixa de OUTRA pessoa. Não
 * existe permissão específica de notificação, e criar uma só para isto
 * seria inventar granularidade sem caso de uso: quem administra alunos é
 * exatamente quem manda aviso para eles.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@atlas/shared';
import { sendNotificationSchema, type SendNotificationInput } from '@atlas/validation';
import { RequirePermissions } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Notificações')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  @ApiOperation({ summary: 'Envia uma notificação a um aluno' })
  async send(
    @Body(zodBody(sendNotificationSchema)) body: SendNotificationInput,
  ): Promise<{ id: string }> {
    return this.notifications.send(body);
  }
}
