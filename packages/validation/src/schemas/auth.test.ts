/**
 * Schemas de autenticação.
 *
 * O foco é a NORMALIZAÇÃO: o schema não só aceita ou recusa, ele
 * converte para a forma canônica que vai ao banco. É isso que impede
 * que "529.982.247-25" e "52998224725" virem duas contas — e é o tipo
 * de regra que se quebra sem ninguém notar até aparecer o cadastro
 * duplicado em produção.
 */

import { describe, expect, it } from 'vitest';
import { changePasswordSchema, credentialsLoginSchema, registerSchema } from './auth.js';

const BASE = { name: 'Aluno Teste', email: 'aluno@atlas.test', password: 'senha-forte-1' };

describe('registerSchema', () => {
  it('normaliza e-mail, CPF e telefone', () => {
    const parsed = registerSchema.parse({
      ...BASE,
      email: '  Aluno@Atlas.TEST ',
      cpf: '529.982.247-25',
      phone: '(11) 98888-7777',
    });

    expect(parsed.email).toBe('aluno@atlas.test');
    expect(parsed.cpf).toBe('52998224725');
    expect(parsed.phone).toBe('+5511988887777');
  });

  it('aceita cadastro só com e-mail — CPF e telefone são opcionais', () => {
    const parsed = registerSchema.parse(BASE);

    expect(parsed.cpf).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
  });

  it('recusa CPF com dígito verificador inválido', () => {
    expect(() => registerSchema.parse({ ...BASE, cpf: '52998224726' })).toThrow();
    expect(() => registerSchema.parse({ ...BASE, cpf: '11111111111' })).toThrow();
  });

  it('recusa telefone fora do padrão brasileiro', () => {
    expect(() => registerSchema.parse({ ...BASE, phone: '11888887777' })).toThrow();
    expect(() => registerSchema.parse({ ...BASE, phone: '123' })).toThrow();
  });

  it('exige senha com letra, número e ao menos 8 caracteres', () => {
    expect(() => registerSchema.parse({ ...BASE, password: 'somenteletras' })).toThrow();
    expect(() => registerSchema.parse({ ...BASE, password: '12345678' })).toThrow();
    expect(() => registerSchema.parse({ ...BASE, password: 'abc1' })).toThrow();
    expect(registerSchema.parse({ ...BASE, password: 'abcdefg1' }).password).toBe('abcdefg1');
  });

  it('recusa senha acima de 72 bytes, que o bcrypt truncaria em silêncio', () => {
    expect(() => registerSchema.parse({ ...BASE, password: `a1${'x'.repeat(71)}` })).toThrow();
  });

  it('recusa nome vazio ou de uma letra', () => {
    expect(() => registerSchema.parse({ ...BASE, name: '' })).toThrow();
    expect(() => registerSchema.parse({ ...BASE, name: 'A' })).toThrow();
  });
});

describe('credentialsLoginSchema', () => {
  it('aceita qualquer identificador — quem decide o tipo é a API', () => {
    for (const identifier of ['aluno@atlas.test', '52998224725', '(11) 98888-7777']) {
      expect(credentialsLoginSchema.parse({ identifier, password: 'x' }).identifier).toBeTruthy();
    }
  });

  it('não impõe força de senha no login', () => {
    // A regra de força vale no cadastro. No login, recusar uma senha
    // "fraca" só entregaria ao atacante a informação de que aquela
    // senha jamais existiria.
    expect(() =>
      credentialsLoginSchema.parse({ identifier: 'aluno@atlas.test', password: 'x' }),
    ).not.toThrow();
  });

  it('exige identificador e senha não vazios', () => {
    expect(() => credentialsLoginSchema.parse({ identifier: '', password: 'x' })).toThrow();
    expect(() =>
      credentialsLoginSchema.parse({ identifier: 'aluno@atlas.test', password: '' }),
    ).toThrow();
  });
});

describe('changePasswordSchema', () => {
  it('revoga as outras sessões por padrão', () => {
    const parsed = changePasswordSchema.parse({ newPassword: 'nova-senha-1' });
    expect(parsed.revokeOtherSessions).toBe(true);
  });

  it('senha atual é opcional — quem entrou por Google ainda não tem', () => {
    expect(() => changePasswordSchema.parse({ newPassword: 'nova-senha-1' })).not.toThrow();
  });

  it('aplica a mesma força exigida no cadastro', () => {
    expect(() => changePasswordSchema.parse({ newPassword: 'fraca' })).toThrow();
  });
});
