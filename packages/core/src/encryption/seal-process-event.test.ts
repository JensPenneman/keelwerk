import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { DataKey } from '../storage/data-key.ts';
import { openPersonalValues } from './open-personal-values.ts';
import { sealProcessEvent } from './seal-process-event.ts';
import type { SealingContext } from './sealing-context.ts';

const noted = shape({
  note: field.string().personal(),
  tags: field.list(field.string().personal()),
  n: field.integer(),
});
const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
const streamId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a20';
const eventId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a21';
const dataKey: DataKey = { id: 'dk-1', material: new Uint8Array(32).fill(7) };
const refs: { subject: string; refs: unknown }[] = [];

const context = {
  unit: {
    namespace: { id: 'ns-1' },
    keys: {
      addRefs: (who: string, added: unknown) => {
        refs.push({ subject: who, refs: added });
        return Promise.resolve();
      },
    },
  },
  random: (bytes: number) => new Uint8Array(bytes).fill(1),
  dataKey: () => Promise.resolve(dataKey),
  keyById: (id: string) => Promise.resolve(id === dataKey.id ? dataKey : undefined),
} as unknown as SealingContext;

const input = (data: Record<string, unknown>, over: { subject?: string } = {}) => ({
  ref: 'logs.tally',
  shape: noted,
  streamId,
  eventId,
  subject: over.subject ?? subject,
  data,
});

describe('sealing the personal members of a process event', () => {
  test('golden: a personal member is the same envelope under a fixed key and nonce', async () => {
    refs.length = 0;
    const sealed = await sealProcessEvent(context, input({ note: 'ada@example.com', n: 1 }));
    // namespace ‖ stream id ‖ event id ‖ member is the associated data: a change to that mapping
    // changes this envelope, and every stored process event would read as absent.
    expect(sealed).toEqual({
      note: {
        $kwe: 1,
        k: 'dk-1',
        n: 'AQEBAQEBAQEBAQEB',
        c: 'VIDt1tDalG-8pLBEXlQfXIoyZSlDgBthP3DdZj9hmRIY',
      },
      n: 1,
    });
    expect(refs).toEqual([{ subject, refs: [{ type: 'logs.tally', id: streamId }] }]);
  });

  test('a personal list is sealed whole, an absent member is not, and a plain event is unchanged', async () => {
    refs.length = 0;
    const sealed = await sealProcessEvent(context, input({ tags: ['a', 'b'], n: 2 }));
    expect(sealed.tags).toMatchObject({ $kwe: 1, k: 'dk-1' });
    expect(sealed.note).toBeUndefined();
    refs.length = 0;
    expect(await sealProcessEvent(context, input({ n: 3 }))).toEqual({ n: 3 });
    expect(refs).toEqual([]);
  });

  test('a subject that is no UUID is a validation error', async () => {
    await expect(
      sealProcessEvent(context, input({ note: 'x', n: 1 }, { subject: 'ada' })),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  test('the sealed member opens under its own stream, event and member name only', async () => {
    const sealed = await sealProcessEvent(context, input({ note: 'ada@example.com', n: 1 }));
    const event = (over: object) =>
      ({
        eventId,
        stream: { type: 'logs.tally', id: streamId },
        data: sealed,
        before: null,
        ...over,
      }) as never;
    const open = async (over: object) =>
      (await openPersonalValues(context, event(over), 'drop')).data;
    expect(await open({})).toEqual({ note: 'ada@example.com', n: 1 });
    expect(await open({ eventId: 'moved' })).toEqual({ n: 1 });
    expect(await open({ stream: { type: 'logs.tally', id: 'moved' } })).toEqual({ n: 1 });
  });

  test('a shredded subject key leaves the member absent from the stream as a reader sees it', async () => {
    const sealed = await sealProcessEvent(context, input({ note: 'ada@example.com', n: 1 }));
    const shredded = {
      ...context,
      keyById: () => Promise.resolve(undefined),
    } as unknown as SealingContext;
    const event = {
      eventId,
      stream: { type: 'logs.tally', id: streamId },
      data: sealed,
      before: null,
    } as never;
    expect((await openPersonalValues(shredded, event, 'drop')).data).toEqual({ n: 1 });
  });
});
