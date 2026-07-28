import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { DeviceSyncService } from './device-sync.service.js';
import { SyncController } from './sync.controller.js';
import { SyncScheduler } from './sync.scheduler.js';
import { SyncService } from './sync.service.js';

@Module({
  controllers: [SyncController],
  providers: [EnvConfig, SyncService, DeviceSyncService, SyncScheduler],
  exports: [SyncService],
})
export class SyncModule {}
