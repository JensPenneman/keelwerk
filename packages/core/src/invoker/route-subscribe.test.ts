import { describe, expect, test, vi } from 'vitest';
import {
  actionOf,
  callOf,
  carrier,
  invokerOf,
  registryOf,
  signedIn,
  withResolver,
} from '../../test/invoker/invoker-kit.ts';
import {
  fakeHub,
  feed,
  head,
  itemFrame,
  leaf,
  streamFailure,
  withHub,
} from '../../test/invoker/live-kit.ts';
import type { StateToken } from '../events/state-token.ts';
import { shape } from '../fields/shape.ts';
import { liveKernelOf } from '../live/live-kernel-of.ts';
import { encodeStateToken } from '../tokens/encode-state-token.ts';
import { tokenScopePart } from '../tokens/token-scope-part.ts';
import type { InvocationDecision } from './decision-hook.ts';

/** The order in which the kernel's prepare and the hub were reached, and the decisions. */
const order: string[] = [];

/** How many kernels the setup made. */
const kernelsMade = { count: 0 };

vi.mock('./create-live-kernel.ts', async (original) => {
  const real = await original<typeof import('./create-live-kernel.ts')>();
  return {
    createLiveKernel: (...args: Parameters<typeof real.createLiveKernel>) => {
      kernelsMade.count += 1;
      const kernel = real.createLiveKernel(...args);
      return {
        ...kernel,
        prepare: async (...prepareArgs: Parameters<typeof kernel.prepare>) => {
          order.push('prepare');
          return kernel.prepare(...prepareArgs);
        },
      };
    },
  };
});

