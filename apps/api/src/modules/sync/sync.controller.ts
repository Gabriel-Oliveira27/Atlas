/**
 * Rotas de sincronização.
 *
 * Duas camadas convivem aqui:
 *   • /sync/status, /sync/trigger — operação servidor↔servidor (local↔Neon)
 *   • /sync/push, /sync/pull      — protocolo delta-sync dos dispositivos
 *
 * O lado servidor do protocolo de dispositivos está definido e validado;
 * o armazenamento on-device (SQLite no mobile, IndexedDB no web) é
 * construído junto com os apps — ver `docs/task-list-frontend.md`.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  syncPullSchema,
  syncPushSchema,
  triggerSyncSchema,
  type SyncPullInput,
  type SyncPushInput,
  type TriggerSyncInput,
} from '@atlas/validation';
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type SyncPullResponse,
  type SyncProgressResponse,
  type SyncPushResponse,
  type SyncRunSummary,
  type SyncStatusResponse,
} from '@atlas/shared';
import { CurrentUser, RequirePermissions, ThrottleFamily } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { SyncService } from './sync.service.js';
import { DeviceSyncService } from './device-sync.service.js';

@ApiTags('Sincronização')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly deviceSync: DeviceSyncService,
  ) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.SYNC_READ)
  @ApiOperation({ summary: 'Estado atual da sincronização' })
  async status(): Promise<SyncStatusResponse> {
    return this.syncService.getStatus();
  }

  /**
   * Progresso ao vivo. Feito para ser consultado de segundo em segundo
   * pela tela de sincronização, então não passa pelo throttler de `sync`
   * (que existe para as cargas grandes de push/pull, não para leitura).
   */
  @Get('progress')
  @RequirePermissions(PERMISSIONS.SYNC_READ)
  @ApiOperation({ summary: 'Progresso ao vivo da sincronização' })
  async progress(): Promise<SyncProgressResponse> {
    return this.syncService.getProgress();
  }

  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @ThrottleFamily('sync')
  @RequirePermissions(PERMISSIONS.SYNC_TRIGGER)
  @ApiOperation({ summary: 'Dispara uma sincronização manual' })
  async trigger(@Body(zodBody(triggerSyncSchema)) body: TriggerSyncInput): Promise<SyncRunSummary> {
    return this.syncService.run({
      trigger: 'MANUAL',
      direction: body.direction,
      ...(body.entities ? { entities: body.entities } : {}),
      fullResync: body.fullResync,
    });
  }

  /** Dispositivo envia o que alterou enquanto estava offline. */
  @Post('push')
  @HttpCode(HttpStatus.OK)
  @ThrottleFamily('sync')
  @ApiOperation({ summary: 'Envia alterações locais do dispositivo' })
  async push(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(syncPushSchema)) body: SyncPushInput,
  ): Promise<SyncPushResponse> {
    return this.deviceSync.push(user.id, body);
  }

  /** Dispositivo busca o que mudou desde o último cursor. */
  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ThrottleFamily('sync')
  @ApiOperation({ summary: 'Busca alterações do servidor desde o último cursor' })
  async pull(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(syncPullSchema)) body: SyncPullInput,
  ): Promise<SyncPullResponse> {
    return this.deviceSync.pull(user.id, body);
  }
}
