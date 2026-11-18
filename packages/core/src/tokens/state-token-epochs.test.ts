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

describe('the epoch of the scope a token names (14.7.6, D7)', () => {
  const keys = fixedKeys();
  const epochs = new Map<string, number>();
  const epochOf = (scope: Scope): number =>
    epochs.get(
      scope.level === 'tenant' ? scope.tenantId : scope.level === 'backend' ? scope.backendId : '',
    ) ?? 0;
  const base = { registry, rules: [], principal: user('ada'), epoch: 0, epochOf };

  /** What the scope's own read makes of a token: its epoch comes from the same `epochOf`. */
  async function readsAs(scope: Scope, token: string): Promise<unknown> {
    const tokens = { ...base, epoch: epochOf(scope), sealKey: await stateTokenKey(keys, scope) };
    const input = { entry, scope, tokens, head: 100n } as unknown as GeneratedReadInput;
    return readSinceToken(input, token, { query: { filter: undefined, sort: [] } });
  }

  test('a backend token issued in a tenant invocation carries the backend epoch and is accepted by the backend read', async () => {
    epochs.clear();
    epochs.set('t1', 1);
    epochs.set('b1', 4);
    // The invocation runs in the tenant (epoch 1) and reads backend data.
    const encode = stateTokenEncoder({
      ...base,
      epoch: epochOf(tenant),
      ...(await stateTokenSealing(keys, tenant)),
    });
    const token = encode(5n, backend, source);
    expect(token.startsWith(`v2.${(4).toString(36)}.`)).toBe(true);
    expect(await readsAs(backend, token)).toEqual({ ok: true, position: 5n });
    expect(await readsAs(tenant, encode(5n, tenant, source))).toEqual({ ok: true, position: 5n });
  });

  test('after a bump of the backend only, the backend token answers reset and the tenant token still holds', async () => {
    epochs.clear();
    epochs.set('b1', 4);
    const encode = stateTokenEncoder({
      ...base,
      epoch: epochOf(tenant),
      ...(await stateTokenSealing(keys, tenant)),
    });
    const backendToken = encode(5n, backend, source);
    const tenantToken = encode(5n, tenant, source);
    epochs.set('b1', 6);
    expect(await readsAs(backend, backendToken)).toEqual({ ok: false, reason: 'epoch' });
    expect(await readsAs(tenant, tenantToken)).toEqual({ ok: true, position: 5n });
  });

  test('without epochOf the invocation epoch applies to every scope', async () => {
    epochs.clear();
    const encode = stateTokenEncoder({
      registry,
      rules: [],
      principal: user('ada'),
      epoch: 3,
      ...(await stateTokenSealing(keys, tenant)),
    });
    expect(encode(5n, backend, source).startsWith(`v2.${(3).toString(36)}.`)).toBe(true);
  });
});
