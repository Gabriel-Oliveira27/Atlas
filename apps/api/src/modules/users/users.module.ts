import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [EnvConfig, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
