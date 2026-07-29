/**
 * Reconhece um erro do Zod SEM usar `instanceof`.
 *
 * `instanceof ZodError` compara com a classe do `zod` que ESTE arquivo
 * importou. Num monorepo, o schema que lançou o erro vem de
 * `@atlas/validation`, que pode ter carregado outra instância do mesmo
 * pacote — a build CommonJS enquanto a API carregou a ESM, por exemplo.
 * As duas classes são idênticas em comportamento e diferentes em
 * identidade, e o `instanceof` devolve `false`.
 *
 * O sintoma é péssimo: um CPF inválido, que deveria virar 422 com a
 * lista de campos, vira 500 "erro interno" — o cliente não sabe o que
 * corrigir e o log aponta para o lugar errado.
 *
 * A checagem estrutural não depende de identidade de classe.
 */

export interface ZodLikeIssue {
  path: Array<string | number>;
  message: string;
}

export interface ZodLikeError {
  name: string;
  issues: ZodLikeIssue[];
}

export function isZodError(error: unknown): error is ZodLikeError {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as Partial<ZodLikeError>;

  return (
    candidate.name === 'ZodError' &&
    Array.isArray(candidate.issues) &&
    candidate.issues.every(
      (issue) => Array.isArray(issue?.path) && typeof issue?.message === 'string',
    )
  );
}
