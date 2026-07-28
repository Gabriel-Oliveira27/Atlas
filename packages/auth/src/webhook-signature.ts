/**
 * Assinatura HMAC dos webhooks trocados com o n8n.
 *
 * O n8n executa análises de IA e devolve resultados por webhook. Sem
 * assinatura, qualquer um que alcance a API poderia injetar um
 * "relatório semanal" falso. O segredo compartilhado é o
 * `N8N_WEBHOOK_SECRET`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assina o corpo do webhook.
 * Formato: `t=<timestamp>,v1=<hmac hex>` (inspirado no Stripe).
 */
export function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp: number = Date.now(),
): string {
  const signature = computeSignature(payload, secret, timestamp);
  return `t=${timestamp},v1=${signature}`;
}

export interface VerifyWebhookOptions {
  /**
   * Janela de tolerância, em ms. Assinaturas antigas são rejeitadas
   * para limitar replay de uma requisição capturada. Padrão: 5 min.
   */
  toleranceMs?: number;
  now?: number;
}

export function verifyWebhookSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  options: VerifyWebhookOptions = {},
): boolean {
  if (!header) return false;

  const toleranceMs = options.toleranceMs ?? 5 * 60 * 1000;
  const now = options.now ?? Date.now();

  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  if (Math.abs(now - parsed.timestamp) > toleranceMs) return false;

  const expected = computeSignature(payload, secret, parsed.timestamp);

  // Comparação em tempo constante evita vazar o segredo por timing.
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(parsed.signature, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function computeSignature(payload: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = header.split(',');
  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't' && value) timestamp = Number(value);
    if (key === 'v1' && value) signature = value;
  }

  if (timestamp === null || Number.isNaN(timestamp) || !signature) return null;
  return { timestamp, signature };
}
