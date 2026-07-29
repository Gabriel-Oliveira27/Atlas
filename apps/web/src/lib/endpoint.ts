/**
 * Escolha do endereço da API: notebook primeiro, hospedada como reserva.
 *
 * ── O problema ──────────────────────────────────────────────────────
 * O back-end principal é o notebook do dono do projeto, exposto por
 * túnel. Ele é rápido (banco na mesma máquina) e é onde os dados nascem
 * — mas desliga. Quando isso acontece, o produto não pode simplesmente
 * parar: existe uma segunda instância hospedada, apontando para o Neon.
 *
 * ── Como decide ─────────────────────────────────────────────────────
 * Uma sondagem em `/health/live` com timeout curto. Se o primário
 * responde, é ele; senão, a reserva. A escolha fica em cache por alguns
 * minutos para não sondar a cada requisição.
 *
 * O timeout é deliberadamente curto (2 s): quando o notebook está
 * desligado, a conexão não é recusada — ela fica pendurada até o TCP
 * desistir, o que leva dezenas de segundos. Sem o corte, o usuário
 * encararia uma tela em branco esse tempo todo antes de a reserva
 * sequer ser tentada.
 *
 * ── O que o usuário precisa saber ───────────────────────────────────
 * As duas instâncias compartilham dados pela sincronização (outbox →
 * Neon), mas a propagação não é instantânea. Quem se cadastra com o
 * notebook ligado e cai para a reserva no minuto seguinte pode não
 * encontrar a conta ainda. Por isso a troca de endereço é anunciada na
 * interface em vez de silenciosa.
 */

const PRIMARY = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';
const FALLBACK = process.env.NEXT_PUBLIC_API_FALLBACK_URL ?? '';

/** Acima disto, considera-se que o primário não está no ar. */
const PROBE_TIMEOUT_MS = 2_000;

/** Quanto tempo a decisão vale antes de sondar de novo. */
const CACHE_TTL_MS = 5 * 60_000;

const STORAGE_KEY = 'atlas.endpoint';

export type EndpointKind = 'primary' | 'fallback';

interface Decision {
  baseUrl: string;
  kind: EndpointKind;
  decidedAt: number;
}

/**
 * Detecta o site publicado apontando para `localhost`.
 *
 * `NEXT_PUBLIC_API_URL` tem `http://localhost:3333/api` como padrão —
 * conveniente em desenvolvimento e enganoso em produção: quando a
 * variável não é definida na Vercel, o site sobe normalmente e cada
 * chamada tenta a máquina de QUEM ABRIU a página. O erro que aparece é
 * "falha de rede", que não sugere configuração faltando.
 *
 * Isto reconhece a situação para a mensagem dizer o que realmente houve.
 */
export function isPointingAtLocalhost(): boolean {
  if (typeof window === 'undefined') return false;

  const paginaLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (paginaLocal) return false;

  const alvo = getBaseUrl();
  return alvo.includes('//localhost') || alvo.includes('//127.0.0.1');
}

let current: Decision | null = null;
let inFlight: Promise<Decision> | null = null;

const listeners = new Set<(kind: EndpointKind) => void>();

export function subscribeEndpoint(listener: (kind: EndpointKind) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(decision: Decision): void {
  for (const listener of listeners) listener(decision.kind);
}

/** Endereço em uso agora, sem sondar. Usado no caminho síncrono. */
export function getBaseUrl(): string {
  return current?.baseUrl ?? PRIMARY;
}

export function getEndpointKind(): EndpointKind {
  return current?.kind ?? 'primary';
}

export function hasFallback(): boolean {
  return FALLBACK !== '' && FALLBACK !== PRIMARY;
}

function restore(): Decision | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const saved = JSON.parse(raw) as Decision;
    // Uma decisão velha pode estar errada: o notebook pode ter voltado.
    if (Date.now() - saved.decidedAt > CACHE_TTL_MS) return null;

    return saved;
  } catch {
    return null;
  }
}

function persist(decision: Decision): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(decision));
  } catch {
    // Modo privado ou storage cheio: a decisão continua valendo em
    // memória, só não sobrevive à recarga da página.
  }
}

async function isAlive(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/health/live`, {
      signal: controller.signal,
      // A sondagem não pode ser servida do cache do navegador: o ponto
      // dela é justamente saber o estado AGORA.
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function decide(): Promise<Decision> {
  if (!hasFallback()) {
    return { baseUrl: PRIMARY, kind: 'primary', decidedAt: Date.now() };
  }

  const primaryAlive = await isAlive(PRIMARY);

  return primaryAlive
    ? { baseUrl: PRIMARY, kind: 'primary', decidedAt: Date.now() }
    : { baseUrl: FALLBACK, kind: 'fallback', decidedAt: Date.now() };
}

/**
 * Garante que existe uma decisão válida.
 *
 * Chamadas concorrentes compartilham a mesma sondagem — cinco telas
 * abrindo juntas não devem gerar cinco requisições de health.
 */
export async function resolveBaseUrl(): Promise<string> {
  if (current && Date.now() - current.decidedAt <= CACHE_TTL_MS) {
    return current.baseUrl;
  }

  const restored = restore();
  if (restored) {
    current = restored;
    return restored.baseUrl;
  }

  inFlight ??= decide().finally(() => {
    inFlight = null;
  });

  const decision = await inFlight;
  const changed = current?.kind !== decision.kind;

  current = decision;
  persist(decision);

  if (changed) announce(decision);

  return decision.baseUrl;
}

/**
 * Invalida a decisão após uma falha de rede.
 *
 * Chamado pelo cliente HTTP quando uma requisição não completa: o
 * endereço escolhido pode ter caído no meio da sessão, e insistir nele
 * até o cache expirar deixaria o app quebrado por minutos.
 */
export function invalidateEndpoint(): void {
  current = null;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Sem storage, basta a limpeza em memória acima.
    }
  }
}
