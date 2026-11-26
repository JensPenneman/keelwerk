import { describe, expect, test } from 'vitest';
import { ruleEntry } from '../../test/authorization/fixtures.ts';
import {
  actionOf,
  callOf,
  carrier,
  failureOf,
  fill,
  invokerOf,
  registryOf,
} from '../../test/invoker/invoker-kit.ts';
import { streamFailure } from '../../test/invoker/live-kit.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import type { Principal } from '../principals/principal.ts';

const service = {
  kind: 'service',
  id: 'doc.svc',
  scope: { backend: 'b1', tenant: 't1' },
  claims: {},
  roles: [],
  memberships: [],
  via: 'test',
  ref: null,
} as unknown as Principal;
const serviceResolver: PrincipalResolver = {
  id: 'doc.bearer',
  describe: () => ({ scheme: 'bearer' }),
  // biome-ignore lint/correctness/useYield: the test resolver loads nothing
  *resolve(from) {
    return from.headers?.authorization === 'Bearer svc' ? { principal: service } : null;
  },
};
const grantsService = ruleEntry({
  id: 'doc.service',
  effect: 'allow',
  subject: { module: 'doc' },
  actions: ['doc.sweep'],
  principal: 'service',
});
const internal = actionOf('doc.sweep', { kind: 'command', principal: ['service'], internal: true });
const registryWith = (entry: ReturnType<typeof actionOf>) =>
  registryOf([entry], {
    rules: new Map([[grantsService.id, grantsService]]),
    fills: new Map([
      ['core.principalResolvers', [fill('core.principalResolvers', serviceResolver)]],
    ]),
  });
const byLink = { ...carrier, local: { inProcess: true } } as const;
const bySocket = { ...carrier, local: { socket: '/run/keelwerk.sock' } } as const;
const byService = { ...carrier, headers: { ...carrier.headers, authorization: 'Bearer svc' } };

/** Limits as the quota cache gives them: a rate for the request rates, a count for the rest. */
function slotsIn(taken: { count: number }) {
  return {
    quotas: {
      fresh: async () => ({
        limitOf: (_registry: unknown, _scope: unknown, ref: string) =>
          /rate/i.test(ref)
            ? { kind: 'rate', capacity: 100, refillPerSecond: 100 }
            : { kind: 'count', value: 5 },
      }),
    },
    // The request rate of the control takes its tokens in a unit: one that always has them.
    placement: () => ({
      adapter: {
        placementId: 'main',
        unit: async (_ns: unknown, _scope: unknown, fn: (unit: object) => Promise<unknown>) =>
          fn({ buckets: { take: async () => ({ ok: true }), check: async () => ({ ok: true }) } }),
      },
    }),
    leases: {
      take: () => {
        taken.count += 1;
        return () => undefined;
      },
    },
  } as never;
}

describe('an internal command is found only by a worker job', () => {
  test.each([
    ['no carrier detail', carrier],
    ['the in-process link', byLink],
    ["the operator's local socket", bySocket],
    ['a service principal that an app rule grants', byService],
  ])(
    '%s: the answer is the answer for an unknown action, word for word, and no slot is taken',
    async (_name, from) => {
      const taken = { count: 0 };
      const invoker = invokerOf(registryWith(internal), slotsIn(taken));
      for (const input of [{ n: 1 }, { n: 'wrong' }]) {
        const hidden = failureOf(
          await invoker.invoke(callOf('doc.sweep', input, { carrier: from })),
        );
        const unknown = failureOf(
          await invoker.invoke(callOf('doc.nothing', input, { carrier: from })),
        );
        const shown = (error: typeof hidden, ref: string) => [
          error.kind,
          error.code,
          error.message.replace(ref, 'REF'),
          error.retryable,
        ];
        expect(shown(hidden, 'doc.sweep')).toEqual(shown(unknown, 'doc.nothing'));
        expect(hidden.code).toBe('core.not_implemented');
        expect(hidden.message).toBe('"doc.sweep" is not an action of this app.');
      }
      expect(taken.count).toBe(0);
    },
  );

  test.each([
    ['no carrier detail', carrier],
    ['a service principal that an app rule grants', byService],
  ])('%s: subscribe answers as for an unknown action too', async (_name, from) => {
    const invoker = invokerOf(registryWith(internal));
    const hidden = await streamFailure(
      invoker.subscribe(callOf('doc.sweep', {}, { carrier: from })),
    );
    const unknown = await streamFailure(
      invoker.subscribe(callOf('doc.nothing', {}, { carrier: from })),
    );
    expect([hidden.kind, hidden.code, hidden.message]).toEqual([
      unknown.kind,
      unknown.code,
      unknown.message.replace('doc.nothing', 'doc.sweep'),
    ]);
    expect(hidden.code).toBe('core.not_implemented');
  });

  test('the same command without the declaration is found: a slot is taken and a malformed input is a validation error', async () => {
    const open = actionOf('doc.sweep', { kind: 'command', principal: ['service'] });
    const taken = { count: 0 };
    const outcome = await invokerOf(registryWith(open), slotsIn(taken)).invoke(
      callOf('doc.sweep', { n: 'wrong' }, { carrier: byService }),
    );
    expect(failureOf(outcome).code).toBe('core.validation');
    expect(taken.count).toBeGreaterThan(0);
  });
});
