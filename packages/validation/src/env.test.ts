/**
 * Testes do schema de ambiente.
 *
 * Focados no que é fácil errar em silêncio: a porta que a hospedagem
 * escolhe e as travas que impedem produção com configuração de
 * desenvolvimento.
 */

import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const MINIMO = {
  DATABASE_URL_LOCAL: 'postgresql://atlas:atlas@localhost:5432/atlas?schema=public',
  JWT_ACCESS_SECRET: 'segredo-de-teste-access-0123456789',
  JWT_REFRESH_SECRET: 'segredo-de-teste-refresh-0123456789',
} satisfies NodeJS.ProcessEnv;

describe('porta da API', () => {
  it('usa 3333 quando nada é informado', () => {
    expect(parseEnv({ ...MINIMO }).API_PORT).toBe(3333);
  });

  /**
   * Render, Railway, Fly e Heroku escolhem a porta e a injetam em
   * `PORT`. Sem a ponte, a API subiria na 3333, não responderia ao
   * health check e o deploy morreria em "no open ports detected".
   */
  it('adota PORT quando a hospedagem a injeta', () => {
    expect(parseEnv({ ...MINIMO, PORT: '10000' }).API_PORT).toBe(10000);
  });

  it('API_PORT explícito vence PORT — quem definiu quis', () => {
    expect(parseEnv({ ...MINIMO, PORT: '10000', API_PORT: '4444' }).API_PORT).toBe(4444);
  });
});

describe('CORS_ALLOW_LAN', () => {
  it('vem ligado fora de produção', () => {
    expect(parseEnv({ ...MINIMO, NODE_ENV: 'development' }).CORS_ALLOW_LAN).toBe(true);
  });

  it('vem DESLIGADO em produção — origem privada ali é outra máquina do datacenter', () => {
    const env = parseEnv({
      ...MINIMO,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'producao-access-0123456789abcdef',
      JWT_REFRESH_SECRET: 'producao-refresh-0123456789abcdef',
      DATABASE_URL_CLOUD: 'postgresql://u:p@host.neon.tech/atlas?sslmode=require',
    });

    expect(env.CORS_ALLOW_LAN).toBe(false);
  });

  it('respeita o valor explícito', () => {
    expect(parseEnv({ ...MINIMO, CORS_ALLOW_LAN: 'false' }).CORS_ALLOW_LAN).toBe(false);
  });
});

describe('travas de produção', () => {
  it('recusa segredo de desenvolvimento', () => {
    expect(() =>
      parseEnv({
        ...MINIMO,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'dev-only-nao-use-em-producao',
        DATABASE_URL_CLOUD: 'postgresql://u:p@host.neon.tech/atlas?sslmode=require',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('exige o banco em nuvem — é a redundância', () => {
    expect(() =>
      parseEnv({
        ...MINIMO,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'producao-access-0123456789abcdef',
        JWT_REFRESH_SECRET: 'producao-refresh-0123456789abcdef',
      }),
    ).toThrow(/DATABASE_URL_CLOUD/);
  });
});
