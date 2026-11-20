import { describe, expect, test } from 'vitest';
import {
  actionOf,
  adapterOf,
  callOf,
  failureOf,
  fill,
  invokerOf,
  namespace,
  registryOf,
  scope,
  sessionOf,
} from '../../test/invoker/invoker-kit.ts';
import { streamFailure } from '../../test/invoker/live-kit.ts';
import { staticScopeDirectory } from '../../test/invoker/static-scope-directory.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import { shape } from '../fields/shape.ts';
import { parseTypeId } from '../ids/parse-type-id.ts';
import type { Principal } from '../principals/principal.ts';
import type { AnyEffect } from '../protocol/any-effect.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import type { InvocationDecision } from './decision-hook.ts';
import { credentialsRefused } from './stages/credentials-refused.ts';

const expiry = Temporal.Instant.from('2026-11-04T00:00:00Z');
const refused = { kind: 'unauthenticated', code: 'core.unauthenticated' };
// A session that was valid when it opened, and a job, are told the session expired.
const expired = { ...refused, message: 'The session expired.' };
// A fresh open has proven nothing: it gets the refusal the resolvers give for a credential that is not accepted.
const generic = {
  kind: credentialsRefused().kind,
  code: credentialsRefused().code,
  message: credentialsRefused().message,
};

/** The clock 1 ms before, at and 1 ms after the expiry; the clock is pinned, so no timer or machine speed is involved. */
const offsets = [
  ['1 ms before the expiry', -1],
  ['at the expiry', 0],
  ['1 ms after the expiry', 1],
] as const;
const refusedOffsets = offsets.filter(([, offset]) => offset >= 0);

const timer = {
  kind: 'setTimer',
  type: 'setTimer',
  key: 'idle',
  after: '45s',
  action: 'doc.touch',
  input: {},
} as unknown as AnyEffect;

/**
 * A resolver that answers `Bearer expiring` with a user that expires at the expiry, never checks that
 * expiry itself and asks for one timer, as auth's idle extension does. A job's `fromRef` answers the same
 * user. Its effects reach `unit.jobs.enqueue`, whose real behaviour the job-store conformance cases prove
 * (packages/testing/src/conformance/adapter/job-store-cases.ts).
 */
const expiring: PrincipalResolver = {
  id: 'test.expiring',
  describe: () => ({ scheme: 'bearer' }),
  // biome-ignore lint/correctness/useYield: the test resolver loads nothing
  *resolve(carrier) {
    if (carrier.headers?.authorization !== 'Bearer expiring') return null;
    return { principal: adaExpiring, effects: [timer] };
  },
  // biome-ignore lint/correctness/useYield: the test resolver loads nothing
  *fromRef() {
    return { principal: adaExpiring };
  },
};
const adaExpiring = {
  kind: 'user',
  subject: 'ada',
  subjectRef: null,
  subjectAs: () => null,
  scope: { backend: 'b1', tenant: 't1' },
  claims: {},
  roles: [],
  memberships: [],
  via: 'test.expiring',
  ref: null,
  expiresAt: expiry,
} as unknown as Principal;

const carrier = {
  transport: 'test',
  headers: { 'x-tenant': 't1', authorization: 'Bearer expiring' },
} as const;
const jobCarrier = {
  transport: 'job',
  job: {
    scope,
    namespace: namespace.id,
    principal: { resolver: 'test.expiring', principalId: 'ada' },
    transport: null,
    attempt: { jobId: '1', attempt: 1 },
    worker: 'w',
    signal: new AbortController().signal,
  },
} as const;

