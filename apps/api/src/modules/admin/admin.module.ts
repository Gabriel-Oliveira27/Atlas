/**
 * Rotas consumidas pelos workflows do N8N.
 *
 * Dois controllers, dois prefixos: `/admin` para as consultas
 * operacionais e `/notifications` para o envio. Os caminhos não são
 * escolha nossa — são os que os workflows em `infra/n8n/workflows/` já
 * chamam desde que foram escritos.
 */

import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  controllers: [AdminController, NotificationsController],
  providers: [EnvConfig, AdminService, NotificationsService],
  exports: [AdminService, NotificationsService],
})
export class AdminModule {}
