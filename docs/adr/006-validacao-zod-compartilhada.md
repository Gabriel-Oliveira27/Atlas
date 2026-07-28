# ADR 006 — Validação com Zod compartilhada entre back-end e front-end

**Status:** aceito
**Data:** 2026-07-27

## Contexto

O padrão do NestJS é `class-validator` com decorators nos DTOs. O
front-end, por sua vez, tipicamente valida formulários com outra
biblioteca. Resultado: **a mesma regra escrita duas vezes**, em lugares
diferentes, que divergem com o tempo.

Exemplo concreto do Atlas: "o registro de hidratação aceita de 10 ml a
5000 ml". Se o formulário aceitar 8000 e a API recusar, o usuário digita,
envia e só então recebe o erro — depois de perder o que escreveu.

## Decisão

**Schemas Zod em `@atlas/validation`, usados pelos dois lados.**

- **API:** `ZodValidationPipe` aplica o schema no corpo/query.
- **Front-end:** o mesmo schema alimenta `react-hook-form` via
  `zodResolver`.
- **Tipos:** `z.infer<typeof schema>` gera o tipo TypeScript — não há
  interface escrita à mão para sair de sincronia.

O schema de ambiente (`envSchema`) segue o mesmo princípio: valida
`process.env` no boot e falha imediatamente, com a lista completa do que
está faltando, em vez de quebrar mais tarde em produção.

## Consequências

**Positivas**

- Uma regra, um lugar. Mudar o limite de hidratação altera os dois lados.
- Validação imediata no formulário, sem ida ao servidor.
- Tipos derivados do schema: impossível o tipo discordar da validação.
- Regras compostas ficam legíveis (`.refine()` para "data inicial antes
  da final", por exemplo).

**Negativas**

- Foge da convenção do Nest; quem chega esperando `class-validator`
  precisa se ambientar.
- O Swagger não infere o corpo a partir do Zod automaticamente — a
  documentação usa `@ApiOperation` descritivo. (Adicionar
  `nestjs-zod` resolveria; ficou fora desta fase por não ser bloqueante.)

**Neutras**

- `@atlas/validation` depende de `@atlas/shared` (para constantes como
  limites de paginação), nunca o contrário.
