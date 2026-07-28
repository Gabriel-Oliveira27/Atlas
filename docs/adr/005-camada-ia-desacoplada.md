# ADR 005 — Camada de IA agnóstica de provedor

**Status:** aceito
**Data:** 2026-07-27

## Contexto

A especificação pede integração com Claude, OpenAI e Gemini, **sem
acoplamento ao restante do sistema**. O cenário de IA muda rápido:
modelos são descontinuados, preços mudam, um provedor sai do ar.

## Decisão

`packages/ai` implementa **Strategy + Factory** e **não conhece o Atlas**.

```
AiProvider (interface)
  ├── ClaudeProvider   (SDK oficial @anthropic-ai/sdk)
  ├── OpenAiProvider   (fetch → Chat Completions)
  └── GeminiProvider   (fetch → generateContent)

createAiProvider(config, providerId?) → AiProvider
```

A regra que garante o desacoplamento: **o package recebe mensagens e
devolve texto**. Ele não sabe o que é treino, série ou hidratação. Toda
a tradução entre domínio e modelo acontece em dois lugares:

- `packages/ai/src/prompts/` — templates que convertem dados em texto
- `apps/api/src/modules/ai/ai.service.ts` — reúne os dados do domínio

Consequência prática: remover a IA do produto significa não chamar
`AiService`. Nenhum módulo de negócio muda.

## Detalhes que a implementação precisa respeitar

Registrados porque são fonte comum de erro em produção:

1. **Os modelos Claude atuais rejeitam `temperature`/`top_p`/`top_k`**
   (erro 400). O contrato genérico do Atlas tem `temperature`, mas o
   `ClaudeProvider` o ignora nos modelos atuais, aplicando-o apenas nos
   que ainda aceitam.
2. **Recusa chega como HTTP 200**, com `stop_reason: "refusal"`. Ler
   `content[0]` sem checar antes quebra a aplicação — o provider valida
   o `stop_reason` primeiro.
3. **`fallbacks: "default"`** está habilitado: se os classificadores
   recusarem, a Anthropic reexecuta em um modelo alternativo do lado do
   servidor, em vez de devolver erro ao usuário.
4. **A saída é validada com Zod** (`weeklyReportPayloadSchema`). Sem
   isso, uma resposta fora do formato quebraria a geração do PDF sem
   mensagem clara.

## Consequências

**Positivas**

- Trocar de provedor é mudar `AI_PROVIDER` no `.env`.
- Testar o domínio não exige chave de API nem chamadas de rede.
- Custo e latência auditáveis: toda chamada grava um `AiJob`.
- `AI_ENABLED=false` desliga a IA sem quebrar nada.

**Negativas**

- A interface é o mínimo denominador comum: recursos exclusivos de um
  provedor (extended thinking, tool use nativo) não são expostos. Se um
  deles se tornar essencial, a interface precisará crescer.
- Prompts são específicos por tarefa e podem render diferente em cada
  modelo — trocar de provedor pede reavaliação da qualidade da saída.

**Neutras**

- Claude usa o SDK oficial; OpenAI e Gemini usam `fetch` direto, já que
  a superfície utilizada é uma única rota em cada um. Se o uso crescer,
  vale migrar para os SDKs oficiais.
