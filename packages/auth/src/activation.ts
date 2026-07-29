/**
 * Código de ativação do primeiro acesso.
 *
 * Uma conta criada pela academia (ou pelo seed) nasce sem senha. Quem
 * define a senha precisa provar que é o dono — e saber o CPF não prova
 * nada: CPF circula em vazamento, boleto e cadastro de farmácia.
 *
 * O código é curto o suficiente para ser lido em voz alta no balcão e
 * longo o suficiente para não ser adivinhado: 8 caracteres de um
 * alfabeto de 32 dão ~40 bits. Combinado com o rate limit de 10/min nas
 * rotas de auth, tentar todos levaria séculos.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Alfabeto sem os caracteres que as pessoas confundem ao transcrever:
 * O/0, I/1, L. Um código ditado por telefone precisa sobreviver ao
 * telefone.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Validade padrão: 7 dias. Tempo de sobra para o aluno instalar o app. */
export const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ActivationCode {
  /** Valor em claro — mostrado UMA vez a quem entrega. Não é persistido. */
  code: string;
  /** O que vai para o banco. */
  hash: string;
  expiresAt: Date;
}

/**
 * Gera um código novo.
 *
 * `randomInt` do `node:crypto`, não `Math.random()`: um código de
 * ativação previsível é o mesmo que não ter código.
 */
export function generateActivationCode(ttlMs: number = ACTIVATION_TTL_MS): ActivationCode {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return {
    code,
    hash: hashActivationCode(code),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

/**
 * Hash do código para armazenamento.
 *
 * SHA-256 basta — o código é aleatório e de alta entropia, então não é
 * força-bruteável como uma senha escolhida por humano. Mesmo raciocínio
 * do refresh token (ver `tokens.ts`).
 */
export function hashActivationCode(code: string): string {
  return createHash('sha256').update(normalizeActivationCode(code)).digest('hex');
}

/** Aceita o código como a pessoa digitou: minúsculo, com espaço ou hífen. */
export function normalizeActivationCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Compara em tempo constante.
 *
 * `===` sai no primeiro caractere diferente, e essa diferença de tempo
 * é mensurável — dá para descobrir o código caractere a caractere.
 */
export function verifyActivationCode(code: string, storedHash: string | null): boolean {
  if (!storedHash) return false;

  const candidate = Buffer.from(hashActivationCode(code), 'hex');
  const expected = Buffer.from(storedHash, 'hex');

  if (candidate.length !== expected.length) return false;

  return timingSafeEqual(candidate, expected);
}

/** Formata para exibição/entrega: `ABCD-2345`. */
export function formatActivationCode(code: string): string {
  const clean = normalizeActivationCode(code);
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}
