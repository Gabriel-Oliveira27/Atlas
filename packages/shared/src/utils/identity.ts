/**
 * Identificadores brasileiros de login — CPF e telefone.
 *
 * O Atlas aceita três identificadores para a mesma conta: e-mail, CPF
 * e telefone. Para que "123.456.789-09" e "12345678909" sejam a MESMA
 * conta, cada identificador tem uma forma canônica que é o que vai
 * para o banco; a formatação bonita é responsabilidade da UI.
 *
 * Funções puras, sem dependência de servidor: o mesmo código valida o
 * formulário no front antes de gastar uma requisição.
 */

/** Tipo de identificador que o usuário digitou na tela de login. */
export const LOGIN_IDENTIFIER = {
  EMAIL: 'EMAIL',
  CPF: 'CPF',
  PHONE: 'PHONE',
} as const;

export type LoginIdentifierType = (typeof LOGIN_IDENTIFIER)[keyof typeof LOGIN_IDENTIFIER];

/** Remove tudo que não for dígito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Forma canônica do CPF: 11 dígitos, sem pontuação.
 * Devolve `null` quando não há 11 dígitos.
 */
export function normalizeCpf(value: string): string | null {
  const digits = onlyDigits(value);
  return digits.length === 11 ? digits : null;
}

/**
 * Valida CPF pelos dois dígitos verificadores (módulo 11).
 *
 * Sequências de dígito único ("111.111.111-11") passam no cálculo mas
 * não são CPFs válidos — são rejeitadas explicitamente. Sem isso,
 * "00000000000" seria aceito como cadastro.
 */
export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);
  if (!cpf) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const checkDigit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return checkDigit(9) === Number(cpf[9]) && checkDigit(10) === Number(cpf[10]);
}

/** Formata para exibição: 000.000.000-00. Devolve a entrada se não for válida. */
export function formatCpf(value: string): string {
  const cpf = normalizeCpf(value);
  if (!cpf) return value;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/**
 * Forma canônica do telefone: E.164 com DDI do Brasil (+55DDNNNNNNNNN).
 *
 * Guardar em E.164 evita que "(11) 98888-7777", "11988887777" e
 * "+5511988887777" virem três contas diferentes — e é o formato que
 * qualquer gateway de SMS espera no dia em que houver verificação.
 *
 * Aceita apenas números brasileiros: 10 dígitos (fixo) ou 11 (celular,
 * que sempre começa com 9 após o DDD). DDD válido vai de 11 a 99.
 */
export function normalizePhone(value: string): string | null {
  let digits = onlyDigits(value);

  // Tolera o zero de operadora e o DDI já digitado.
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);

  if (digits.length !== 10 && digits.length !== 11) return null;

  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;

  const subscriber = digits.slice(2);
  // Celular tem 9 dígitos e começa com 9; fixo tem 8 e começa de 2 a 5.
  if (subscriber.length === 9 && !subscriber.startsWith('9')) return null;
  if (subscriber.length === 8 && !/^[2-5]/.test(subscriber)) return null;

  return `+55${digits}`;
}

export function isValidPhone(value: string): boolean {
  return normalizePhone(value) !== null;
}

/** Formata para exibição: (11) 98888-7777. Devolve a entrada se não for válida. */
export function formatPhone(value: string): string {
  const phone = normalizePhone(value);
  if (!phone) return value;

  const digits = phone.slice(3);
  const ddd = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  const split = subscriber.length === 9 ? 5 : 4;

  return `(${ddd}) ${subscriber.slice(0, split)}-${subscriber.slice(split)}`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ResolvedIdentifier {
  type: LoginIdentifierType;
  /** Valor canônico, pronto para consulta no banco. */
  value: string;
}

/**
 * Descobre o que o usuário digitou no campo único de login.
 *
 * A ordem importa: e-mail é decidido pela presença de "@", o resto é
 * numérico. Onze dígitos podem ser CPF **ou** celular com DDD — quando
 * os dígitos verificadores fecham, tratamos como CPF; senão, tentamos
 * telefone. Um CPF válido nunca colide com um celular válido porque o
 * celular exige o nono dígito 9 logo após o DDD, e o CPF só passaria
 * nessa forma por coincidência dos verificadores — caso em que a busca
 * por CPF simplesmente não acha ninguém e a de telefone é tentada.
 *
 * Devolve `null` quando não é nenhum dos três.
 */
export function resolveLoginIdentifier(raw: string): ResolvedIdentifier | null {
  const input = raw.trim();
  if (!input) return null;

  if (input.includes('@')) {
    const email = input.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { type: LOGIN_IDENTIFIER.EMAIL, value: email } : null;
  }

  if (isValidCpf(input)) {
    return { type: LOGIN_IDENTIFIER.CPF, value: normalizeCpf(input) as string };
  }

  const phone = normalizePhone(input);
  if (phone) return { type: LOGIN_IDENTIFIER.PHONE, value: phone };

  return null;
}

/**
 * Todas as leituras possíveis do que foi digitado.
 *
 * O login usa isto em vez de `resolveLoginIdentifier` para o caso raro
 * em que 11 dígitos são um CPF válido E um celular plausível: a
 * consulta busca por qualquer uma das formas e o usuário não precisa
 * saber dessa ambiguidade.
 */
export function candidateIdentifiers(raw: string): ResolvedIdentifier[] {
  const input = raw.trim();
  if (!input) return [];

  if (input.includes('@')) {
    const email = input.toLowerCase();
    return EMAIL_PATTERN.test(email) ? [{ type: LOGIN_IDENTIFIER.EMAIL, value: email }] : [];
  }

  const candidates: ResolvedIdentifier[] = [];

  const cpf = normalizeCpf(input);
  if (cpf && isValidCpf(cpf)) candidates.push({ type: LOGIN_IDENTIFIER.CPF, value: cpf });

  const phone = normalizePhone(input);
  if (phone) candidates.push({ type: LOGIN_IDENTIFIER.PHONE, value: phone });

  return candidates;
}
