import { Global, Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { RedisService } from './redis.service.js';
import { RedisThrottlerStorage } from './throttler-redis.storage.js';

@Global()
@Module({
  providers: [EnvConfig, RedisService, RedisThrottlerStorage],
  exports: [RedisService, RedisThrottlerStorage],
})
export class RedisModule {}
