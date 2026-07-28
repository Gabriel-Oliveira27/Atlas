/** Schemas de autenticação. */

import { z } from 'zod';
import { emailSchema } from '../common.js';

/** Plataforma que originou a sessão — usada no vínculo do refresh token. */
export const clientPlatformSchema = z.enum(['web', 'android', 'ios']).default('web');

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20, 'Refresh token inválido'),
  /** Identificador estável do dispositivo; permite revogar uma sessão só. */
  deviceId: z.string().min(1).max(128).optional(),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
  /** true encerra a sessão em todos os dispositivos. */
  allDevices: z.boolean().default(false),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

/**
 * Início do fluxo Google OAuth. `redirectTo` é validado contra uma
 * allowlist na API — redirect aberto é vetor de phishing.
 */
export const oauthStartSchema = z.object({
  platform: clientPlatformSchema,
  redirectTo: z.string().max(2048).optional(),
});
export type OAuthStartInput = z.infer<typeof oauthStartSchema>;

/**
 * Login por e-mail/senha. Ainda NÃO habilitado — o MVP usa apenas
 * Google OAuth. O schema existe porque a especificação pede a
 * estrutura preparada para e-mail no futuro.
 */
export const emailLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres').max(128),
  deviceId: z.string().min(1).max(128).optional(),
});
export type EmailLoginInput = z.infer<typeof emailLoginSchema>;

export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  /** Token de push do Expo. */
  pushToken: z.string().max(255).optional(),
  appVersion: z.string().max(32).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
