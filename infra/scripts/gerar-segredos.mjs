#!/usr/bin/env node
/**
 * Gera os segredos aleatórios que a API exige em produção.
 *
 *   node infra/scripts/gerar-segredos.mjs
 *
 * ── O que NÃO é ─────────────────────────────────────────────────────
 * Não é "hash". Um hash resume algo que já existe (uma senha, um
 * arquivo). Aqui o que se quer é o contrário: bytes que ninguém
 * consegue prever. Por isso `randomBytes`, do gerador criptográfico do
 * sistema operacional — e nunca `Math.random()`, que é previsível a
 * partir de algumas amostras.
 *
 * As SENHAS dos usuários são a outra ponta e não aparecem aqui: elas
 * viram hash com bcrypt custo 12 dentro da API, no cadastro. Nada de
 * senha de usuário passa por este arquivo.
 *
 * ── Por que 64 caracteres hex ───────────────────────────────────────
 * 32 bytes = 256 bits, o tamanho da chave de HMAC-SHA256 que assina os
 * JWT. Mais que isso não aumenta a segurança (o algoritmo reduz a
 * chave internamente); menos, reduz.
 */

import { randomBytes } from 'node:crypto';

/** Hex em vez de base64: sobrevive a `.env`, YAML e painéis web sem escape. */
function segredo(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

const SEGREDOS = [
  {
    chave: 'JWT_ACCESS_SECRET',
    valor: segredo(),
    nota: 'Assina o token de acesso (15 min).',
  },
  {
    chave: 'JWT_REFRESH_SECRET',
    valor: segredo(),
    nota: 'Assina o refresh (30 dias). PRECISA ser diferente do de cima — se forem iguais, um access token roubado vale como refresh.',
  },
  {
    chave: 'N8N_WEBHOOK_SECRET',
    valor: segredo(),
    nota: 'HMAC dos webhooks do n8n. O MESMO valor vai no n8n; se divergir, a API responde 401 e o sintoma é silencioso.',
  },
];

console.info('\n' + '═'.repeat(68));
console.info('  Segredos para produção — gerados agora, únicos desta execução');
console.info('═'.repeat(68) + '\n');

for (const { chave, valor, nota } of SEGREDOS) {
  console.info(`${chave}=${valor}`);
  console.info(`  ↳ ${nota}\n`);
}

console.info('─'.repeat(68));
console.info(`
  Onde colocar
    • API hospedada  → painel do provedor, em variáveis de ambiente
    • Local          → .env na raiz (já ignorado pelo git)

  O que NÃO fazer
    • Reaproveitar os segredos de desenvolvimento. A API recusa subir em
      produção se encontrar "dev-only" ou "troque" neles — de propósito.
    • Commitar. O .env está no .gitignore; mantenha assim.
    • Reutilizar o mesmo valor em dois campos.

  Ao trocar os segredos JWT, toda sessão ativa cai: os tokens em
  circulação foram assinados com a chave antiga. É esperado — e é
  exatamente o que se quer se um segredo vazou.
`);
console.info('─'.repeat(68) + '\n');
