import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { fixedKeys } from '../../test/invoker/fixed-keys.ts';
import { user } from '../../test/invoker/invoker-kit.ts';
import { defineApp } from '../dsl/define-app.ts';
import type { GeneratedReadInput } from '../generated-actions/generated-read-input.ts';
import { readSinceToken } from '../generated-actions/read-since-token.ts';
import type { Scope } from '../storage/scope.ts';
import { stateTokenEncoder } from './state-token-encoder.ts';
import { stateTokenKey } from './state-token-key.ts';
import { stateTokenSealing } from './state-token-sealing.ts';

const { registry } = defineApp({ id: 'portal', modules: [accounts, auth] });
const entry = registry.entities.get('accounts.profile');
const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const backend: Scope = { level: 'backend', backendId: 'b1' };
const source = { entity: 'accounts.profile', filter: undefined, sort: [] } as const;

describe('stateTokenSealing', () => {
  const keys = fixedKeys();
  const base = { registry, rules: [], principal: user('ada'), epoch: 0 };

  async function readsAs(scope: Scope, token: string): Promise<unknown> {
    const tokens = { ...base, sealKey: await stateTokenKey(keys, scope) };
    const input = { entry, scope, tokens, head: 100n } as unknown as GeneratedReadInput;
    return readSinceToken(input, token, { query: { filter: undefined, sort: [] } });
  }

  test('a tenant query seals the token of a backend entity with the backend key, so its changes accepts it', async () => {
    const encode = stateTokenEncoder({ ...base, ...(await stateTokenSealing(keys, tenant)) });
    const token = encode(5n, backend, source);
    expect(await readsAs(backend, token)).toEqual({ ok: true, position: 5n });
    expect(await readsAs(tenant, encode(5n, tenant, source))).toEqual({ ok: true, position: 5n });
  });

  test('a token is sealed for the scope it names, not for the one that issued it', async () => {
    const encode = stateTokenEncoder({ ...base, ...(await stateTokenSealing(keys, tenant)) });
    const token = encode(5n, backend, source);
    // The backend's key does not accept what the tenant's key sealed, and the reverse.
    const tenantKeyed = stateTokenEncoder({ ...base, sealKey: await stateTokenKey(keys, tenant) });
    expect(await readsAs(backend, tenantKeyed(5n, backend, source))).toEqual({
      ok: false,
      reason: 'check',
    });
    expect(token).not.toBe(tenantKeyed(5n, backend, source));
  });
});
