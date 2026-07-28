# ADR 007 — Aplicativo Android em repositório separado

**Status:** aceito
**Data:** 2026-07-27
**Substitui parcialmente:** [ADR 001](001-monorepo-turborepo.md) (quanto ao app)

## Contexto

Na entrega inicial, o app ficava em `apps/mobile`, dentro do monorepo.
A decisão foi revista para seguir o padrão já usado em outros projetos da
casa (kronos): **repo principal com web + API, e o app como repositório
próprio dentro de uma pasta ignorada**.

Os motivos que sustentam a mudança:

- **Ciclos de release incompatíveis.** A web publica na Vercel a cada
  merge; o app publica APK/Play Store em janelas próprias. Versionados
  juntos, uma mudança de CSS geraria ruído no histórico do app — e a
  recíproca também.
- **Toolchain desproporcional.** Expo, EAS e Android SDK só interessam ao
  app. Quem mexe na API não deveria instalá-los para rodar `pnpm install`.
- **Histórico e issues próprios.** `git log` e o rastreamento de bugs do
  app ficam sobre o app.

## Decisão

```
atlas/                    repo principal (web + api + admin + packages)
└── apk/                  ignorado pelo .gitignore do principal
    ├── atlas-app/        repositório git próprio (Expo)
    └── versions/         APKs gerados, por versão
```

O app fica **fisicamente dentro** de `apk/` — mas fora do git do
principal. Assim os dois ficam lado a lado na mesma máquina, o que
viabiliza a sincronização de contratos descrita abaixo, sem que os
históricos se misturem.

### O problema decorrente: contratos compartilhados

Fora do workspace pnpm, o app perde `@atlas/shared` e `@atlas/validation`
via `workspace:*`. Três saídas foram avaliadas:

| Alternativa                      | Por que não / por que sim                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publicar em registry privado     | Resolve bem, mas exige montar e manter registry, versionar e publicar a cada mudança de contrato — peso operacional alto para dois consumidores.           |
| Reescrever os tipos à mão no app | É a duplicação que a arquitetura foi feita para evitar. Diverge em semanas e produz exatamente o bug de "app e API discordam sobre o formato da resposta". |
| Submódulo git                    | Funciona, mas submódulo é notoriamente fácil de esquecer de atualizar, e a experiência de clone piora.                                                     |
| **Cópia por script** ← escolhida | Fonte da verdade única no principal, cópia versionada no app.                                                                                              |

`npm run sync:contracts` copia `packages/shared/src` e
`packages/validation/src` para `src/contracts/`, com cabeçalho de
"arquivo gerado". O modo `--check` falha quando há divergência — serve
para o CI do app.

## Consequências

**Positivas**

- Release do app independente do da web.
- Clone do repo principal não arrasta a toolchain do Expo.
- O app compila sozinho: `src/contracts/` é versionado, então não exige o
  repo principal presente para buildar no EAS.
- Uma fonte da verdade preservada, sem registry.

**Negativas**

- **A cópia pode ficar velha.** Mitigado pelo `--check` no CI do app,
  mas exige a disciplina de rodar o sync ao mudar contratos.
- Dois `git push` quando uma mudança atravessa os dois lados.
- Os contratos aparecem duplicados no disco (uma vez em `packages/`,
  outra em `src/contracts/`) — aceitável, já que uma delas é claramente
  marcada como gerada.

**Neutras**

- `apps/` no principal passa a ter apenas web, admin e api.
- A pasta `apk/versions/` não é versionada: APKs são grandes e
  reconstruíveis.

## Quando reconsiderar

Se um terceiro consumidor dos contratos aparecer (um segundo app, um SDK
público, integração de parceiro), o custo de manter cópias passa a
superar o de publicar em registry. Nesse ponto, publicar `@atlas/shared`
e `@atlas/validation` como pacotes versionados vira a opção correta — e o
script de sync é descartado.
