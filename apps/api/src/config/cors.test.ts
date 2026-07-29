/**
 * Testes da decisão de CORS.
 *
 * O foco não é o caminho feliz — é o conjunto de origens que PARECEM
 * permitidas e não são. Um curinga mal comparado transforma a lista de
 * origens em decoração.
 */

import { describe, expect, it } from 'vitest';
import { buildCorsOrigin, isOriginAllowed } from './cors.js';

const SEM_REDE_LOCAL = { allowPrivateNetwork: false };
const COM_REDE_LOCAL = { allowPrivateNetwork: true };

describe('isOriginAllowed', () => {
  it('aceita a origem exata', () => {
    expect(
      isOriginAllowed('https://atlas.vercel.app', ['https://atlas.vercel.app'], SEM_REDE_LOCAL),
    ).toBe(true);
  });

  it('recusa origem fora da lista', () => {
    expect(
      isOriginAllowed('https://invasor.com', ['https://atlas.vercel.app'], SEM_REDE_LOCAL),
    ).toBe(false);
  });

  it('distingue http de https na mesma máquina', () => {
    expect(
      isOriginAllowed('http://atlas.vercel.app', ['https://atlas.vercel.app'], SEM_REDE_LOCAL),
    ).toBe(false);
  });

  it('distingue portas', () => {
    expect(
      isOriginAllowed('http://localhost:3002', ['http://localhost:3001'], SEM_REDE_LOCAL),
    ).toBe(false);
  });

  describe('curinga', () => {
    it('cobre os previews da Vercel', () => {
      expect(
        isOriginAllowed(
          'https://atlas-git-nova-branch.vercel.app',
          ['https://*.vercel.app'],
          SEM_REDE_LOCAL,
        ),
      ).toBe(true);
    });

    it('cobre o subdomínio sorteado do túnel', () => {
      expect(
        isOriginAllowed(
          'https://bravo-tigre-azul.trycloudflare.com',
          ['https://*.trycloudflare.com'],
          SEM_REDE_LOCAL,
        ),
      ).toBe(true);
    });

    /**
     * O ataque clássico contra comparação por sufixo/prefixo: o domínio
     * permitido vira apenas um pedaço do host do invasor.
     */
    it('NÃO casa quando o domínio permitido é prefixo do host do invasor', () => {
      expect(
        isOriginAllowed('https://vercel.app.invasor.com', ['https://*.vercel.app'], SEM_REDE_LOCAL),
      ).toBe(false);
    });

    it('NÃO casa quando o domínio permitido é sufixo colado em outro nome', () => {
      expect(
        isOriginAllowed('https://naovercel.app', ['https://*.vercel.app'], SEM_REDE_LOCAL),
      ).toBe(false);
    });

    it('o curinga cobre UM rótulo, não uma cadeia deles', () => {
      expect(
        isOriginAllowed('https://a.b.vercel.app', ['https://*.vercel.app'], SEM_REDE_LOCAL),
      ).toBe(false);
    });

    it('não casa com o domínio nu', () => {
      expect(isOriginAllowed('https://vercel.app', ['https://*.vercel.app'], SEM_REDE_LOCAL)).toBe(
        false,
      );
    });
  });

  describe('rede local', () => {
    it('libera o IP da máquina no Wi-Fi quando habilitado', () => {
      expect(isOriginAllowed('http://192.168.0.10:3000', [], COM_REDE_LOCAL)).toBe(true);
    });

    it.each(['http://10.0.0.5:3000', 'http://172.20.1.4:3000', 'http://127.0.0.1:3000'])(
      'libera %s',
      (origem) => {
        expect(isOriginAllowed(origem, [], COM_REDE_LOCAL)).toBe(true);
      },
    );

    it('não confunde 172.32 com a faixa privada (que termina em 172.31)', () => {
      expect(isOriginAllowed('http://172.32.0.1:3000', [], COM_REDE_LOCAL)).toBe(false);
    });

    it('bloqueia a rede local quando desabilitada — é o caso de produção', () => {
      expect(isOriginAllowed('http://192.168.0.10:3000', [], SEM_REDE_LOCAL)).toBe(false);
    });

    it('não libera host público só porque parece um IP', () => {
      expect(isOriginAllowed('http://8.8.8.8:3000', [], COM_REDE_LOCAL)).toBe(false);
    });
  });

  it('recusa origem ilegível em vez de tratá-la como ausente', () => {
    expect(isOriginAllowed('nao-e-uma-url', ['https://atlas.vercel.app'], SEM_REDE_LOCAL)).toBe(
      false,
    );
  });
});

describe('buildCorsOrigin', () => {
  /**
   * O app Android não envia `Origin`. Recusar aqui quebraria o app sem
   * impedir ataque nenhum — CORS protege o navegador, não a API.
   */
  it('libera requisição sem Origin (app nativo, curl, healthcheck)', () => {
    const resolver = buildCorsOrigin([], SEM_REDE_LOCAL);
    resolver(undefined, (error, allow) => {
      expect(error).toBeNull();
      expect(allow).toBe(true);
    });
  });

  it('recusa origem de navegador fora da lista', () => {
    const resolver = buildCorsOrigin(['https://atlas.vercel.app'], SEM_REDE_LOCAL);
    resolver('https://invasor.com', (error, allow) => {
      expect(error).toBeNull();
      expect(allow).toBe(false);
    });
  });
});
