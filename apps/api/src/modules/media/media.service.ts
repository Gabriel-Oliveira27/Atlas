/**
 * Upload de mídias no Cloudinary.
 *
 * A API NÃO recebe o arquivo: ela assina os parâmetros e o cliente
 * envia direto para o Cloudinary. Isso evita que fotos e vídeos passem
 * pelo servidor (banda, memória, timeout) e mantém o `api_secret`
 * exclusivamente no back-end.
 */

import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { AppError, ERROR_CODES } from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';

export type UploadFolder = 'avatars' | 'exercises' | 'assessments' | 'gyms' | 'reports';

export interface SignedUpload {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  uploadUrl: string;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly config: EnvConfig) {
    const settings = this.config.cloudinary;

    if (settings.isConfigured) {
      cloudinary.config({
        cloud_name: settings.cloudName,
        api_key: settings.apiKey,
        api_secret: settings.apiSecret,
        secure: true,
      });
    } else {
      this.logger.warn('Cloudinary não configurado — uploads de mídia ficam indisponíveis.');
    }
  }

  /** Assina um upload direto do cliente. */
  createSignedUpload(folder: UploadFolder, publicIdPrefix?: string): SignedUpload {
    const settings = this.config.cloudinary;

    if (!settings.isConfigured) {
      throw new AppError(ERROR_CODES.UPLOAD_FAILED, 'Cloudinary não está configurado', {
        status: 503,
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const fullFolder = `${settings.folder}/${folder}`;

    const params: Record<string, string | number> = {
      timestamp,
      folder: fullFolder,
      ...(publicIdPrefix ? { public_id: `${publicIdPrefix}-${timestamp}` } : {}),
    };

    const signature = cloudinary.utils.api_sign_request(params, settings.apiSecret ?? '');

    return {
      signature,
      timestamp,
      apiKey: settings.apiKey ?? '',
      cloudName: settings.cloudName ?? '',
      folder: fullFolder,
      uploadUrl: `https://api.cloudinary.com/v1_1/${settings.cloudName}/auto/upload`,
    };
  }

  /**
   * Remove um arquivo do Cloudinary.
   * Chamado ao excluir uma foto de avaliação ou uma mídia de exercício —
   * sem isso, os arquivos ficariam órfãos consumindo cota.
   */
  async destroy(publicId: string): Promise<boolean> {
    if (!this.config.cloudinary.isConfigured) return false;

    try {
      const result = await cloudinary.uploader.destroy(publicId);
      return result.result === 'ok';
    } catch (error) {
      this.logger.error({ err: error }, `Falha ao remover a mídia ${publicId}`);
      return false;
    }
  }

  /** URL com transformações (thumbnail, otimização automática). */
  buildUrl(
    publicId: string,
    options: { width?: number; height?: number; crop?: string } = {},
  ): string {
    return cloudinary.url(publicId, {
      secure: true,
      // `auto` deixa o Cloudinary escolher formato e qualidade conforme
      // o navegador — WebP/AVIF onde houver suporte.
      fetch_format: 'auto',
      quality: 'auto',
      ...options,
    });
  }
}
