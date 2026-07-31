/**
 * Entrypoint que a Vercel enxerga.
 *
 * A plataforma transforma cada arquivo em `api/` numa função. Este é um
 * repasse deliberadamente burro para `dist/serverless.js`, e a razão é
 * o build: o código de verdade é TypeScript que importa os pacotes do
 * workspace (`@atlas/shared`, `@atlas/database`, …), e quem sabe montar
 * isso é o `nest build`, no `buildCommand`. Deixar o TypeScript aqui
 * faria a Vercel compilar este arquivo com o compilador dela, sem o
 * `tsconfig` do projeto e sem os pacotes construídos.
 *
 * O `vercel.json` ao lado manda TODA rota para cá — o Nest é que decide
 * o roteamento, como faz quando escuta uma porta.
 */

module.exports = require('../dist/serverless.js').default;
