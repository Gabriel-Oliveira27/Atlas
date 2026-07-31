/**
 * Envio de notificação disparado por automação.
 *
 * Hoje "enviar" significa gravar a notificação para o aplicativo buscar.
 * O push pelo Expo entra depois — e quando entrar, entra AQUI, sem que o
 * workflow do N8N mude: ele já chama `/notifications/send` e continua
 * chamando.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@atlas/database';
import { CHANGE_OPERATION } from '@atlas/shared';
import type { SendNotificationInput } from '@atlas/validation';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  async send(input: SendNotificationInput): Promise<{ id: string }> {
    const agora = new Date();

    // Transação com a entrada do outbox junto: uma notificação que exista
    // num banco e não no outro reaparece para o usuário depois da
    // sincronização, como se fosse nova.
    const notificacao = await this.prisma.db.$transaction(async (tx) => {
      const criada = await tx.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          ...(input.data ? { data: input.data as Prisma.InputJsonValue } : {}),
          sentAt: agora,
          originNode: this.config.nodeId,
        },
      });

      await tx.changeLog.create({
        data: {
          entity: 'Notification',
          entityId: criada.id,
          operation: CHANGE_OPERATION.CREATE,
          payload: {
            userId: criada.userId,
            type: criada.type,
            title: criada.title,
            body: criada.body,
            sentAt: criada.sentAt,
          },
          version: criada.version,
          originNode: this.config.nodeId,
          targetNode: this.prisma.replicationTarget,
        },
      });

      return criada;
    });

    this.logger.log(`Notificação ${notificacao.type} enviada ao usuário ${input.userId}.`);

    return { id: notificacao.id };
  }
}
