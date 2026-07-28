import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@atlas/shared';
import { CurrentUser } from '../../common/decorators/index.js';
import { MediaService, type SignedUpload, type UploadFolder } from './media.service.js';

@ApiTags('Mídia')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Assinatura para upload direto ao Cloudinary.
   * O cliente recebe os parâmetros e envia o arquivo sem passar pela API.
   */
  @Get('upload-signature')
  @ApiOperation({ summary: 'Assinatura para upload direto ao Cloudinary' })
  signUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Query('folder') folder: UploadFolder = 'avatars',
  ): SignedUpload {
    return this.mediaService.createSignedUpload(folder, user.id);
  }
}
