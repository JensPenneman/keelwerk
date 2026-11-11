import { describe, expect, test, vi } from 'vitest';
import { accounts } from '../../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../../test/fixtures/modules/auth/src/module.generated.ts';
import { fixedKeys } from '../../../test/invoker/fixed-keys.ts';
import { actionOf, user } from '../../../test/invoker/invoker-kit.ts';
import { defineApp } from '../../dsl/define-app.ts';
import type { GeneratedReadInput } from '../../generated-actions/generated-read-input.ts';
import { readSinceToken } from '../../generated-actions/read-since-token.ts';
import type { QueryStateEncoder } from '../../interpreter/query-state-encoder.ts';
import type { Scope } from '../../storage/scope.ts';
import { stateTokenKey } from '../../tokens/state-token-key.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ScopeTarget } from '../scope-target.ts';
import type { SessionDetails } from '../session-details.ts';
import { execute } from './execute.ts';

const reads = vi.hoisted(() => ({ encoders: [] as QueryStateEncoder[] }));
vi.mock('../../interpreter/run-read.ts', () => ({
  runRead: (input: { queryState: QueryStateEncoder }) => {
    reads.encoders.push(input.queryState);
    return Promise.resolve({ output: null });
  },
}));

const { registry } = defineApp({ id: 'portal', modules: [accounts, auth] });
const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const backend: Scope = { level: 'backend', backendId: 'b1' };
const keys = fixedKeys();
const target = { scope: tenant, namespace: 'ns', handle: {} } as unknown as ScopeTarget;

describe('execute, a custom query', () => {
  test("seals the token of a backend entity it loaded with the backend's key, so that entity's changes accepts it", async () => {
    const env = {
      options: { keys, clock: {} },
      appOf: () => ({ registry, configShapes: new Map() }),
      rulesOf: () => [],
    } as unknown as InvokerEnv;
    const principal = user('ada');
    const details = {
      resolved: { app: 'portal', target, backendTarget: null, backendConfig: undefined },
    } as unknown as SessionDetails;
    await execute(env, {
      action: actionOf('accounts.mine', { kind: 'query' }),
      value: {},
      invocation: { signal: new AbortController().signal, carrier: { transport: 'test' } },
      session: { principal },
      details,
      span: {},
      log: {},
    } as never);
    const [encode] = reads.encoders;
    const source = { entity: 'accounts.profile', filter: undefined, sort: [] } as const;
    const token = encode?.(5n, backend, source) ?? '';
    const input = {
      entry: registry.entities.get('accounts.profile'),
      scope: backend,
      tokens: {
        registry,
        rules: [],
        principal,
        epoch: 0,
        sealKey: await stateTokenKey(keys, backend),
      },
      head: 100n,
    } as unknown as GeneratedReadInput;
    expect(readSinceToken(input, token, { query: { filter: undefined, sort: [] } })).toEqual({
      ok: true,
      position: 5n,
    });
  });
});
