import { describe, expect, test, vi } from 'vitest';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { ResolvedScope } from '../invoker/resolved-scope.ts';
import type { Span } from '../observability/span.ts';
import type { Principal } from '../principals/principal.ts';
import { reresolvePrincipal } from './reresolve-principal.ts';

const answered: { fill: { module: string; value: unknown } | undefined } = { fill: undefined };

// The resolver kit needs a unit of the scope; these cases only need the fills it would hand out.
vi.mock('../invoker/edge/with-resolver-kit.ts', () => ({
  withResolverKit: (_input: unknown, use: (kit: unknown) => Promise<unknown>) =>
    use({
      fills: () => (answered.fill === undefined ? [] : [answered.fill]),
      drive: (generator: unknown) => Promise.resolve(generator),
    }),
}));

const scope = { level: 'tenant', backendId: 'b-1', tenantId: 't-1' } as const;
const resolved = {
  scope,
  app: 'library',
  resolvedBy: 'local',
  target: null,
  backendTarget: null,
} as ResolvedScope;
const context = { requestId: 'r', span: {} as Span };

function carrier(
  resolver: string,
  principalId: string,
  transport: string | null = null,
): JobCarrier {
  return {
    scope,
    namespace: 'n-1',
    principal: { resolver, principalId },
    transport,
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

describe("reresolvePrincipal: an operator from a module's fromRef", () => {
  const operator = {
    kind: 'operator',
    id: 'olive',
    scope: { backend: 'b-1', tenant: 't-1' },
    claims: {},
    roles: [],
    memberships: [],
    via: 'keys.key',
    ref: { resolver: 'keys.key', principalId: 'olive' },
  } as Principal;
  const target = { ...resolved, target: {} } as unknown as ResolvedScope;
  const jobEnv = {
    appOf: () => ({ registry: { modules: [] } }),
    options: { clock: { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') } },
  } as unknown as InvokerEnv;
  const fillBy = (module: string) => ({
    module,
    value: { id: 'keys.key', resolve: () => null, fromRef: () => ({ principal: operator }) },
  });

  test("an operator answered by a module's fromRef fails the job unauthenticated", async () => {
    answered.fill = fillBy('keys');
    await expect(
      reresolvePrincipal(jobEnv, carrier('keys.key', 'olive'), target, context),
    ).rejects.toMatchObject({
      kind: 'unauthenticated',
      message: 'The principal of this job no longer resolves.',
    });
  });

  test("fromRef receives the transport the job's receipt records, and null without one", async () => {
    const contexts: { transport?: unknown }[] = [];
    answered.fill = {
      module: 'keys',
      value: {
        id: 'keys.key',
        resolve: () => null,
        fromRef: (_ref: unknown, context: { transport?: unknown }) => {
          contexts.push(context);
          return { principal: { ...operator, kind: 'user', subject: 'ada' } };
        },
      },
    };
    for (const transport of ['cli', null]) {
      await reresolvePrincipal(
        jobEnv,
        carrier('keys.key', 'olive', transport),
        target,
        context,
      ).catch(() => undefined);
    }
    expect(contexts.map((seen) => seen.transport)).toEqual(['cli', null]);
  });

  test("the core's own fill may answer an operator for a job", async () => {
    answered.fill = fillBy('core');
    const { principal } = await reresolvePrincipal(
      jobEnv,
      carrier('keys.key', 'olive'),
      target,
      context,
    );
    expect(principal.kind).toBe('operator');
  });
});
