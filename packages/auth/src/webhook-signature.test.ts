import { describe, expect, it } from 'vitest';
import { signWebhookPayload, verifyWebhookSignature } from './webhook-signature.js';

const SECRET = 'segredo-de-teste-do-atlas';

describe('assinatura de webhook', () => {
  it('valida uma assinatura gerada com o mesmo segredo', () => {
    const payload = JSON.stringify({ reportId: 'abc123', status: 'COMPLETED' });
    const header = signWebhookPayload(payload, SECRET);

    expect(verifyWebhookSignature(payload, header, SECRET)).toBe(true);
  });

  it('rejeita assinatura feita com outro segredo', () => {
    const payload = '{"ok":true}';
    const header = signWebhookPayload(payload, 'outro-segredo');

    expect(verifyWebhookSignature(payload, header, SECRET)).toBe(false);
  });

  it('rejeita quando o corpo foi adulterado', () => {
    const original = JSON.stringify({ amount: 100 });
    const header = signWebhookPayload(original, SECRET);
    const tampered = JSON.stringify({ amount: 999999 });

    expect(verifyWebhookSignature(tampered, header, SECRET)).toBe(false);
  });

  it('rejeita assinatura antiga (proteção contra replay)', () => {
    const payload = '{"ok":true}';
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const header = signWebhookPayload(payload, SECRET, tenMinutesAgo);

    // Tolerância padrão é de 5 minutos.
    expect(verifyWebhookSignature(payload, header, SECRET)).toBe(false);
  });

  it('aceita assinatura dentro da janela de tolerância', () => {
    const payload = '{"ok":true}';
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const header = signWebhookPayload(payload, SECRET, oneMinuteAgo);

    expect(verifyWebhookSignature(payload, header, SECRET)).toBe(true);
  });

  it('rejeita header ausente ou malformado', () => {
    const payload = '{"ok":true}';

    expect(verifyWebhookSignature(payload, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(payload, 'lixo', SECRET)).toBe(false);
    expect(verifyWebhookSignature(payload, 't=abc,v1=xyz', SECRET)).toBe(false);
    expect(verifyWebhookSignature(payload, 'v1=semtimestamp', SECRET)).toBe(false);
  });
});
