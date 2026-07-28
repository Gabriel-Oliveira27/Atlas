import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { WorkoutsController } from './workouts.controller.js';
import { WorkoutsService } from './workouts.service.js';

@Module({
  controllers: [WorkoutsController],
  providers: [EnvConfig, WorkoutsService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
