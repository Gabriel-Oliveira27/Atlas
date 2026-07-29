/**
 * Proteção do Swagger por usuário e senha.
 *
 * ── Por que isto existe ─────────────────────────────────────────────
 * O `/docs` descreve TODA a superfície da API: cada rota, cada campo,
 * cada regra de validação. Em `localhost` isso é conveniência. Assim que
 * a API passa a ser alcançável pela internet — que é justamente o caso
 * quando o notebook vira back-end por túnel — a mesma página vira um
 * mapa pronto para quem quiser sondar o sistema.
 *
 * A checagem usa comparação de tempo constante. Comparar credenciais com
 * `===` vaza informação pelo tempo de resposta: a comparação para no
 * primeiro byte diferente, e medir isso repetidamente permite descobrir
 * a senha caractere a caractere. `timingSafeEqual` sempre percorre tudo.
 */

import { timingSafeEqual } from 'node:crypto';

export interface DocsCredentials {
  user: string;
  password: string;
}

/**
 * Só o que o guard realmente lê e escreve.
 *
 * Não importamos `FastifyRequest`/`FastifyReply` de propósito: o
 * `@fastify/cookie` faz *declaration merging* nesses tipos, e um hook
 * tipado com a versão "pura" deixa de ser atribuível à assinatura que o
 * `addHook` espera. Descrever a forma mínima resolve o atrito e, de
 * quebra, permite testar esta função sem subir um servidor.
 */
interface DocsRequest {
  url: string;
  headers: { authorization?: string | undefined };
}

interface DocsReply {
  code: (status: number) => DocsReply;
  header: (name: string, value: string) => DocsReply;
  send: (payload: unknown) => unknown;
}

/** Compara sem revelar, pelo tempo, quanto do valor estava certo. */
function equalsSecure(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  // `timingSafeEqual` exige tamanhos iguais. Comparar o tamanho antes
  // vaza apenas isso — o comprimento, não o conteúdo.
  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Hook do Fastify que exige Basic Auth nas rotas de documentação.
 *
 * Aplicado a `/docs` e ao JSON do OpenAPI (`/docs-json`): proteger só a
 * página deixaria o contrato inteiro acessível pelo JSON, que é o que
 * uma ferramenta automatizada buscaria primeiro.
 */
export function buildDocsGuard(credentials: DocsCredentials) {
  return function docsGuard(
    request: DocsRequest,
    reply: DocsReply,
    done: (error?: Error) => void,
  ): void {
    const path = request.url.split('?')[0] ?? '';

    if (path !== '/docs' && !path.startsWith('/docs/') && !path.startsWith('/docs-json')) {
      done();
      return;
    }

    const header = request.headers.authorization ?? '';

    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      // A senha pode conter ":" — só o PRIMEIRO separa usuário de senha.
      const separator = decoded.indexOf(':');
      const user = separator === -1 ? decoded : decoded.slice(0, separator);
      const password = separator === -1 ? '' : decoded.slice(separator + 1);

      // Os dois são verificados sempre, sem curto-circuito: sair antes
      // ao errar o usuário revelaria, pelo tempo, que ele existe.
      const userOk = equalsSecure(user, credentials.user);
      const passwordOk = equalsSecure(password, credentials.password);

      if (userOk && passwordOk) {
        done();
        return;
      }
    }

    // Realm só com ASCII: cabeçalho HTTP não aceita acento, e o Node
    // derruba a resposta com ERR_INVALID_CHAR — o usuário receberia 500
    // no lugar do 401 que pede a senha.
    void reply
      .code(401)
      .header('www-authenticate', 'Basic realm="Atlas API docs", charset="UTF-8"')
      .send({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Documentação protegida' },
        meta: { timestamp: new Date().toISOString() },
      });
  };
}