/** An invoker whose clock the case sets and whose unit counts the jobs the resolver's effects enqueue. */
function worldOf() {
  const jobs: StoredJobSpec[] = [];
  const decisions: InvocationDecision[] = [];
  const clock = { at: expiry };
  const adapter = {
    ...adapterOf(),
    unit: async (_ns: unknown, _scope: unknown, fn: (unit: object) => Promise<unknown>) =>
      fn({ jobs: { enqueue: async (job: StoredJobSpec) => void jobs.push(job) } }),
  };
  const registry = registryOf(
    [
      actionOf('doc.touch', { kind: 'command', scope: 'tenant', input: shape({}) }),
      actionOf('doc.look', { kind: 'query', scope: 'tenant', input: shape({}) }),
    ],
    {
      fills: new Map([['core.principalResolvers', [fill('core.principalResolvers', expiring)]]]),
    },
  );
  const invoker = invokerOf(registry, {
    clock: { now: () => clock.at },
    placement: () => ({ adapter }) as never,
    onDecision: (decision) => decisions.push(decision),
  });
  return {
    invoker,
    jobs,
    decisions,
    at: (offset: number) => {
      clock.at = expiry.add({ milliseconds: offset });
    },
  };
}

describe('open for a principal that expires at the expiry', () => {
  test.each(offsets)('invoker.open %s', async (_when, offset) => {
    const { invoker, jobs, at } = worldOf();
    at(offset);
    const outcome = await invoker.open(carrier);
    if (offset < 0) {
      expect(sessionOf(outcome).expiresAt).toEqual(expiry);
      expect(jobs).toHaveLength(1);
    } else {
      expect(failureOf(outcome)).toMatchObject(generic);
      expect(jobs).toHaveLength(0);
    }
  });

  const invoked = [
    ['a command', 'doc.touch'],
    ['a query', 'doc.look'],
  ] as const;
  test.each(
    invoked.flatMap(([what, action]) =>
      offsets.map(([when, offset]) => [what, when, action, offset] as const),
    ),
  )('%s invoked without a session %s', async (_what, _when, action, offset) => {
    const { invoker, jobs, decisions, at } = worldOf();
    at(offset);
    const outcome = await invoker.invoke(callOf(action, {}, { carrier }));
    if (offset < 0) {
      expect(decisions.at(-1)?.stage).not.toBe('open');
      expect(jobs).toHaveLength(1);
    } else {
      expect(failureOf(outcome)).toMatchObject(generic);
      expect(decisions.at(-1)).toMatchObject({ kind: 'invoke', stage: 'open' });
      expect(jobs).toHaveLength(0);
    }
  });

  test.each(offsets)('a subscription without a session %s', async (_when, offset) => {
    const { invoker, jobs, decisions, at } = worldOf();
    at(offset);
    const error = await streamFailure(invoker.subscribe(callOf('doc.look', {}, { carrier })));
    if (offset < 0) {
      expect(decisions.at(-1)?.stage).not.toBe('open');
      expect(jobs).toHaveLength(1);
    } else {
      expect(error).toMatchObject(generic);
      expect(decisions.at(-1)).toMatchObject({ kind: 'subscribe', stage: 'open' });
      expect(jobs).toHaveLength(0);
    }
  });

  test.each(refusedOffsets)('the members of a batch %s', async (_when, offset) => {
    const { invoker, jobs, at } = worldOf();
    at(-1);
    // Imitates transport-http: serve-request.ts opens once per request and batch-endpoint.ts runs the
    // members under that session, so none opens again. No conformance case proves that yet.
    const session = sessionOf(await invoker.open(carrier));
    await invoker.invoke(callOf('doc.touch', {}, { carrier, session }));
    await invoker.invoke(callOf('doc.look', {}, { carrier, session }));
    expect(jobs).toHaveLength(1);
    at(offset);
    expect(failureOf(await invoker.open(carrier))).toMatchObject(generic);
    expect(jobs).toHaveLength(1);
  });

  test.each(offsets)('a revalidation %s', async (_when, offset) => {
    const { invoker, jobs, at } = worldOf();
    at(-1);
    const session = sessionOf(await invoker.open(carrier));
    expect(jobs).toHaveLength(1);
    at(offset);
    const outcome = await session.revalidate();
    if (offset < 0) {
      expect(sessionOf(outcome)).not.toBe(session);
      expect(jobs).toHaveLength(2);
    } else {
      expect(failureOf(outcome)).toMatchObject(expired);
      expect(jobs).toHaveLength(1);
    }
  });

  test.each(offsets)('a job %s', async (_when, offset) => {
    const { invoker, decisions, at } = worldOf();
    at(offset);
    const outcome = await invoker.invoke(callOf('doc.touch', {}, { carrier: jobCarrier }));
    if (offset < 0) {
      expect(decisions).toHaveLength(1);
      expect(decisions.at(-1)?.stage).not.toBe('open');
    } else {
      expect(failureOf(outcome)).toMatchObject(expired);
      expect(decisions.at(-1)).toMatchObject({ kind: 'invoke', stage: 'open' });
    }
  });
});

