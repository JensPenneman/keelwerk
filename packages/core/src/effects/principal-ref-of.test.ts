import { describe, expect, test } from 'vitest';
import { context } from '../../test/authorization/fixtures.ts';
import type { Principal } from '../principals/principal.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { principalRefOf } from './principal-ref-of.ts';

const caused = { scope: { backend: 'b1', tenant: 't1' } };

describe('principalRefOf', () => {
  test('a principal the kernel minted for a module gives the core.module reference derived from its module', () => {
    expect(principalRefOf(moduleServicePrincipal('loans', caused))).toEqual({
      resolver: 'core.module',
      principalId: 'loans.system',
    });
  });

  test.each([
    [
      'a literal that names core.module by its reference',
      { ref: { resolver: 'core.module', principalId: 'loans.system' }, via: 'x' },
    ],
    ['a literal that names core.module by via', { ref: null, via: 'core.module' }],
    ['a user that claims the system resolver', { ref: null, via: 'core.system' }],
    [
      'a user whose reference names the operator',
      { kind: 'user', ref: { resolver: 'core.operator', principalId: 'local.socket' }, via: 'x' },
    ],
    [
      'a user whose reference names the operator token resolver',
      { kind: 'user', ref: { resolver: 'core.operatorToken', principalId: 'tok' }, via: 'x' },
    ],
  ])('%s is internal', (_name, over) => {
    const forged = { ...context('service', 'loans.system').principal, ...over } as Principal;
    expect(() => principalRefOf(forged)).toThrowError(
      expect.objectContaining({ kind: 'internal' }),
    );
  });

  test('a copy of a minted principal is internal: it lost the brand', () => {
    expect(() => principalRefOf({ ...moduleServicePrincipal('loans', caused) })).toThrowError(
      expect.objectContaining({ kind: 'internal' }),
    );
  });

  test('the operator keeps the reference the kernel gave it', () => {
    const operator = {
      ...context('user', 'op').principal,
      kind: 'operator',
      id: 'local.socket',
      via: 'core.operator',
      ref: { resolver: 'core.operator', principalId: 'local.socket' },
    } as unknown as Principal;
    expect(principalRefOf(operator)).toEqual({
      resolver: 'core.operator',
      principalId: 'local.socket',
    });
  });

  test('other principals keep their reference or the resolver and id they are known by', () => {
    const user = context('user', 'u1').principal;
    expect(principalRefOf(user)).toEqual({ resolver: 'test', principalId: 'u1' });
  });
});
