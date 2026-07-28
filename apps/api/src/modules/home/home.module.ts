import { Module } from '@nestjs/common';
import { HomeController } from './home.controller.js';
import { HomeService } from './home.service.js';

@Module({
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
