/**
 * Hash de senha — preparado para o login por e-mail que a
 * especificação pede como evolução futura. O MVP usa Google OAuth.
 *
 * Escolha do bcryptjs (JS puro) em vez de argon2/bcrypt nativos:
 * o projeto roda em Windows e o build nativo trava a instalação com
 * frequência. O custo 12 dá margem adequada; quando o login por
 * e-mail for de fato habilitado, vale reavaliar para argon2id.
 */

import bcrypt from 'bcryptjs';

/** Fator de custo: 2^12 iterações (~250 ms em hardware atual). */
const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  if (plainPassword.length < 8) {
    throw new Error('A senha deve ter pelo menos 8 caracteres');
  }
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compara senha com hash.
 *
 * Devolve `false` em vez de lançar quando o hash é inválido/ausente:
 * assim a rota de login segue o mesmo caminho de "credencial errada"
 * e não vaza, pelo tempo de resposta, se a conta existe.
 */
export async function verifyPassword(plainPassword: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plainPassword, hash);
  } catch {
    return false;
  }
}

/** true se o hash foi gerado com custo menor que o atual (rehash na próxima autenticação). */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < SALT_ROUNDS;
  } catch {
    return true;
  }
}
