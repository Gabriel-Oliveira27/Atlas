/**
 * Tipo `Result` — erros esperados como valor, em vez de exceção.
 *
 * Usado onde a falha é parte do fluxo normal e o chamador precisa
 * decidir o que fazer (ex.: resolução de conflito na sincronização,
 * chamada a provedor de IA). Exceções seguem valendo para falhas
 * realmente excepcionais.
 */

export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

/** Aplica `fn` ao valor de sucesso, preservando o erro. */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Extrai o valor ou devolve o padrão informado. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Executa uma função assíncrona capturando exceções como `Result`. */
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
