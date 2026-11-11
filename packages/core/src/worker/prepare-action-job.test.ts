import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { Unit } from '../storage/unit.ts';
import { prepareActionJob } from './prepare-action-job.ts';
import type { QueueSource } from './queue-source.ts';

const commandId = '0198a1e0-0000-8000-8000-0000000000c1';
const stored = {
  scope: { level: 'deployment' },
  principal: { resolver: 'core.module', principalId: 'courier.system' },
  causation: {},
} as unknown as StoredJob;

const deliver = {
  ref: 'courier.deliver',
  module: 'courier',
  output: shape({ token: field.secret(), status: field.integer() }),
} as unknown as EffectEntry;

function sourceOf(action: Partial<ActionEntry>): QueueSource {
  const entry = { ref: 'courier.record', input: shape({}), ...action } as unknown as ActionEntry;
  const unit = { receipts: { get: () => Promise.resolve(undefined) } } as unknown as Unit;
  return {
    namespace: { id: 'main' },
    handle: {
      adapter: { unit: (_ns: unknown, _scope: unknown, fn: (u: Unit) => unknown) => fn(unit) },
    },
    registry: {
      actions: new Map([[entry.ref, entry]]),
      effects: new Map([[deliver.ref, deliver]]),
    },
  } as unknown as QueueSource;
}

function prepared(action: Partial<ActionEntry>, input: unknown) {
  return prepareActionJob(sourceOf(action), stored, {
    action: 'courier.record',
    input,
    commandId,
  });
}

const succeeded = { outcome: { ok: true, value: { token: 'kwv1.k.n.c', status: 200 } }, id: 'd1' };

describe('the input of a continuation (outcomeEffect)', () => {
  test('an output secret reaches the continuation as a reference stamped for the effect module', async () => {
    const { input } = await prepared({ outcomeEffect: 'courier.deliver' }, succeeded);
    const outcome = (input as { outcome: { value: { token: unknown; status: number } } }).outcome;
    expect(outcome.value.token).toEqual({ ref: 'kwv1.k.n.c' });
    expect(Reflect.get(outcome.value.token as object, secretRefOwner)).toBe('courier');
    expect(outcome.value.status).toBe(200);
    expect((input as { id: string }).id).toBe('d1');
  });

  test('without outcomeEffect the secret stays the text it was stored as', async () => {
    const { input } = await prepared({}, succeeded);
    expect((input as typeof succeeded).outcome.value.token).toBe('kwv1.k.n.c');
  });

  test('a failed outcome passes unchanged', async () => {
    const failed = { outcome: { ok: false, error: { code: 'core.unavailable', message: 'x' } } };
    const { input } = await prepared({ outcomeEffect: 'courier.deliver' }, failed);
    expect(input).toEqual(failed);
  });
});
