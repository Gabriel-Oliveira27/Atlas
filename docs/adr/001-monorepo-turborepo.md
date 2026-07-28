# ADR 001 — Monorepo com Turborepo e pnpm

**Status:** aceito
**Data:** 2026-07-27

## Contexto

O Atlas tem quatro aplicações (API, web, mobile, admin) que compartilham
tipos, regras de validação e contratos. Em repositórios separados, cada
mudança de contrato exigiria publicar pacote e atualizar consumidores —
com janelas em que web e API discordam sobre o formato de uma resposta.

## Decisão

**Monorepo com Turborepo + pnpm workspaces.**

### Por que pnpm

- **Sem hoisting fantasma.** npm e Yarn clássico achatam `node_modules`,
  então um package consegue importar algo que nunca declarou — funciona
  em desenvolvimento e quebra no build isolado. O pnpm só expõe o que
  foi declarado, e o erro aparece na hora certa.
- **Store content-addressable.** Cada versão de dependência é armazenada
  uma vez no disco e ligada por hardlink. Com 4 apps e 7 packages, a
  economia é significativa.
- **Padrão do ecossistema Turborepo**, o que reduz atrito com exemplos e
  ferramentas.

### Por que Turborepo

- **Cache incremental por tarefa.** Só reconstrói o que mudou e o que
  depende disso.
- **Grafo de dependências explícito** (`dependsOn: ["^build"]`) — um
  package sempre é construído antes de quem o consome.
- **Execução paralela** de tarefas independentes.

## Consequências

**Positivas**

- Alterar um contrato em `@atlas/shared` quebra o typecheck de quem o usa
  **imediatamente**, no mesmo commit — não semanas depois.
- Um único `pnpm install` prepara todo o ambiente.
- CI roda lint, tipos, testes e build com quatro comandos.

**Negativas**

- Instalação inicial mais demorada (todas as dependências de uma vez).
- Exige atenção a dependências circulares entre packages.
- Ferramentas que assumem `node_modules` achatado (algumas do ecossistema
  React Native) podem precisar de ajuste — daí as `public-hoist-pattern`
  no `.npmrc`.

**Ajuste específico registrado**

- O Prisma gera tipos dentro de `packages/database/node_modules`. Com o
  isolamento do pnpm, o TypeScript não consegue "nomear" esses tipos a
  partir de outro package (erro TS2742). A solução adotada foi **anotar
  explicitamente o retorno** dos métodos afetados — o que também é boa
  prática de API pública.
