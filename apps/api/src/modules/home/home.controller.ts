import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@atlas/shared';
import { CurrentUser } from '../../common/decorators/index.js';
import { HomeService } from './home.service.js';

@ApiTags('Home')
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get()
  @ApiOperation({ summary: 'Dados agregados da tela inicial' })
  async dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.homeService.getDashboard(user.id, user.gymId);
  }
}
