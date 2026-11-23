import type { AdmissionVerdict } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bootSlice, callAs, setFreshLimit, sliceApp } from './support/quota-slice-kit.ts';

// The slot of the deployment-wide count of invocations that `admit` takes before the admission rules:
// a refusal by a rule gives it back. The deployment is the in-memory runtime with its own counter and
// its own quota cache; acme's limit is one invocation in flight, set through `core.quota.set`, and
// the rule is a fill of `core.invocationMiddleware`. What decides each case is the answer of the
// call that follows: a slot that stayed taken leaves the count at the limit, and the next request
// is refused with core.concurrency_limited. Nothing waits for a time or a background task.

/** An admission rule that refuses a request whose text is `no` and charges nothing for the others. */
const rule = (admission: { readonly input: unknown }): AdmissionVerdict =>
  (admission.input as { text?: string }).text === 'no'
    ? { kind: 'refuse', error: errors.forbidden('The rule refuses this request.') }
    : { kind: 'charge', demand: { admit: [], onDeclaredError: [] } };

const point = 'core.invocationMiddleware';
const app = {
  ...sliceApp,
  registry: {
    ...sliceApp.registry,
    fills: new Map([
      ...sliceApp.registry.fills,
      [
        point,
        [
          ...(sliceApp.registry.fills.get(point) ?? []),
          { point, module: 'slice', bound: false, fill: rule },
        ],
      ],
    ]),
  },
} as typeof sliceApp;

describe('the slot of an invocation that the admission rules refuse', () => {
  test('is given back at once: the next request at the limit is admitted, and each ended request frees its slot', async () => {
    const runtime = await bootSlice({ app });
    const limit = await setFreshLimit(
      runtime,
      runtime.tenants.acme.id,
      'core.concurrentInvocations',
      '1',
    );
    expect(limit.ok).toBe(true);
    const ask = (text: string) => callAs(runtime, 'acme', 'slice.add', { text });
    expect(await ask('no')).toMatchObject({ ok: false, error: { code: 'core.forbidden' } });
    expect(await ask('yes')).toMatchObject({ ok: true });
    expect(await ask('no')).toMatchObject({ ok: false, error: { code: 'core.forbidden' } });
    expect(await ask('yes')).toMatchObject({ ok: true });
    // No slot stayed taken by the two refused requests nor by the admitted ones: one more is admitted.
    expect(await ask('again')).toMatchObject({ ok: true });
  });
});