describe('what each path of open tells a caller about an expired principal', () => {
  const unaccepted = { ...carrier, headers: { ...carrier.headers, authorization: 'Bearer other' } };

  test('the refusal of a fresh open is the one the resolvers give for a credential that is not accepted', async () => {
    const { invoker, at } = worldOf();
    at(0);
    const own = failureOf(await invoker.open(unaccepted));
    const fresh = failureOf(await invoker.open(carrier));
    expect(own).toMatchObject({
      code: 'core.unauthenticated',
      message: 'The credentials were not accepted.',
    });
    expect(fresh).toMatchObject({ kind: own.kind, code: own.code, message: own.message });
  });

  test.each([
    ['a fresh open', 'open', generic],
    ['a revalidation of an open session', 'revalidate', expired],
    ['a job', 'job', expired],
  ] as const)('%s answers its own text', async (_path, path, answer) => {
    const { invoker, at } = worldOf();
    let outcome: unknown;
    if (path === 'revalidate') {
      at(-1);
      const session = sessionOf(await invoker.open(carrier));
      at(0);
      outcome = await session.revalidate();
    } else {
      at(0);
      outcome =
        path === 'open'
          ? await invoker.open(carrier)
          : await invoker.invoke(callOf('doc.touch', {}, { carrier: jobCarrier }));
    }
    expect(failureOf(outcome as never)).toMatchObject(answer);
  });
});

describe('the refusal of an expired principal comes first', () => {
  test('before the API version', async () => {
    const { invoker, jobs, at } = worldOf();
    at(0);
    const unknown = {
      ...carrier,
      headers: { ...carrier.headers, 'keelwerk-version': '2099-01-01' },
    };
    const outcome = await invoker.open(unknown);
    expect(failureOf(outcome)).toMatchObject(generic);
    expect(jobs).toHaveLength(0);
  });

  test('before the tenant marker of an operator', async () => {
    const marker = 'tnt_01h2xcejqtf2nbrexx3vqjhp41';
    // The directory is asked by the id the marker parses to, so that is the row's id.
    const tenantId = parseTypeId(marker, 'tnt') ?? '';
    const directory = staticScopeDirectory({
      backends: [{ id: 'b1', app: 'doc', placementId: 'main', namespace, status: 'active' }],
      tenants: [
        { id: tenantId, backendId: 'b1', placementId: 'main', namespace, status: 'active' },
      ],
    });
    const lookups: string[] = [];
    const entries: string[] = [];
    const invoker = invokerOf(registryOf([]), {
      clock: { now: () => expiry },
      operatorHosts: ['operator.example'],
      operatorTokens: async () => ({
        kind: 'operator',
        id: 'op1',
        scope: { backend: null, tenant: null },
        claims: {},
        roles: [],
        memberships: [],
        via: 'test.operator',
        ref: null,
        expiresAt: expiry,
      }),
      tenantEntry: async (entered) => {
        entries.push(entered);
        return undefined;
      },
      directory: {
        ...directory,
        tenant: async (id) => {
          lookups.push(id);
          return directory.tenant(id);
        },
      },
    });
    const outcome = await invoker.open({
      transport: 'test',
      host: 'operator.example',
      headers: {
        authorization: 'Bearer kwo_abc_secret',
        'x-keelwerk-tenant': marker,
      },
    });
    expect(failureOf(outcome)).toMatchObject(generic);
    expect(lookups).toEqual([]);
    expect(entries).toEqual([]);
  });
});
