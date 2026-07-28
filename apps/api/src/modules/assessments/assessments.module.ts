import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { AssessmentsController } from './assessments.controller.js';
import { AssessmentsService } from './assessments.service.js';

@Module({
  controllers: [AssessmentsController],
  providers: [EnvConfig, AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
