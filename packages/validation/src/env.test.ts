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

const NEON = 'postgresql://u:p@ep-abc-pooler.sa-east-1.aws.neon.tech/atlas?sslmode=require';

/**
 * Ambiente de produção válido. Note que o datasource aponta para o Neon,
 * e não para localhost: num serviço hospedado não existe o Postgres do
 * docker-compose, e o schema recusa esse valor.
 */
const PRODUCAO = {
  NODE_ENV: 'production',
  DATABASE_URL_LOCAL: NEON,
  DATABASE_URL_CLOUD: NEON,
  JWT_ACCESS_SECRET: 'producao-access-0123456789abcdef',
  JWT_REFRESH_SECRET: 'producao-refresh-0123456789abcdef',
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
    expect(parseEnv({ ...PRODUCAO }).CORS_ALLOW_LAN).toBe(false);
  });

  it('respeita o valor explícito', () => {
    expect(parseEnv({ ...MINIMO, CORS_ALLOW_LAN: 'false' }).CORS_ALLOW_LAN).toBe(false);
  });
});

describe('travas de produção', () => {
  it('recusa segredo de desenvolvimento', () => {
    expect(() =>
      parseEnv({ ...PRODUCAO, JWT_ACCESS_SECRET: 'dev-only-nao-use-em-producao' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('exige o banco em nuvem — é a redundância', () => {
    const { DATABASE_URL_CLOUD: _omitido, ...semNuvem } = PRODUCAO;

    expect(() => parseEnv(semNuvem)).toThrow(/DATABASE_URL_CLOUD/);
  });

  /**
   * O nome `DATABASE_URL_LOCAL` induz ao erro: em serviço hospedado não
   * existe o Postgres do docker-compose, mas copiar o valor do `.env` é
   * o reflexo natural. Sem esta trava a API sobe, o health check falha
   * por timeout e o deploy é derrubado com "service unhealthy", sem
   * dizer que o banco é inalcançável.
   */
  it.each([
    'postgresql://atlas:senha@localhost:5433/atlas?schema=public',
    'postgresql://atlas:senha@127.0.0.1:5432/atlas',
    'postgresql://atlas:senha@host.docker.internal:5432/atlas',
  ])('recusa datasource apontando para a própria máquina: %s', (url) => {
    expect(() => parseEnv({ ...PRODUCAO, DATABASE_URL_LOCAL: url })).toThrow(/DATABASE_URL_LOCAL/);
  });

  it('aceita o datasource apontando para o Neon — é o esperado no hospedado', () => {
    expect(parseEnv({ ...PRODUCAO }).DATABASE_URL_LOCAL).toBe(NEON);
  });

  it('em desenvolvimento, localhost segue sendo o normal', () => {
    expect(parseEnv({ ...MINIMO }).DATABASE_URL_LOCAL).toContain('localhost');
  });
});
