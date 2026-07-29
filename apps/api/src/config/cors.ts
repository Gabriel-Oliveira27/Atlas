/**
 * Decisão de CORS da API.
 *
 * Uma lista fixa de origens não cobre dois casos reais deste projeto:
 *
 *  • **Preview da Vercel.** Cada branch ganha um domínio novo
 *    (`atlas-git-minha-branch-conta.vercel.app`). Sem curinga, cada
 *    deploy exigiria editar a variável de ambiente e reiniciar a API.
 *
 *  • **Túnel para desenvolvimento.** O `cloudflared` sorteia um
 *    subdomínio a cada execução. Fixar a origem obrigaria a reconfigurar
 *    tudo toda vez que o túnel caísse.
 *
 * Daí o suporte a curinga — restrito ao RÓTULO do host, nunca ao
 * domínio inteiro: `https://*.vercel.app` casa com
 * `https://atlas.vercel.app` e **não** casa com
 * `https://vercel.app.invasor.com`, que é o ataque óbvio contra
 * comparação por `String.startsWith`.
 */

export interface CorsDecisionOptions {
  /**
   * Libera origens da rede local (192.168.x, 10.x, 172.16–31.x,
   * localhost). É o que permite abrir o web pelo celular no mesmo
   * Wi-Fi. Deve ficar DESLIGADO em produção: num servidor, uma origem
   * "privada" não é o seu notebook, é outra máquina do datacenter.
   */
  allowPrivateNetwork: boolean;
}

export type CorsOriginResolver = (
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) => void;

/** Blocos privados do IPv4 (RFC 1918) mais o loopback. */
function isPrivateHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
  if (hostname === '::1' || hostname === '[::1]') return true;

  const parts = hostname.split('.');
  if (parts.length !== 4) return false;

  const octets = parts.map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;

  const [first, second] = octets as [number, number, number, number];

  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;

  return false;
}

/**
 * Compara host contra um padrão que pode conter `*` em qualquer rótulo.
 * O curinga cobre UM rótulo — `*.vercel.app` não casa com
 * `a.b.vercel.app`, que é o comportamento esperado de um certificado.
 */
function hostMatches(host: string, pattern: string): boolean {
  const hostLabels = host.split('.');
  const patternLabels = pattern.split('.');

  if (hostLabels.length !== patternLabels.length) return false;

  return patternLabels.every(
    (label, index) => label === '*' || label.toLowerCase() === hostLabels[index]?.toLowerCase(),
  );
}

/** `true` quando a origem satisfaz um dos padrões configurados. */
export function isOriginAllowed(
  origin: string,
  patterns: string[],
  options: CorsDecisionOptions,
): boolean {
  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    // Origem ilegível não é "sem origem": é requisição malformada.
    return false;
  }

  if (options.allowPrivateNetwork && isPrivateHostname(parsed.hostname)) {
    return true;
  }

  return patterns.some((pattern) => {
    if (pattern === '*') return true;

    let expected: URL;
    try {
      expected = new URL(pattern);
    } catch {
      return false;
    }

    // Protocolo e porta precisam bater: http e https são origens
    // distintas, e é essa distinção que impede um proxy em texto claro
    // de se passar pelo site publicado.
    if (expected.protocol !== parsed.protocol) return false;
    if (expected.port !== parsed.port) return false;

    return hostMatches(parsed.hostname, expected.hostname);
  });
}

/**
 * Monta o resolvedor que o Nest chama a cada requisição.
 *
 * Requisição SEM `Origin` é liberada: é o caso do aplicativo Android,
 * do `curl` e das verificações de saúde. CORS é uma proteção do
 * NAVEGADOR contra uma página maliciosa usar a sessão do usuário —
 * um cliente nativo nem envia o cabeçalho, e recusá-lo aqui só
 * quebraria o app sem impedir ataque nenhum.
 */
export function buildCorsOrigin(
  patterns: string[],
  options: CorsDecisionOptions,
): CorsOriginResolver {
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    callback(null, isOriginAllowed(origin, patterns, options));
  };
}
