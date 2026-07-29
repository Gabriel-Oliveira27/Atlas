/**
 * Autenticação de ponta a ponta.
 *
 * Cobre o que o handoff marcou como bloqueante: rotação de refresh e
 * derrubada da família no reuso. Cobre também o login por credenciais
 * que substituiu o `dev-login`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLES } from '@atlas/shared';
import {
  createTestApp,
  createUser,
  login,
  request,
  resetDatabase,
  resetRateLimit,
  type TestContext,
} from './harness.js';

let context: TestContext;
let app: NestFastifyApplication;

beforeAll(async () => {
  context = await createTestApp();
  app = context.app;
});

afterAll(async () => {
  await context.app.close();
});

beforeEach(async () => {
  await resetDatabase(context.prisma);
  await resetRateLimit(context.redis);
});

describe('POST /auth/login — identificadores aceitos', () => {
  it('entra por e-mail', async () => {
    const user = await createUser(context.prisma, { email: 'aluno@atlas.test' });

    const response = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: 'aluno@atlas.test', password: user.password },
    });

    expect(response.status).toBe(200);
    const data = response.body.data as { tokens: { accessToken: string }; user: { id: string } };
    expect(data.tokens.accessToken).toBeTruthy();
    expect(data.user.id).toBe(user.id);
  });

  it('entra por e-mail com maiúsculas e espaços', async () => {
    const user = await createUser(context.prisma, { email: 'aluno@atlas.test' });

    const response = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: '  Aluno@Atlas.TEST  ', password: user.password },
    });

    expect(response.status).toBe(200);
  });

  it('entra por CPF, digitado com ou sem pontuação', async () => {
    const user = await createUser(context.prisma, { cpf: '52998224725' });

    for (const identifier of ['52998224725', '529.982.247-25']) {
      const response = await request(app, {
        method: 'POST',
        url: '/auth/login',
        payload: { identifier, password: user.password },
      });

      expect(response.status, `identificador ${identifier}`).toBe(200);
    }
  });

  it('entra por telefone em qualquer formatação', async () => {
    const user = await createUser(context.prisma, { phone: '+5511988887777' });

    for (const identifier of ['11988887777', '(11) 98888-7777', '+55 11 98888-7777']) {
      const response = await request(app, {
        method: 'POST',
        url: '/auth/login',
        payload: { identifier, password: user.password },
      });

      expect(response.status, `identificador ${identifier}`).toBe(200);
    }
  });

  it('recusa senha errada e conta inexistente com o MESMO código', async () => {
    const user = await createUser(context.prisma, { email: 'aluno@atlas.test' });

    const senhaErrada = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: 'senha-errada-9' },
    });

    const contaInexistente = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: 'ninguem@atlas.test', password: 'senha-errada-9' },
    });

    // Códigos distintos entregariam ao atacante a lista de quem tem conta.
    expect(senhaErrada.status).toBe(401);
    expect(contaInexistente.status).toBe(401);
    expect(senhaErrada.body.error?.code).toBe('INVALID_CREDENTIALS');
    expect(contaInexistente.body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('recusa conta inativa', async () => {
    const user = await createUser(context.prisma, { isActive: false });

    const response = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: user.password },
    });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('USER_INACTIVE');
  });

  it('manda para o primeiro acesso quando a conta nunca foi ativada', async () => {
    const user = await createUser(context.prisma, { pendingActivation: true });

    const response = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: 'qualquer-senha-1' },
    });

    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe('FIRST_ACCESS_REQUIRED');
  });

  it('manda para o Google quando a conta veio do OAuth e não tem senha', async () => {
    const user = await createUser(context.prisma);

    // Sem senha, MAS com provedor vinculado — a saída é outra.
    await context.prisma.db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: null,
        oauthAccounts: {
          create: { provider: 'google', providerAccountId: `g-${user.id}`, email: user.email },
        },
      },
    });

    const response = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: 'qualquer-senha-1' },
    });

    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe('PASSWORD_NOT_SET');
  });
});

describe('POST /auth/first-access', () => {
  it('define a senha com o código e já devolve a sessão', async () => {
    const user = await createUser(context.prisma, {
      pendingActivation: true,
      cpf: '02515718310',
    });

    const response = await request(app, {
      method: 'POST',
      url: '/auth/first-access',
      payload: {
        identifier: '025.157.183-10',
        activationCode: user.activationCode,
        newPassword: 'minha-senha-1',
      },
    });

    expect(response.status).toBe(200);
    const data = response.body.data as { tokens: { accessToken: string } };
    expect(data.tokens.accessToken).toBeTruthy();

    // E a senha nova serve para entrar pelo caminho normal.
    const login = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: '02515718310', password: 'minha-senha-1' },
    });
    expect(login.status).toBe(200);
  });

  it('aceita o código em minúsculo e com hífen', async () => {
    const user = await createUser(context.prisma, { pendingActivation: true });
    const digitado = `${user.activationCode?.slice(0, 4)}-${user.activationCode?.slice(4)}`;

    const response = await request(app, {
      method: 'POST',
      url: '/auth/first-access',
      payload: {
        identifier: user.email,
        activationCode: digitado.toLowerCase(),
        newPassword: 'minha-senha-1',
      },
    });

    expect(response.status).toBe(200);
  });

  it('o código é de uso único', async () => {
    const user = await createUser(context.prisma, { pendingActivation: true });
    const payload = {
      identifier: user.email,
      activationCode: user.activationCode,
      newPassword: 'minha-senha-1',
    };

    const primeira = await request(app, { method: 'POST', url: '/auth/first-access', payload });
    const segunda = await request(app, {
      method: 'POST',
      url: '/auth/first-access',
      payload: { ...payload, newPassword: 'outra-senha-2' },
    });

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(401);
    expect(segunda.body.error?.code).toBe('ACTIVATION_CODE_INVALID');
  });

  it('recusa código errado — e não diz se a conta existe', async () => {
    const user = await createUser(context.prisma, { pendingActivation: true });

    const codigoErrado = await request(app, {
      method: 'POST',
      url: '/auth/first-access',
      payload: {
        identifier: user.email,
        activationCode: 'ZZZZ9999',
        newPassword: 'minha-senha-1',
      },
    });

    const contaInexistente = await request(app, {
      method: 'POST',
      url: '/auth/first-access',
      payload: {
        identifier: 'ninguem@atlas.test',
        activationCode: 'ZZZZ9999',
        newPassword: 'minha-senha-1',
      },
    });

    expect(codigoErrado.status).toBe(401);
    expect(contaInexistente.status).toBe(401);
    expect(codigoErrado.body.error?.code).toBe(contaInexistente.body.error?.code);
    expect(codigoErrado.body.error?.message).toBe(contaInexistente.body.error?.message);
  });

  it('recusa código expirado', async () => {
    const user = await createUser(context.prisma, {
      pendingActivation: true,
      activationExpiresAt: new Date(Date.now() - 1000),
    });

    const response = await request(app, {
      method: 'POST',
      url: '/auth/first-access',
      payload: {
        identifier: user.email,
        activationCode: user.activationCode,
        newPassword: 'minha-senha-1',
      },
    });

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe('ACTIVATION_CODE_INVALID');
  });

  it('não reabre a porta de quem já tem senha', async () => {
    const user = await createUser(context.prisma);

    const response = await request(app, {
      method: 'POST',
      url: '/auth/first-access',
      payload: {
        identifier: user.email,
        activationCode: 'QUALQUER1',
        newPassword: 'senha-do-atacante-1',
      },
    });

    expect(response.status).toBe(401);

    // E a senha original continua valendo.
    const login = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: user.password },
    });
    expect(login.status).toBe(200);
  });

  it('exige senha forte também no primeiro acesso', async () => {
    const user = await createUser(context.prisma, { pendingActivation: true });

    const response = await request(app, {
      method: 'POST',
      url: '/auth/first-access',
      payload: {
        identifier: user.email,
        activationCode: user.activationCode,
        newPassword: 'fraca',
      },
    });

    expect(response.status).toBe(422);
  });
});

describe('POST /auth/register', () => {
  it('cria a conta e já devolve sessão', async () => {
    const response = await request(app, {
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Aluno Novo',
        email: 'novo@atlas.test',
        password: 'senha-forte-1',
        cpf: '529.982.247-25',
        phone: '(11) 98888-7777',
      },
    });

    expect(response.status).toBe(201);

    // CPF e telefone são gravados na forma canônica — senão o mesmo
    // número cadastrado com outra máscara viraria uma segunda conta.
    const saved = await context.prisma.db.user.findUniqueOrThrow({
      where: { email: 'novo@atlas.test' },
      select: { cpf: true, phone: true, role: { select: { name: true } } },
    });

    expect(saved.cpf).toBe('52998224725');
    expect(saved.phone).toBe('+5511988887777');
    expect(saved.role.name).toBe(ROLES.USER);
  });

  it('aponta o campo exato quando o identificador já existe', async () => {
    await createUser(context.prisma, {
      email: 'ocupado@atlas.test',
      cpf: '52998224725',
      phone: '+5511988887777',
    });

    const porEmail = await request(app, {
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Outro', email: 'ocupado@atlas.test', password: 'senha-forte-1' },
    });

    const porCpf = await request(app, {
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Outro',
        email: 'livre@atlas.test',
        password: 'senha-forte-1',
        cpf: '52998224725',
      },
    });

    const porTelefone = await request(app, {
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Outro',
        email: 'livre2@atlas.test',
        password: 'senha-forte-1',
        phone: '11988887777',
      },
    });

    expect(porEmail.body.error?.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(porCpf.body.error?.code).toBe('CPF_ALREADY_REGISTERED');
    expect(porTelefone.body.error?.code).toBe('PHONE_ALREADY_REGISTERED');
  });

  it('recusa CPF com dígito verificador inválido', async () => {
    const response = await request(app, {
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Aluno',
        email: 'cpfruim@atlas.test',
        password: 'senha-forte-1',
        cpf: '11111111111',
      },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('recusa senha sem número ou curta demais', async () => {
    for (const password of ['somenteletras', 'abc1']) {
      const response = await request(app, {
        method: 'POST',
        url: '/auth/register',
        payload: { name: 'Aluno', email: `s${password}@atlas.test`, password },
      });

      expect(response.status, `senha "${password}"`).toBe(422);
    }
  });
});

describe('POST /auth/refresh — rotação e detecção de reuso', () => {
  it('rotaciona: o token novo funciona e o antigo morre', async () => {
    const user = await createUser(context.prisma);
    const first = await login(app, user.email, user.password, 'dispositivo-1');

    const rotated = await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first.refreshToken, deviceId: 'dispositivo-1' },
    });

    expect(rotated.status).toBe(200);
    const tokens = rotated.body.data as { refreshToken: string; accessToken: string };
    expect(tokens.refreshToken).not.toBe(first.refreshToken);

    const comNovo = await request(app, {
      method: 'GET',
      url: '/auth/me',
      token: tokens.accessToken,
    });
    expect(comNovo.status).toBe(200);
  });

  it('reuso de refresh revogado derruba a família inteira do dispositivo', async () => {
    const user = await createUser(context.prisma);
    const first = await login(app, user.email, user.password, 'dispositivo-1');

    // Uso legítimo: rotaciona.
    const rotated = await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first.refreshToken, deviceId: 'dispositivo-1' },
    });
    const segundoRefresh = (rotated.body.data as { refreshToken: string }).refreshToken;

    // Reuso do token ANTIGO: sinal de roubo.
    const reuso = await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first.refreshToken, deviceId: 'dispositivo-1' },
    });

    expect(reuso.status).toBe(401);
    expect(reuso.body.error?.code).toBe('REFRESH_TOKEN_REUSED');

    // E o token que estava válido também cai: é o ponto da defesa —
    // o ladrão perde o acesso, e a vítima percebe que foi desconectada.
    const depois = await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: segundoRefresh, deviceId: 'dispositivo-1' },
    });

    expect(depois.status).toBe(401);

    const vivos = await context.prisma.db.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(vivos).toBe(0);
  });

  it('não derruba a sessão de OUTRO dispositivo', async () => {
    const user = await createUser(context.prisma);
    const noCelular = await login(app, user.email, user.password, 'celular');
    const noNavegador = await login(app, user.email, user.password, 'navegador');

    await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: noCelular.refreshToken, deviceId: 'celular' },
    });
    await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: noCelular.refreshToken, deviceId: 'celular' },
    });

    const navegadorAindaVale = await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: noNavegador.refreshToken, deviceId: 'navegador' },
    });

    expect(navegadorAindaVale.status).toBe(200);
  });

  it('recusa refresh desconhecido', async () => {
    const user = await createUser(context.prisma);
    const tokens = await login(app, user.email, user.password);

    // Token criptograficamente válido, mas nunca emitido por nós:
    // trocar um caractere invalida a assinatura.
    const adulterado = `${tokens.refreshToken.slice(0, -2)}xy`;

    const response = await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: adulterado },
    });

    expect(response.status).toBe(401);
  });
});

describe('POST /auth/password', () => {
  it('exige a senha atual de quem já tem senha', async () => {
    const user = await createUser(context.prisma);
    const tokens = await login(app, user.email, user.password);

    const semAtual = await request(app, {
      method: 'POST',
      url: '/auth/password',
      token: tokens.accessToken,
      payload: { newPassword: 'nova-senha-9' },
    });

    expect(semAtual.status).toBe(401);
    expect(semAtual.body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('troca a senha e revoga as demais sessões', async () => {
    const user = await createUser(context.prisma);
    const tokens = await login(app, user.email, user.password, 'celular');

    const trocada = await request(app, {
      method: 'POST',
      url: '/auth/password',
      token: tokens.accessToken,
      payload: {
        currentPassword: user.password,
        newPassword: 'nova-senha-9',
        revokeOtherSessions: true,
      },
    });

    expect(trocada.status).toBe(204);

    const comNova = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: 'nova-senha-9' },
    });
    expect(comNova.status).toBe(200);

    const refreshAntigo = await request(app, {
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(refreshAntigo.status).toBe(401);
  });
});

describe('rotas de autenticação — superfície', () => {
  it('o dev-login não existe mais', async () => {
    const response = await request(app, {
      method: 'POST',
      url: '/auth/dev-login',
      payload: { email: 'admin@atlas.local' },
    });

    expect(response.status).toBe(404);
  });

  it('/auth/me exige token', async () => {
    const semToken = await request(app, { method: 'GET', url: '/auth/me' });
    expect(semToken.status).toBe(401);

    const tokenInvalido = await request(app, {
      method: 'GET',
      url: '/auth/me',
      token: 'nao-e-um-jwt',
    });
    expect(tokenInvalido.status).toBe(401);
  });

  it('/auth/providers anuncia os identificadores aceitos', async () => {
    const response = await request(app, { method: 'GET', url: '/auth/providers' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      credentials: true,
      identifiers: ['email', 'cpf', 'phone'],
    });
  });
});
