import { describe, expect, it } from 'vitest';
import { normalizeApiBaseUrl } from './api-url.js';

describe('normalizeApiBaseUrl', () => {
  it('acrescenta o prefixo quando apontam para o host — o caso que quebrou o login', () => {
    // 31/07/2026: NEXT_PUBLIC_API_FALLBACK_URL estava assim, e a API
    // respondia "Cannot POST /auth/login" enquanto o health check ia bem.
    expect(normalizeApiBaseUrl('https://atlas-api-reserva.onrender.com')).toBe(
      'https://atlas-api-reserva.onrender.com/api',
    );
  });

  it('trata a barra final como raiz', () => {
    expect(normalizeApiBaseUrl('https://atlas-api-reserva.onrender.com/')).toBe(
      'https://atlas-api-reserva.onrender.com/api',
    );
  });

  it('deixa em paz quem já trouxe o prefixo', () => {
    expect(normalizeApiBaseUrl('https://atlas-api-reserva.onrender.com/api')).toBe(
      'https://atlas-api-reserva.onrender.com/api',
    );
  });

  it('remove a barra final para não gerar caminho com barra dupla', () => {
    expect(normalizeApiBaseUrl('https://atlas-api-reserva.onrender.com/api/')).toBe(
      'https://atlas-api-reserva.onrender.com/api',
    );
  });

  it('respeita um caminho próprio — quem publicou sob outro prefixo sabe mais', () => {
    expect(normalizeApiBaseUrl('https://exemplo.com/v2')).toBe('https://exemplo.com/v2');
  });

  it('funciona com host e porta da rede local, que é o caso do app', () => {
    expect(normalizeApiBaseUrl('http://192.168.1.5:3333')).toBe('http://192.168.1.5:3333/api');
    expect(normalizeApiBaseUrl('http://192.168.1.5:3333/api')).toBe('http://192.168.1.5:3333/api');
  });

  it('devolve vazio para vazio, para o chamador decidir que não há reserva', () => {
    expect(normalizeApiBaseUrl('')).toBe('');
    expect(normalizeApiBaseUrl('   ')).toBe('');
  });

  it('não inventa prefixo em caminho relativo', () => {
    // Um proxy no próprio site serve a API em "/api" — já está certo, e
    // não dá para saber se "/qualquer-coisa" quis dizer host ou caminho.
    expect(normalizeApiBaseUrl('/api')).toBe('/api');
  });
});
