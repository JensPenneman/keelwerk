import { describe, expect, test } from 'vitest';
import { sha256 } from '../crypto/sha256.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { assertTokenScope } from './assert-token-scope.ts';
import { decodeStateToken } from './decode-state-token.ts';
import { encodeStateToken } from './encode-state-token.ts';
import { sealTokenCheck } from './seal-token-check.ts';
import { tokenCheck } from './token-check.ts';
import { tokenCheckHolds } from './token-check-holds.ts';
import { tokenScopePart } from './token-scope-part.ts';

const tenant = { level: 'tenant', backendId: 'bknd_a', tenantId: 'tnnt_a' } as const;
const other = { level: 'tenant', backendId: 'bknd_a', tenantId: 'tnnt_b' } as const;
const key = new Uint8Array(32).fill(7);

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
    // The token's check covers its epoch, position and scope (format 2): the sealed check of the same selector, an HMAC under the key of the scope (the key here is 32 bytes of 7).
    expect(encodeStateToken({ epoch: 35, position: 1234n, scope: '22e10198', check }, key)).toBe(
      'v2.z.1234.22e10198.4f92de9623b974f450603e43886b5865',
    );
  });

  test('a token decodes to the parts it was made from, with the check sealed', () => {
    const parts = { epoch: 71, position: 99n, scope: tokenScopePart(tenant), check: '00ff00ff' };
    expect(decodeStateToken(encodeStateToken(parts, key))).toEqual({
      ...parts,
      version: 2,
      check: sealTokenCheck(parts, key),
    });
  });

  test('a token whose position was altered fails its check like a forged one; the first format never holds', () => {
    const source = { epoch: 3, position: 50n, scope: tokenScopePart(tenant), check: '00ff00ff' };
    const token = encodeStateToken(source, key);
    const parts = decodeStateToken(token);
    expect(tokenCheckHolds(parts, source.check, key)).toBe(true);
    const earlier = decodeStateToken(token.replace('.50.', '.7.'));
    expect(earlier.position).toBe(7n);
    expect(tokenCheckHolds(earlier, source.check, key)).toBe(false);
    const forged = decodeStateToken(token.replace(/\.[0-9a-f]{32}$/, '.deadbeef'.padEnd(33, '0')));
    expect(tokenCheckHolds(forged, source.check, key)).toBe(false);
    expect(tokenCheckHolds(decodeStateToken(token.replace('v2.', 'v1.')), source.check, key)).toBe(
      false,
    );
  });

  test('a token sealed under the key of another scope fails its check, and a holder cannot reseal an edited one', () => {
    const source = { epoch: 3, position: 50n, scope: tokenScopePart(tenant), check: '00ff00ff' };
    const otherKey = new Uint8Array(32).fill(9);
    const sealedElsewhere = decodeStateToken(encodeStateToken(source, otherKey));
    expect(tokenCheckHolds(sealedElsewhere, source.check, key)).toBe(false);
    expect(tokenCheckHolds(sealedElsewhere, source.check, otherKey)).toBe(true);
    // The holder knows every value of the token: the unkeyed digest of an edited position does not fit.
    const edited = { ...source, position: 7n };
    const unkeyed = sha256(
      canonicalizeJson({
        version: 2,
        epoch: edited.epoch,
        position: edited.position.toString(),
        scope: edited.scope,
        check: edited.check,
      }),
    ).slice(0, 32);
    const forgedParts = { ...decodeStateToken(encodeStateToken(edited, otherKey)), check: unkeyed };
    expect(tokenCheckHolds(forgedParts, source.check, key)).toBe(false);
    expect(tokenCheckHolds(forgedParts, source.check, otherKey)).toBe(false);
  });

  test('a check cut to the old length or with one altered character is refused', () => {
    const source = { epoch: 3, position: 50n, scope: tokenScopePart(tenant), check: '00ff00ff' };
    const token = encodeStateToken(source, key);
    expect(token).toMatch(/\.[0-9a-f]{32}$/);
    const cut = decodeStateToken(token.slice(0, -24));
    expect(cut.check).toHaveLength(8);
    expect(tokenCheckHolds(cut, source.check, key)).toBe(false);
    const last = token.slice(-1) === '0' ? '1' : '0';
    const altered = decodeStateToken(token.slice(0, -1) + last);
    expect(tokenCheckHolds(altered, source.check, key)).toBe(false);
    expect(tokenCheckHolds(decodeStateToken(token), source.check, key)).toBe(true);
  });

  test('a malformed token is a validation error', () => {
    expect(() => decodeStateToken('12')).toThrow(KeelwerkError);
    expect(() => decodeStateToken('v1.0.01.22e10198.b0dcbba4')).toThrow(KeelwerkError);
  });

  test('a token of another scope is core.token_scope_mismatch', () => {
    const parts = decodeStateToken(
      encodeStateToken(
        { epoch: 0, position: 1n, scope: tokenScopePart(other), check: '00000000' },
        key,
      ),
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
