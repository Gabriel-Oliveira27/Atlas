/**
 * Estratégia Google OAuth 2.0.
 *
 * Só é registrada quando as credenciais existem (ver `AuthModule`) —
 * assim a API sobe em uma máquina nova sem exigir configurar o Google
 * antes, e o desenvolvedor descobre o que falta pelo log, não por um
 * crash no boot.
 */

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import type { OAuthProfile } from '@atlas/shared';
import { EnvConfig } from '../../../config/env.config.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: EnvConfig) {
    const google = config.google;

    super({
      clientID: google.clientId ?? 'not-configured',
      clientSecret: google.clientSecret ?? 'not-configured',
      callbackURL: google.callbackUrl,
      scope: ['email', 'profile'],
    });
  }

  /** Normaliza o perfil do Google para o contrato interno. */
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0];

    if (!email?.value) {
      done(new Error('A conta Google não expôs um e-mail'), undefined);
      return;
    }

    const normalized: OAuthProfile = {
      provider: 'google',
      providerAccountId: profile.id,
      email: email.value.toLowerCase(),
      // `verified` vem como boolean ou string dependendo da versão.
      emailVerified: String(email.verified) === 'true',
      name: profile.displayName || email.value.split('@')[0] || 'Usuário',
      ...(profile.photos?.[0]?.value ? { avatarUrl: profile.photos[0].value } : {}),
    };

    done(null, normalized);
  }
}
