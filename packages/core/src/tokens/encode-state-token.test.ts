import { describe, expect, test } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { assertTokenScope } from './assert-token-scope.ts';
import { decodeStateToken } from './decode-state-token.ts';
import { encodeStateToken } from './encode-state-token.ts';
import { tokenCheck } from './token-check.ts';
import { tokenScopePart } from './token-scope-part.ts';

const tenant = { level: 'tenant', backendId: 'bknd_a', tenantId: 'tnnt_a' } as const;
const other = { level: 'tenant', backendId: 'bknd_a', tenantId: 'tnnt_b' } as const;

describe('state tokens', () => {
  test('goldens: the format and the parts are final from M1', () => {
    expect(tokenScopePart(tenant)).toBe('22e10198');
    expect(tokenScopePart({ level: 'backend', backendId: 'bknd_a' })).toBe('b8e69941');
    expect(tokenScopePart({ level: 'deployment' })).toBe('439083f3');
    const check = tokenCheck({
      rules: [{ id: 'library.book.readers', digest: 'abc' }],
      principal: { id: 'u1', roles: ['b', 'a'], memberships: [] },
      entity: 'library.book',
      partition: '',
    });
    expect(check).toBe('b0dcbba4');
    expect(encodeStateToken({ epoch: 35, position: 1234n, scope: '22e10198', check })).toBe(
      'v1.z.1234.22e10198.b0dcbba4',
    );
  });

  test('a token decodes to the parts it was made from', () => {
    const parts = { epoch: 71, position: 99n, scope: tokenScopePart(tenant), check: '00ff00ff' };
    expect(decodeStateToken(encodeStateToken(parts))).toEqual(parts);
  });

  test('a malformed token is a validation error', () => {
    expect(() => decodeStateToken('12')).toThrow(KeelwerkError);
    expect(() => decodeStateToken('v1.0.01.22e10198.b0dcbba4')).toThrow(KeelwerkError);
  });

  test('a token of another scope is core.token_scope_mismatch', () => {
    const parts = decodeStateToken(
      encodeStateToken({ epoch: 0, position: 1n, scope: tokenScopePart(other), check: '00000000' }),
    );
    expect(() => assertTokenScope(parts, tenant)).toThrowError(
      expect.objectContaining({ code: 'core.token_scope_mismatch' }),
    );
    expect(() => assertTokenScope(parts, other)).not.toThrow();
  });

  test('the check changes with roles, rules and the selector, not with their order', () => {
    const base = {
      rules: [{ id: 'a', digest: '1' }],
      principal: { id: 'u', roles: ['x', 'y'], memberships: [] },
      entity: 'e',
      partition: '',
    };
    expect(tokenCheck({ ...base, principal: { ...base.principal, roles: ['y', 'x'] } })).toBe(
      tokenCheck(base),
    );
    expect(tokenCheck({ ...base, rules: [{ id: 'a', digest: '2' }] })).not.toBe(tokenCheck(base));
    expect(tokenCheck({ ...base, selector: { filter: { a: 1 }, sort: [] } })).not.toBe(
      tokenCheck(base),
    );
  });
});
