-- Agente de adaptação de exercício.
--
-- Registra o novo tipo de tarefa de IA para que cada adaptação vire um
-- `AiJob` auditável, como as demais (custo e latência por chamada).
--
-- `ADD VALUE` é aditivo e não reescreve linha nenhuma: nenhum valor
-- existente muda, e uma API antiga continua funcionando depois desta
-- migration — ela só não sabe produzir o valor novo. Por isso é seguro
-- aplicar antes de publicar o código que o usa.
ALTER TYPE "AiTaskType" ADD VALUE IF NOT EXISTS 'EXERCISE_ADAPTATION';