describe('invoker.subscribe', () => {
  test('without a hub subscribe answers core.live_unavailable at execute, and a refused caller gets forbidden at authorize first', async () => {
    const decisions: InvocationDecision[] = [];
    const guarded = actionOf('doc.guarded', {
      ...feed,
      ref: 'doc.guarded',
      name: 'guarded',
      auth: 'policy',
    });
    const invoker = invokerOf(withResolver(registryOf([feed, guarded])), {
      onDecision: (decision) => decisions.push(decision),
    });
    const refused = await streamFailure(
      invoker.subscribe(callOf('doc.guarded', {}, { carrier: signedIn })),
    );
    expect(refused).toMatchObject({ kind: 'forbidden' });
    expect(decisions.at(-1)).toMatchObject({ stage: 'authorize' });
    const error = await streamFailure(invoker.subscribe(callOf('doc.feed', {}, { carrier })));
    expect(error).toMatchObject({ kind: 'unavailable', code: 'core.live_unavailable' });
    expect(decisions.at(-1)).toMatchObject({ stage: 'execute' });
  });

  test('a gate refusal throws forbidden and the hub is never called', async () => {
    const guarded = actionOf('doc.feed', { ...feed, auth: 'policy' });
    const { hub, calls } = fakeHub([head]);
    const invoker = withHub(hub, [guarded]);
    const error = await streamFailure(
      invoker.subscribe(callOf('doc.feed', {}, { carrier: signedIn })),
    );
    expect(error).toMatchObject({ kind: 'forbidden' });
    expect(calls).toHaveLength(0);
  });

  test('the decision hook gets kind subscribe once', async () => {
    const decisions: InvocationDecision[] = [];
    const { hub } = fakeHub([head, itemFrame(1)]);
    const invoker = withHub(hub, [feed], { onDecision: (decision) => decisions.push(decision) });
    const iterator = invoker.subscribe(callOf('doc.feed', {}, { carrier }))[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      kind: 'subscribe',
      action: 'doc.feed',
      stage: 'complete',
    });
    await iterator.return?.();
  });

  test('the decision is complete after the view was built and before the first frame', async () => {
    order.length = 0;
    const decisions: InvocationDecision[] = [];
    const { hub } = fakeHub([], () => order.push('hub'));
    const invoker = withHub(hub, [feed], {
      onDecision: (decision) => {
        order.push('decision');
        decisions.push(decision);
      },
    });
    const iterator = invoker.subscribe(callOf('doc.feed', {}, { carrier }))[Symbol.asyncIterator]();
    // The hub never yields, so this `next()` stays pending: the decision is complete without a frame.
    const pending = iterator.next();
    await vi.waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]).toMatchObject({ kind: 'subscribe', stage: 'complete' });
    expect(order).toEqual(['prepare', 'hub', 'decision']);
    await iterator.return?.();
    void pending;
  });

  test('the setup and the view of a subscription each wait for fresh targeting, as an invoke does', async () => {
    const fresh = vi.fn(async () => undefined);
    const { hub } = fakeHub([head]);
    const invoker = withHub(hub, [feed], { targeting: { fresh } });
    const iterator = invoker.subscribe(callOf('doc.feed', {}, { carrier }))[Symbol.asyncIterator]();
    await iterator.next();
    // One snapshot for the gate of the setup and one for the view the kernel builds.
    expect(fresh).toHaveBeenCalledTimes(2);
    await iterator.return?.();
  });

  test('a hidden-field filter is forbidden at stage execute, no complete, the hub is never called', async () => {
    const decisions: InvocationDecision[] = [];
    const filtered = actionOf('doc.feed', {
      ...feed,
      handler: () => leaf(undefined, { hidden: 'x' }),
    });
    const { hub, calls } = fakeHub([head]);
    const invoker = withHub(hub, [filtered], { onDecision: (d) => decisions.push(d) });
    const error = await streamFailure(invoker.subscribe(callOf('doc.feed', {}, { carrier })));
    expect(error).toMatchObject({ kind: 'forbidden' });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ stage: 'execute' });
    expect(calls).toHaveLength(0);
  });

  test('a malformed resume token is core.malformed_request at execute', async () => {
    const decisions: InvocationDecision[] = [];
    const { hub, calls } = fakeHub([head]);
    const invoker = withHub(hub, [feed], { onDecision: (d) => decisions.push(d) });
    const error = await streamFailure(
      invoker.subscribe(callOf('doc.feed', {}, { carrier }), { after: 'garbage' as StateToken }),
    );
    expect(error).toMatchObject({ kind: 'validation', code: 'core.malformed_request' });
    expect(decisions[0]).toMatchObject({ stage: 'execute' });
    expect(calls).toHaveLength(0);
  });

  test("another tenant's token is core.token_scope_mismatch at execute", async () => {
    const decisions: InvocationDecision[] = [];
    const { hub, calls } = fakeHub([head]);
    const invoker = withHub(hub, [feed], { onDecision: (d) => decisions.push(d) });
    const foreign = encodeStateToken(
      {
        epoch: 0,
        position: 1n,
        scope: tokenScopePart({ level: 'tenant', backendId: 'b1', tenantId: 'other' }),
        check: '00000000',
      },
      new Uint8Array(32),
    );
    const error = await streamFailure(
      invoker.subscribe(callOf('doc.feed', {}, { carrier }), { after: foreign }),
    );
    expect(error).toMatchObject({ kind: 'validation', code: 'core.token_scope_mismatch' });
    expect(decisions[0]).toMatchObject({ stage: 'execute' });
    expect(calls).toHaveLength(0);
  });

  test('a query action is unsupported at locate', async () => {
    const decisions: InvocationDecision[] = [];
    const reading = actionOf('doc.read', { kind: 'query', auth: 'public', input: shape({}) });
    const { hub, calls } = fakeHub([head]);
    const invoker = withHub(hub, [reading], { onDecision: (d) => decisions.push(d) });
    const error = await streamFailure(invoker.subscribe(callOf('doc.read', {}, { carrier })));
    expect(error).toMatchObject({ kind: 'unsupported', code: 'core.unsupported' });
    expect(decisions[0]).toMatchObject({ stage: 'locate' });
    expect(calls).toHaveLength(0);
  });

  test('a generator map is not_implemented', async () => {
    const mapped = actionOf('doc.feed', {
      ...feed,
      handler: () => ({
        kind: 'liveSource',
        source: leaf(),
        map: function* () {
          yield 1;
        },
      }),
    });
    const { hub } = fakeHub([itemFrame(1)]);
    const error = await streamFailure(
      withHub(hub, [mapped]).subscribe(callOf('doc.feed', {}, { carrier })),
    );
    expect(error).toMatchObject({ kind: 'not_implemented', code: 'core.not_implemented' });
  });

  test('maps are applied innermost first and a dropped item goes with its state', async () => {
    const mapped = actionOf('doc.feed', {
      ...feed,
      handler: () => ({
        kind: 'liveSource',
        source: {
          kind: 'liveSource',
          source: leaf(),
          map: (one: { n: number }) => ({ n: one.n + 1 }),
        },
        map: (one: { n: number }) => (one.n === 3 ? undefined : { n: one.n * 10 }),
      }),
    });
    const { hub } = fakeHub([head, itemFrame(1), itemFrame(2)]);
    const iterator = withHub(hub, [mapped])
      .subscribe(callOf('doc.feed', {}, { carrier }))
      [Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ value: head });
    expect(await iterator.next()).toMatchObject({ value: { event: { n: 20 } } });
    await iterator.return?.();
  });

  test('resume.after reaches source and hub', async () => {
    const seen: unknown[] = [];
    const resumable = actionOf('doc.feed', {
      ...feed,
      handler: (_input: unknown, _ctx: unknown, resume: unknown) => {
        seen.push(resume);
        return leaf(resume);
      },
    });
    const { hub, calls } = fakeHub([head]);
    const after = encodeStateToken(
      {
        epoch: 0,
        position: 7n,
        scope: tokenScopePart({ level: 'tenant', backendId: 'b1', tenantId: 't1' }),
        check: '00000000',
      },
      new Uint8Array(32),
    );
    const iterator = withHub(hub, [resumable])
      .subscribe(callOf('doc.feed', {}, { carrier }), { after })
      [Symbol.asyncIterator]();
    await iterator.next();
    expect(seen).toEqual([after]);
    expect(calls[0]?.[0]).toBeDefined();
    expect(calls[0]?.slice(1, 2)).toEqual(['doc.post']);
    expect(calls[0]?.[3]).toBe(after);
    await iterator.return?.();
  });

  test('a deployment-scope subscription is unsupported at locate', async () => {
    const decisions: InvocationDecision[] = [];
    const wide = actionOf('doc.feed', { ...feed, scope: 'invocation' });
    const { hub, calls } = fakeHub([head]);
    const error = await streamFailure(
      withHub(hub, [wide], { onDecision: (d) => decisions.push(d) }).subscribe(
        callOf('doc.feed', {}, { carrier: { transport: 'test', local: { socket: 'x' } } }),
      ),
    );
    expect(error).toMatchObject({ kind: 'unsupported', code: 'core.unsupported' });
    expect(decisions[0]).toMatchObject({ stage: 'locate' });
    expect(calls).toHaveLength(0);
  });

  test('an aborted inv.signal returns the hub iterator', async () => {
    const { hub, returned } = fakeHub([head]);
    const controller = new AbortController();
    const iterator = withHub(hub)
      .subscribe(callOf('doc.feed', {}, { carrier, signal: controller.signal }))
      [Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await vi.waitFor(() => expect(returned).toHaveBeenCalledOnce());
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  test('the kernel the setup prepares is the one the hub is served by: one for each entity of the session', async () => {
    kernelsMade.count = 0;
    const { hub, calls } = fakeHub([head]);
    const iterator = withHub(hub)
      .subscribe(callOf('doc.feed', {}, { carrier }))
      [Symbol.asyncIterator]();
    await iterator.next();
    const [session, entity, input] = calls[0] ?? [];
    const kernel = liveKernelOf(session as never, entity as string);
    expect(liveKernelOf(session as never, entity as string)).toBe(kernel);
    expect(kernelsMade.count).toBe(1);
    // The view the setup built is waiting for the hub's own `view` of the same input.
    const prepared = await kernel.view(session as never, input as never);
    const second = await kernel.view(session as never, input as never);
    expect(second).not.toBe(prepared);
    await iterator.return?.();
  });

  test('each invoker subscribes through the hub of its own InvokerApp', async () => {
    const first = fakeHub([head]);
    const second = fakeHub([head]);
    const one = withHub(first.hub);
    const two = withHub(second.hub);
    const [a, b] = [one, two].map((invoker) =>
      invoker.subscribe(callOf('doc.feed', {}, { carrier }))[Symbol.asyncIterator](),
    );
    await a?.next();
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    await b?.next();
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
    await a?.return?.();
    await b?.return?.();
  });
});
