import { describe, expect, test } from 'vitest';
import type { DataKey } from '../storage/data-key.ts';
import { openProcessSubject } from './open-process-subject.ts';
import { sealProcessSubject } from './seal-process-subject.ts';
import type { SealingContext } from './sealing-context.ts';

const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
const streamId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a20';
const eventId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a21';
const dataKey: DataKey = { id: 'dk-1', material: new Uint8Array(32).fill(7) };

const contextOf = (keys: { readonly shredded: boolean }) =>
  ({
    unit: {
      namespace: { id: 'ns-1' },
      keys: { dataKey: () => Promise.resolve(keys.shredded ? undefined : dataKey) },
    },
    random: (bytes: number) => new Uint8Array(bytes).fill(1),
    keyById: (id: string) =>
      Promise.resolve(id === dataKey.id && !keys.shredded ? dataKey : undefined),
  }) as unknown as SealingContext;

describe('the sealed subject of a process job', () => {
  test('golden: the same envelope under a fixed key and nonce, and it opens to the subject', async () => {
    const context = contextOf({ shredded: false });
    const sealed = await sealProcessSubject(context, { streamId, eventId, subject });
    // namespace, stream id, event id and the field name `$subject` are the associated data: a change
    // to that mapping changes this envelope, and every queued process job would read as erased.
    expect(sealed).toEqual({
      $kwe: 1,
      k: 'dk-1',
      n: 'AQEBAQEBAQEBAQEB',
      c: 'RtCwgPGOjzz8474SFRpHUpnKOc15og4-a1dxB17QANn20zmCHTg-so5EGnryM_90tliW-g',
    });
    if (sealed === null) throw new Error('the subject was not sealed');
    expect(await openProcessSubject(context, { streamId, eventId, sealed })).toBe(subject);
    expect(JSON.stringify(sealed)).not.toContain(subject);
  });

  test('it opens only for its own stream and event', async () => {
    const context = contextOf({ shredded: false });
    const sealed = await sealProcessSubject(context, { streamId, eventId, subject });
    if (sealed === null) throw new Error('the subject was not sealed');
    expect(
      await openProcessSubject(context, { streamId: eventId, eventId, sealed }),
    ).toBeUndefined();
    expect(
      await openProcessSubject(context, { streamId, eventId: streamId, sealed }),
    ).toBeUndefined();
  });

  test('an erased subject seals to null and a sealed one no longer opens once its keys are destroyed', async () => {
    const sealed = await sealProcessSubject(contextOf({ shredded: false }), {
      streamId,
      eventId,
      subject,
    });
    if (sealed === null) throw new Error('the subject was not sealed');
    const erased = contextOf({ shredded: true });
    expect(await sealProcessSubject(erased, { streamId, eventId, subject })).toBeNull();
    expect(await openProcessSubject(erased, { streamId, eventId, sealed })).toBeUndefined();
  });
});
