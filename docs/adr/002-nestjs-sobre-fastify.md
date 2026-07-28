# ADR 002 — NestJS sobre o adaptador Fastify

**Status:** aceito
**Data:** 2026-07-27

## Contexto

A especificação pedia para escolher entre **NestJS** e **Fastify** e
justificar. A decisão precisa considerar o que o Atlas realmente exige:

- RBAC em duas camadas (papel + permissão) em quase toda rota
- filas (sincronização, IA, notificações)
- agendamento (03:00 e 18:00)
- um motor de sincronização com várias dependências injetadas
- superfície grande: ~10 módulos de domínio
- interceptação transversal: envelope de resposta, auditoria, tratamento de erro

## Alternativas

### Fastify puro

**A favor:** o framework HTTP Node mais rápido; mínimo de abstração;
menos dependências.

**Contra:** não traz injeção de dependência, organização em módulos, nem
um modelo de guards/interceptors. Para o escopo acima, essas peças
seriam construídas à mão — ou seja, escreveríamos uma versão caseira e
pior do que o Nest já oferece, e cada desenvolvedor novo teria de
aprender nossa convenção em vez de uma convenção conhecida.

### NestJS sobre Express (padrão)

**A favor:** o caminho mais comum, mais exemplos.

**Contra:** o Express é sensivelmente mais lento que o Fastify em
throughput, sem que ganhemos nada em troca nesta aplicação.

### NestJS sobre o adaptador Fastify ← **escolhida**

O Nest oferece um adaptador oficial (`@nestjs/platform-fastify`) que
substitui o Express por baixo, mantendo toda a API do Nest.

## Decisão

**NestJS com `FastifyAdapter`.**

A pergunta "Nest ou Fastify" apresenta uma falsa escolha: os dois
resolvem problemas diferentes. O Fastify é uma camada HTTP; o Nest é uma
camada de arquitetura de aplicação. Usá-los juntos entrega:

| Necessidade                        | Resolvido por |
| ---------------------------------- | ------------- |
| Roteamento e serialização rápidos  | Fastify       |
| Injeção de dependência e módulos   | Nest          |
| Guards para RBAC                   | Nest          |
| Interceptors (envelope, auditoria) | Nest          |
| Filas (BullMQ) e agendamento       | Nest          |
| Testabilidade (mocks por DI)       | Nest          |

## Consequências

**Positivas**

- Throughput próximo ao do Fastify puro, com a estrutura do Nest.
- Guards globais permitem a inversão de segurança adotada: **toda rota é
  protegida por padrão**, e abrir uma exige `@Public()` explícito.
- Trocar o adaptador no futuro é uma linha em `main.ts`.

**Negativas**

- Pequeno atrito de tipagem ao registrar plugins Fastify (`@fastify/cookie`
  faz _declaration merging_ em `FastifyInstance`, e o `register` do Nest
  espera o tipo original). Resolvido com um cast documentado em `main.ts`.
- Alguns pacotes do ecossistema Nest assumem Express; ao adicionar um,
  é preciso conferir a compatibilidade com Fastify.

**Neutras**

- Precisamos usar `@fastify/*` em vez dos middlewares de Express
  equivalentes (`@fastify/helmet` no lugar de `helmet`, etc.).
