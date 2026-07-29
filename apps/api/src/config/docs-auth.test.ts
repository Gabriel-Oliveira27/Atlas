/**
 * Testes da proteção do Swagger.
 *
 * O que importa aqui é o que NÃO passa: o `/docs` exposto pelo túnel
 * descreve a superfície inteira da API.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildDocsGuard } from './docs-auth.js';

const CREDENCIAIS = { user: 'atlas', password: 'senha-da-documentacao' };

function chamar(url: string, authorization?: string) {
  const done = vi.fn();
  const send = vi.fn();
  const reply = {
    code: vi.fn(() => reply),
    header: vi.fn(() => reply),
    send,
  };

  const guard = buildDocsGuard(CREDENCIAIS);
  guard({ url, headers: { authorization } }, reply, done);

  return { done, reply, send, passou: done.mock.calls.length > 0 };
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('guard da documentação', () => {
  it('deixa passar rota que não é de documentação', () => {
    expect(chamar('/api/health').passou).toBe(true);
  });

  it('exige credencial em /docs', () => {
    const { passou, reply } = chamar('/docs');
    expect(passou).toBe(false);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  /**
   * O JSON do OpenAPI é o contrato inteiro em texto — é o primeiro
   * lugar que uma ferramenta automatizada busca. Proteger só a página
   * deixaria a porta aberta.
   */
  it('exige credencial também no JSON do OpenAPI', () => {
    expect(chamar('/docs-json').passou).toBe(false);
  });

  it('protege as sub-rotas de assets do Swagger', () => {
    expect(chamar('/docs/swagger-ui-init.js').passou).toBe(false);
  });

  it('responde com WWW-Authenticate para o navegador pedir a senha', () => {
    const { reply } = chamar('/docs');
    expect(reply.header).toHaveBeenCalledWith('www-authenticate', expect.stringContaining('Basic'));
  });

  /**
   * Regressão: o realm tinha "documentação". Cabeçalho HTTP não aceita
   * caractere fora do ASCII — o Node responde ERR_INVALID_CHAR e o
   * usuário recebe 500 no lugar do 401 que pede a senha.
   */
  it('usa realm só com ASCII, senão o Node recusa o cabeçalho', () => {
    const { reply } = chamar('/docs');
    // `vi.fn()` sem assinatura infere a lista de argumentos como tupla
    // vazia; o cast diz ao TypeScript o formato real das chamadas.
    const chamadas = reply.header.mock.calls as unknown as [string, string][];
    const chamada = chamadas.find(([nome]) => nome === 'www-authenticate');

    expect(chamada).toBeDefined();
    // Faixa do ASCII imprimível: é o que um cabeçalho HTTP aceita.
    expect(chamada?.[1] ?? '').toMatch(/^[\x20-\x7E]*$/);
  });

  it('aceita a credencial correta', () => {
    expect(chamar('/docs', basic('atlas', 'senha-da-documentacao')).passou).toBe(true);
  });

  it('recusa senha errada', () => {
    expect(chamar('/docs', basic('atlas', 'senha-errada')).passou).toBe(false);
  });

  it('recusa usuário errado', () => {
    expect(chamar('/docs', basic('outro', 'senha-da-documentacao')).passou).toBe(false);
  });

  it('recusa esquema que não é Basic', () => {
    expect(chamar('/docs', 'Bearer um-token-qualquer').passou).toBe(false);
  });

  it('ignora a query ao decidir se a rota é protegida', () => {
    expect(chamar('/docs?tentativa=1').passou).toBe(false);
  });

  /** Senha com ":" é legítima; só o PRIMEIRO separa usuário de senha. */
  it('aceita senha contendo dois-pontos', () => {
    const guard = buildDocsGuard({ user: 'atlas', password: 'a:b:c' });
    const done = vi.fn();
    const reply = { code: vi.fn(), header: vi.fn(), send: vi.fn() };
    reply.code.mockReturnValue(reply);
    reply.header.mockReturnValue(reply);

    guard({ url: '/docs', headers: { authorization: basic('atlas', 'a:b:c') } }, reply, done);

    expect(done).toHaveBeenCalled();
  });

  it('não confunde prefixo parecido com a rota protegida', () => {
    // `/docsecreto` não é `/docs` — não deve ser bloqueado por engano.
    expect(chamar('/docsecreto').passou).toBe(true);
  });
});
