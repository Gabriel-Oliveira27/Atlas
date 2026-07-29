/** Schemas de autenticação. */

import { z } from 'zod';
import {
  cpfSchema,
  emailSchema,
  loginIdentifierSchema,
  passwordSchema,
  phoneSchema,
} from '../common.js';

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
 * Login por credenciais.
 *
 * `identifier` é um campo ÚNICO na tela: o usuário digita e-mail, CPF
 * ou telefone e a API descobre qual é. Três campos separados obrigariam
 * o usuário a lembrar com o que se cadastrou — e ele não lembra.
 */
export const credentialsLoginSchema = z.object({
  identifier: loginIdentifierSchema,
  password: z.string().min(1, 'Informe a senha').max(72),
  deviceId: z.string().min(1).max(128).optional(),
});
export type CredentialsLoginInput = z.infer<typeof credentialsLoginSchema>;

/**
 * Cadastro por credenciais.
 *
 * O e-mail é obrigatório porque é o canal de recuperação de conta;
 * CPF e telefone são opcionais, mas quem informa passa a poder entrar
 * por eles. Todos são únicos no banco.
 */
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome completo').max(120),
  email: emailSchema,
  password: passwordSchema,
  cpf: cpfSchema.optional(),
  phone: phoneSchema.optional(),
  deviceId: z.string().min(1).max(128).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Primeiro acesso.
 *
 * A conta já existe (criada pelo seed ou pela academia) mas nunca teve
 * senha. O usuário se identifica, prova a posse com o código de
 * ativação e define a senha na mesma requisição — sai daqui já logado.
 *
 * O código não é opcional de propósito: sem ele, saber o CPF bastaria
 * para tomar a conta.
 */
export const firstAccessSchema = z.object({
  identifier: loginIdentifierSchema,
  /** Entregue fora do app — impresso, no balcão, por mensagem. */
  activationCode: z
    .string()
    .trim()
    .min(6, 'Código de ativação inválido')
    .max(64)
    .transform((value) => value.toUpperCase().replace(/[\s-]/g, '')),
  newPassword: passwordSchema,
  deviceId: z.string().min(1).max(128).optional(),
});
export type FirstAccessInput = z.infer<typeof firstAccessSchema>;

/**
 * Troca de senha do próprio usuário.
 *
 * `currentPassword` é opcional porque quem entrou por Google ainda não
 * tem senha: a primeira definição não tem o que confirmar. Quando já
 * existe hash, a API exige a senha atual — sem isso, um access token
 * roubado viraria posse permanente da conta.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().max(72).optional(),
  newPassword: passwordSchema,
  /** true encerra as demais sessões após a troca. */
  revokeOtherSessions: z.boolean().default(true),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  /** Token de push do Expo. */
  pushToken: z.string().max(255).optional(),
  appVersion: z.string().max(32).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
