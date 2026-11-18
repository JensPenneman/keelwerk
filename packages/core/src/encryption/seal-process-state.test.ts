import { describe, expect, test } from 'vitest';
import type { DataKey } from '../storage/data-key.ts';
import { openProcessState } from './open-process-state.ts';
import { openProcessSubject } from './open-process-subject.ts';
import { sealProcessState } from './seal-process-state.ts';
import type { SealingContext } from './sealing-context.ts';

const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
const streamId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a20';
const eventId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a21';
const state = JSON.stringify({ count: 3, notes: ['grandmother Ada'] });
const dataKey: DataKey = { id: 'dk-1', material: new Uint8Array(32).fill(7) };

const contextOf = (keys: { readonly shredded: boolean }) => {
  const asked: unknown[] = [];
  const context = {
    unit: {
      namespace: { id: 'ns-1' },
      keys: {
        dataKey: (id: string, options: unknown) => {
          asked.push([id, options]);
          return Promise.resolve(keys.shredded ? undefined : dataKey);
        },
      },
    },
    random: (bytes: number) => new Uint8Array(bytes).fill(1),
    keyById: (id: string) =>
      Promise.resolve(id === dataKey.id && !keys.shredded ? dataKey : undefined),
  } as unknown as SealingContext;
  return { context, asked };
};

describe('the sealed state of a process cache', () => {
  // WP-130: $kwe 2 pads the plaintext (S8); the envelope and every hash over it were regenerated.
  test('golden: the same envelope under a fixed key and nonce, and it opens to the state', async () => {
    const { context, asked } = contextOf({ shredded: false });
    const sealed = await sealProcessState(context, { streamId, eventId, subject, state });
    // namespace, stream id, event id and the field name `$state` are the associated data: a change
    // to that mapping changes this envelope, and every cache would read as unopenable.
    expect(sealed).toEqual({
      $kwe: 2,
      k: 'dk-1',
      n: 'AQEBAQEBAQEBAQEB',
      c: expect.any(String),
    });
    expect(sealed?.c).toBe(
      'DcPq2OXRmCzr5_ADHlgEVNvZLq868ElyNlUuDRLcU8ni82zRvk74AF5ySAvBfu6ZjhvpAl2-_1-iQqcI1iKFlXSLFu7Flh_9KHvGLCt-vzo',
    );
    // The key is never created for a cache.
    expect(asked).toEqual([[subject, { create: false }]]);
    if (sealed === null) throw new Error('the state was not sealed');
    expect(await openProcessState(context, { streamId, eventId, sealed })).toBe(state);
    expect(JSON.stringify(sealed)).not.toContain('grandmother');
  });

  test('it opens only for its own stream and event', async () => {
    const { context } = contextOf({ shredded: false });
    const sealed = await sealProcessState(context, { streamId, eventId, subject, state });
    if (sealed === null) throw new Error('the state was not sealed');
    expect(await openProcessState(context, { streamId: eventId, eventId, sealed })).toBeUndefined();
    expect(
      await openProcessState(context, { streamId, eventId: streamId, sealed }),
    ).toBeUndefined();
  });

  test('a state does not open as a subject, and a subject does not open as a state', async () => {
    const { context } = contextOf({ shredded: false });
    const sealed = await sealProcessState(context, { streamId, eventId, subject, state });
    if (sealed === null) throw new Error('the state was not sealed');
    expect(await openProcessSubject(context, { streamId, eventId, sealed })).toBeUndefined();
  });

  test('a shredded key opens nothing, and sealing for an erased subject answers null', async () => {
    const sealed = await sealProcessState(contextOf({ shredded: false }).context, {
      streamId,
      eventId,
      subject,
      state,
    });
    if (sealed === null) throw new Error('the state was not sealed');
    const erased = contextOf({ shredded: true }).context;
    expect(await sealProcessState(erased, { streamId, eventId, subject, state })).toBeNull();
    expect(await openProcessState(erased, { streamId, eventId, sealed })).toBeUndefined();
  });
});
