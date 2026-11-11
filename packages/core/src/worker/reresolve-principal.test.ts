import { describe, expect, test } from 'vitest';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { ResolvedScope } from '../invoker/resolved-scope.ts';
import type { Span } from '../observability/span.ts';
import { reresolvePrincipal } from './reresolve-principal.ts';

const scope = { level: 'tenant', backendId: 'b-1', tenantId: 't-1' } as const;
const resolved = {
  scope,
  app: 'library',
  resolvedBy: 'local',
  target: null,
  backendTarget: null,
} as ResolvedScope;
const context = { requestId: 'r', span: {} as Span };

function carrier(resolver: string, principalId: string): JobCarrier {
  return {
    scope,
    namespace: 'n-1',
    principal: { resolver, principalId },
    transport: null,
    attempt: { jobId: '1', attempt: 1 },
    worker: 'w',
    signal: new AbortController().signal,
  };
}

const env = {
  appOf: () => ({ registry: { modules: [{ id: 'loans' }, { id: 'library' }] } }),
} as unknown as InvokerEnv;

describe('reresolvePrincipal: the kernel references', () => {
  test('core.module is the service principal of its module, in the job scope', async () => {
    const { principal } = await reresolvePrincipal(
      env,
      carrier('core.module', 'loans.system'),
      resolved,
      context,
    );
    expect(principal).toMatchObject({
      kind: 'service',
      id: 'loans.system',
      via: 'core.module',
      scope: { backend: 'b-1', tenant: 't-1' },
    });
  });

  test.each(['loans', 'ghost.system', '.system', 'loans.system.system'])(
    'a core.module reference %j that is no <module>.system of the app is unauthenticated',
    async (principalId) => {
      await expect(
        reresolvePrincipal(env, carrier('core.module', principalId), resolved, context),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
    },
  );

  test('core.system is the system principal of its reason', async () => {
    const { principal } = await reresolvePrincipal(
      env,
      carrier('core.system', 'nightly cleanup'),
      resolved,
      context,
    );
    expect(principal).toMatchObject({ kind: 'system', reason: 'nightly cleanup' });
  });

  test.each(['core.operator', 'core.runtime'])(
    '%s is the operator the reference names',
    async (resolver) => {
      const { principal } = await reresolvePrincipal(
        env,
        carrier(resolver, 'olive'),
        resolved,
        context,
      );
      expect(principal).toMatchObject({ kind: 'operator', id: 'olive', via: resolver });
    },
  );

  test('core.invoker is the anonymous placeholder', async () => {
    const answer = await reresolvePrincipal(
      env,
      carrier('core.invoker', 'anonymous'),
      resolved,
      context,
    );
    expect(answer.principal.kind).toBe('anonymous');
    expect(answer.authenticated).toBe(false);
  });

  test('another resolver with no data to read from fails unauthenticated', async () => {
    await expect(
      reresolvePrincipal(env, carrier('auth.session', 'ada'), resolved, context),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
});
