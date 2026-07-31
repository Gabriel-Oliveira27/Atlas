/**
 * Normalização do endereço base da API.
 *
 * ── Por que isto existe ─────────────────────────────────────────────
 * A API serve tudo sob o prefixo `/api` (`API_PREFIX`). Quem configura
 * `NEXT_PUBLIC_API_URL` ou `EXPO_PUBLIC_API_URL` com o endereço "do
 * serviço" — `https://atlas-api-reserva.onrender.com` — monta URLs sem
 * o prefixo, e TODA chamada vira 404:
 *
 *     Cannot POST /auth/login
 *     Cannot GET  /auth/providers
 *     Cannot GET  /home
 *
 * Foi exatamente o que aconteceu em 31/07/2026, e o sintoma engana: a
 * API responde 200 no health check o tempo todo (o Render sonda
 * `/api/health/live`, com prefixo), então tudo indica que ela está no
 * ar — e está. Quem erra o endereço é o cliente, e o 404 não diz isso.
 *
 * Barra final também: `.../api/` mais `/auth/login` daria `//auth/login`,
 * que não casa com rota nenhuma.
 *
 * Deixar o valor cru "funcionar quando bem configurado" é jogar num
 * arquivo de ambiente uma regra que o código conhece. Aqui o código
 * assume a regra.
 */

/** Prefixo sob o qual a API serve tudo. Espelha `API_PREFIX` no back-end. */
export const API_PATH_PREFIX = 'api';

/**
 * Devolve o endereço base pronto para concatenar caminhos.
 *
 * - remove barras finais;
 * - acrescenta `/api` quando o endereço aponta para a raiz do host.
 *
 * Um endereço que já traga um caminho é respeitado como está: quem
 * publicou a API sob `/v2` ou atrás de um proxy com outro caminho sabe
 * mais do que esta função.
 */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);

    // Sem caminho (ou só "/") = apontaram para o host. Falta o prefixo.
    if (url.pathname === '' || url.pathname === '/') {
      return `${trimmed}/${API_PATH_PREFIX}`;
    }

    return trimmed;
  } catch {
    // Não é URL absoluta (caminho relativo, como "/api" num proxy do
    // próprio site). Nada a inferir com segurança: devolve sem a barra.
    return trimmed;
  }
}
