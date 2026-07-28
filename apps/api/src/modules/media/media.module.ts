import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

@Module({
  controllers: [MediaController],
  providers: [EnvConfig, MediaService],
  exports: [MediaService],
})
export class MediaModule {}
