#!/usr/bin/env node
/**
 * Publica a API local num endereço HTTPS público, por túnel.
 *
 * ── Por que isto é necessário ───────────────────────────────────────
 * O front na Vercel é servido por HTTPS. Um navegador NÃO deixa uma
 * página HTTPS chamar `http://192.168.0.10:3333` — é bloqueio de
 * conteúdo misto, e nenhuma configuração de CORS ou de servidor
 * contorna isso. Também não adianta apontar para o IP da máquina: a
 * Vercel está na internet e a sua máquina, atrás do roteador.
 *
 * O túnel resolve os dois de uma vez: dá um domínio HTTPS válido e
 * alcança a máquina sem abrir porta no roteador.
 *
 * ── Uso ─────────────────────────────────────────────────────────────
 *   node infra/scripts/expose-api.mjs
 *
 * Requer o `cloudflared` instalado:
 *   winget install --id Cloudflare.cloudflared
 *
 * O subdomínio é sorteado a cada execução. Por isso `CORS_ORIGINS` já
 * traz `https://*.trycloudflare.com` — sem o curinga, seria preciso
 * reconfigurar a API toda vez que o túnel caísse.
 *
 * O endereço impresso vai em duas pontas:
 *   • Vercel  → variável NEXT_PUBLIC_API_URL = <url>/api
 *   • Celular → EXPO_PUBLIC_API_URL = <url>/api
 *
 * Para o celular no MESMO Wi-Fi o túnel é dispensável: o app é nativo,
 * não sofre bloqueio de conteúdo misto, e o IP da rede local basta (a
 * API imprime esse IP ao subir).
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const PORT = Number(process.env.API_PORT ?? 3333);

/** O túnel só faz sentido se houver algo escutando do outro lado. */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const probe = createServer();

    probe.once('error', (error) => resolve(error.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, '127.0.0.1');
  });
}

const apiUp = await isPortInUse(PORT);

if (!apiUp) {
  console.error(
    `\n✗ Nada escutando na porta ${PORT}.\n` +
      '  Suba a API antes de abrir o túnel:\n\n' +
      '    pnpm api:dev\n',
  );
  process.exit(1);
}

console.info(`\n▸ Abrindo túnel para http://localhost:${PORT} …\n`);

const tunnel = spawn(
  'cloudflared',
  ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'],
  { shell: true },
);

let announced = false;

/**
 * O cloudflared escreve a URL no stderr, no meio de uma moldura ASCII.
 * Em vez de repassar o ruído, extraímos o endereço e imprimimos as duas
 * variáveis prontas para copiar.
 */
function inspect(chunk) {
  const text = chunk.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);

  if (match && !announced) {
    announced = true;
    const url = match[0];

    console.info('\n' + '─'.repeat(60));
    console.info(`  API pública:  ${url}/api`);
    console.info(`  Saúde:        ${url}/api/health`);
    console.info('─'.repeat(60));
    console.info('\n  Vercel  → NEXT_PUBLIC_API_URL');
    console.info(`            ${url}/api`);
    console.info('\n  Celular → EXPO_PUBLIC_API_URL (.env do app)');
    console.info(`            ${url}/api`);
    console.info('\n  O endereço muda a cada execução. Encerre com Ctrl+C.\n');
  }
}

tunnel.stdout.on('data', inspect);
tunnel.stderr.on('data', inspect);

tunnel.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error(
      '\n✗ `cloudflared` não encontrado.\n\n' +
        '  Instale com:\n' +
        '    winget install --id Cloudflare.cloudflared\n\n' +
        '  Alternativa equivalente: `npx localtunnel --port 3333`.\n' +
        '  Nesse caso acrescente o domínio a CORS_ORIGINS.\n',
    );
    process.exit(1);
  }

  console.error(`\n✗ Falha ao abrir o túnel: ${error.message}\n`);
  process.exit(1);
});

tunnel.on('exit', (code) => process.exit(code ?? 0));

// Ctrl+C deve derrubar o túnel junto, e não deixá-lo órfão.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    tunnel.kill();
    process.exit(0);
  });
}
