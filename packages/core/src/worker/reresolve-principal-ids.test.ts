import { afterEach, describe, expect, test, vi } from 'vitest';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { ResolvedScope } from '../invoker/resolved-scope.ts';
import type { Span } from '../observability/span.ts';
import type { Principal } from '../principals/principal.ts';
import { reresolvePrincipal } from './reresolve-principal.ts';

const answered: {
  fill: { module: string; value: unknown } | undefined;
  enricher: { module: string; value: unknown } | undefined;
  touch: ((given: Principal) => void) | undefined;
} = { fill: undefined, enricher: undefined, touch: undefined };

// The resolver kit needs a unit of the scope; these cases only need the fills it would hand out.
vi.mock('../invoker/edge/with-resolver-kit.ts', () => ({
  withResolverKit: (_input: unknown, use: (kit: unknown) => Promise<unknown>) =>
    use({
      fills: (point: string, given: Principal) => {
        answered.touch?.(given);
        const own = point === 'core.principalResolvers' ? answered.fill : answered.enricher;
        return own === undefined ? [] : [own];
      },
      drive: (generator: unknown) => Promise.resolve(generator),
    }),
}));

const scope = { level: 'tenant', backendId: 'b-1', tenantId: 't-1' } as const;
const target = {
  scope,
  app: 'library',
  resolvedBy: 'local',
  target: {},
  backendTarget: null,
} as unknown as ResolvedScope;
const context = { requestId: 'r', span: {} as Span };
const jobEnv = {
  appOf: () => ({ registry: { modules: [] } }),
  options: { clock: { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') } },
} as unknown as InvokerEnv;

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

const userWith = (kind: string) =>
  ({
    kind: 'user',
    subject: 'u-1',
    subjectRef: null,
    scope: { backend: 'b-1', tenant: 't-1' },
    claims: {},
    roles: [],
    memberships: [{ kind, id: 'm-1', role: 'admin' }],
    via: 'keys.key',
    ref: { resolver: 'keys.key', principalId: 'k-1' },
  }) as unknown as Principal;

describe('reresolvePrincipal: the resolver of a stored reference and its answer', () => {
  afterEach(() => {
    answered.fill = undefined;
    answered.enricher = undefined;
    answered.touch = undefined;
  });

  test("a stored reference never reaches a resolver of another module's id", async () => {
    let asked = 0;
    answered.fill = {
      module: 'evil',
      value: {
        id: 'keys.key',
        resolve: () => null,
        fromRef: () => {
          asked += 1;
          return { principal: userWith('evil.device') };
        },
      },
    };
    await expect(
      reresolvePrincipal(jobEnv, carrier('keys.key', 'k-1'), target, context),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(asked).toBe(0);
  });

  test('the principal of a job says through the resolver that answered, whatever the answer says', async () => {
    answered.fill = {
      module: 'keys',
      value: {
        id: 'keys.key',
        resolve: () => null,
        fromRef: () => ({ principal: { ...userWith('keys.device'), via: 'auth.session' } }),
      },
    };
    const { principal } = await reresolvePrincipal(
      jobEnv,
      carrier('keys.key', 'k-1'),
      target,
      context,
    );
    expect(principal.via).toBe('keys.key');
  });

  test.each([
    [
      'ref',
      { resolver: 'keys.key', principalId: 'k-1' },
      { resolver: 'core.operator', principalId: 'k-1' },
    ],
    ['kind', 'user', 'operator'],
    ['subject', 'u-1', 'U-1'],
  ])(
    'a %s that reads differently the second time lands as it was checked',
    async (field, first, then) => {
      const reads = [first];
      answered.fill = {
        module: 'keys',
        value: {
          id: 'keys.key',
          resolve: () => null,
          fromRef: () => ({
            principal: Object.defineProperty({ ...userWith('keys.device') }, field, {
              get: () => reads.shift() ?? then,
              enumerable: true,
            }),
          }),
        },
      };
      const { principal } = await reresolvePrincipal(
        jobEnv,
        carrier('keys.key', 'k-1'),
        target,
        context,
      );
      expect(principal).toMatchObject({ [field]: first });
    },
  );

  test('an id that reads differently the second time never answers the stored reference of another module', async () => {
    let reads = 0;
    let asked = 0;
    answered.fill = {
      module: 'evil',
      value: {
        get id() {
          reads += 1;
          return reads === 1 ? 'auth.session' : 'evil.keys';
        },
        resolve: () => null,
        fromRef: () => {
          asked += 1;
          return { principal: userWith('evil.device') };
        },
      },
    };
    await expect(
      reresolvePrincipal(jobEnv, carrier('auth.session', 'k-1'), target, context),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(asked).toBe(0);
  });

  test('an id that is its own on the first read and foreign after resolves the stored reference under its own id', async () => {
    let reads = 0;
    answered.fill = {
      module: 'keys',
      value: {
        get id() {
          reads += 1;
          return reads === 1 ? 'keys.key' : 'auth.session';
        },
        resolve: () => null,
        fromRef: () => ({ principal: userWith('keys.device') }),
      },
    };
    const { principal } = await reresolvePrincipal(
      jobEnv,
      carrier('keys.key', 'k-1'),
      target,
      context,
    );
    expect(principal).toMatchObject({ kind: 'user', via: 'keys.key' });
    expect(principal.ref?.resolver).toBe('keys.key');
  });

  test('the scope of the placeholder a factory is given cannot be set to null for the job', async () => {
    answered.touch = (given) => {
      try {
        Object.assign(given.scope, { backend: null, tenant: null });
      } catch {
        // a frozen principal refuses the write
      }
    };
    answered.fill = {
      module: 'keys',
      value: {
        id: 'keys.key',
        resolve: () => null,
        fromRef: () => ({ principal: userWith('keys.device') }),
      },
    };
    const { principal } = await reresolvePrincipal(
      jobEnv,
      carrier('keys.key', 'k-1'),
      target,
      context,
    );
    expect(principal.scope).toEqual({ backend: 'b-1', tenant: 't-1' });
  });

  test('an enricher of a stored reference is handed a frozen principal and cannot change its kind', async () => {
    answered.fill = {
      module: 'keys',
      value: {
        id: 'keys.key',
        resolve: () => null,
        fromRef: () => ({ principal: userWith('keys.device') }),
      },
    };
    answered.enricher = {
      module: 'other',
      value: {
        enrich: (handed: Principal) => {
          try {
            (handed as { kind: string }).kind = 'operator';
          } catch {
            // a frozen principal refuses the write
          }
          return {};
        },
      },
    };
    const { principal } = await reresolvePrincipal(
      jobEnv,
      carrier('keys.key', 'k-1'),
      target,
      context,
    );
    expect(principal.kind).toBe('user');
  });

  test.each([
    [
      'an instance of a class',
      () =>
        new (class {
          resolver = 'keys.key';
          principalId = 'k-1';
        })(),
    ],
    [
      'a getter on the prototype',
      () =>
        new (class {
          principalId = 'k-1';
          get resolver() {
            return 'keys.key';
          }
        })(),
    ],
    [
      'an object that answers the tag of a Temporal value',
      () =>
        new (class {
          resolver = 'keys.key';
          principalId = 'k-1';
          get [Symbol.toStringTag]() {
            return 'Temporal.Instant';
          }
        })(),
    ],
  ])(
    'a stored reference whose answer carries its reference as %s is internal',
    async (_title, make) => {
      answered.fill = {
        module: 'keys',
        value: {
          id: 'keys.key',
          resolve: () => null,
          fromRef: () => ({ principal: { ...userWith('keys.device'), ref: make() } }),
        },
      };
      await expect(
        reresolvePrincipal(jobEnv, carrier('keys.key', 'k-1'), target, context),
      ).rejects.toMatchObject({ kind: 'internal', message: expect.stringContaining('"ref"') });
    },
  );
});
