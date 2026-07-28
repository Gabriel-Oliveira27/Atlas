import { Global, Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { RedisService } from './redis.service.js';

@Global()
@Module({
  providers: [EnvConfig, RedisService],
  exports: [RedisService],
})
export class RedisModule {}
