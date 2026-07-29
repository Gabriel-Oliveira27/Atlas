import { describe, expect, it } from 'vitest';
import {
  LOGIN_IDENTIFIER,
  candidateIdentifiers,
  formatCpf,
  formatPhone,
  isValidCpf,
  normalizeCpf,
  normalizePhone,
  resolveLoginIdentifier,
} from './identity.js';

/**
 * Os CPFs abaixo são sintéticos: passam nos dígitos verificadores mas
 * não pertencem a ninguém. Usar um CPF real em teste seria dado
 * pessoal versionado no repositório.
 */
const CPF_VALIDO = '52998224725';
const CPF_VALIDO_2 = '11144477735';

describe('CPF', () => {
  it('aceita CPF com dígitos verificadores corretos, com ou sem pontuação', () => {
    expect(isValidCpf(CPF_VALIDO)).toBe(true);
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf(CPF_VALIDO_2)).toBe(true);
  });

  it('rejeita dígito verificador errado', () => {
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('11144477730')).toBe(false);
  });

  it('rejeita sequências de dígito único, que passariam no módulo 11', () => {
    for (const digit of '0123456789') {
      expect(isValidCpf(digit.repeat(11))).toBe(false);
    }
  });

  it('rejeita quantidade de dígitos diferente de 11', () => {
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('529982247251')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });

  it('normaliza para 11 dígitos sem pontuação', () => {
    expect(normalizeCpf('529.982.247-25')).toBe(CPF_VALIDO);
    expect(normalizeCpf('abc')).toBeNull();
  });

  it('formata para exibição', () => {
    expect(formatCpf(CPF_VALIDO)).toBe('529.982.247-25');
  });
});

describe('telefone', () => {
  it('normaliza celular e fixo para E.164', () => {
    expect(normalizePhone('11988887777')).toBe('+5511988887777');
    expect(normalizePhone('(11) 98888-7777')).toBe('+5511988887777');
    expect(normalizePhone('+55 11 98888-7777')).toBe('+5511988887777');
    expect(normalizePhone('1133334444')).toBe('+551133334444');
  });

  it('descarta o zero de operadora', () => {
    expect(normalizePhone('011988887777')).toBe('+5511988887777');
  });

  it('rejeita DDD inválido', () => {
    expect(normalizePhone('01988887777')).toBeNull();
    expect(normalizePhone('1098888777')).toBeNull();
  });

  it('rejeita celular sem o nono dígito 9 e fixo fora da faixa 2–5', () => {
    expect(normalizePhone('11888887777')).toBeNull();
    expect(normalizePhone('1188887777')).toBeNull();
  });

  it('rejeita comprimento fora de 10 ou 11 dígitos', () => {
    expect(normalizePhone('119888877')).toBeNull();
    expect(normalizePhone('119888877771')).toBeNull();
  });

  it('formata para exibição', () => {
    expect(formatPhone('11988887777')).toBe('(11) 98888-7777');
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
  });
});

describe('resolveLoginIdentifier', () => {
  it('reconhece e-mail e normaliza para minúsculas', () => {
    expect(resolveLoginIdentifier('  Aluno@Atlas.LOCAL ')).toEqual({
      type: LOGIN_IDENTIFIER.EMAIL,
      value: 'aluno@atlas.local',
    });
  });

  it('rejeita e-mail malformado em vez de tentar CPF', () => {
    expect(resolveLoginIdentifier('aluno@')).toBeNull();
  });

  it('reconhece CPF pontuado', () => {
    expect(resolveLoginIdentifier('529.982.247-25')).toEqual({
      type: LOGIN_IDENTIFIER.CPF,
      value: CPF_VALIDO,
    });
  });

  it('reconhece telefone', () => {
    expect(resolveLoginIdentifier('(11) 98888-7777')).toEqual({
      type: LOGIN_IDENTIFIER.PHONE,
      value: '+5511988887777',
    });
  });

  it('devolve null para lixo', () => {
    expect(resolveLoginIdentifier('nada disso')).toBeNull();
    expect(resolveLoginIdentifier('   ')).toBeNull();
  });
});

describe('candidateIdentifiers', () => {
  it('oferece CPF e telefone quando os 11 dígitos servem para ambos', () => {
    // 11900000083: verificadores de CPF fecham E o número é um celular
    // plausível (DDD 11, nono dígito 9). É a ambiguidade que o login
    // precisa resolver sem perguntar nada ao usuário.
    const candidates = candidateIdentifiers('11900000083');

    expect(candidates).toEqual([
      { type: LOGIN_IDENTIFIER.CPF, value: '11900000083' },
      { type: LOGIN_IDENTIFIER.PHONE, value: '+5511900000083' },
    ]);
  });

  it('para e-mail devolve um único candidato', () => {
    expect(candidateIdentifiers('aluno@atlas.local')).toHaveLength(1);
  });

  it('devolve lista vazia quando não é nenhum dos três', () => {
    expect(candidateIdentifiers('???')).toEqual([]);
  });
});
