import { describe, expect, test } from 'vitest';
import { clipText } from '../src/lib/clip-text.ts';
import { recordEvent } from '../src/reactions/record-event.ts';

/** `react` as the kernel calls it: the reaction part carries the function. */
const react = (
  recordEvent as unknown as {
    spec: { react: (event: unknown, ctx: unknown) => Generator };
  }
).spec.react;

function run(event: object, scope: object): unknown {
  // What a load or an id request is to `yield*`: an iterable that ends at once with its answer.
  const done = (value: unknown) => ({
    [Symbol.iterator]: () => ({ next: () => ({ done: true as const, value }) }),
  });
  const ctx = {
    scope,
    load: { audit: { entry: { one: () => done(undefined) } } },
    newId: () => done('aud-1'),
    write: { audit: { entry: { create: (values: unknown) => values } } },
  };
  const generator = react(event, ctx);
  const step = generator.next();
  if (step.done !== true) throw new Error('the reaction asked for something the fake lacks');
  return step.value;
}

const tenant = { level: 'tenant', backendId: 'b', tenantId: 't' };
const baseEvent = {
  id: 'e-1',
  type: 'notes.note.created',
  stream: { type: 'notes.note', id: 's-1' },
  version: 1,
  at: Temporal.Instant.from('2026-11-19T09:00:00Z'),
  actor: { kind: 'user', id: 'someone', via: 'v' },
  commandId: 'c-1',
  causationId: null,
  action: 'notes.note.create',
  subject: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a21',
  request: { transport: 'http', remoteAddress: '203.0.113.7', userAgent: 'x'.repeat(1000) },
};

describe('recording an event', () => {
  test('an event of a backend decides nothing', () => {
    expect(run(baseEvent, { level: 'backend', backendId: 'b' })).toEqual([]);
  });

  test('a long user agent is clipped to 512 code points', () => {
    const [created] = run(baseEvent, tenant) as { userAgent: string }[];
    expect([...String(created?.userAgent)]).toHaveLength(512);
    const clipped = clipText('😀'.repeat(600), 512);
    expect([...clipped]).toHaveLength(512);
    expect(clipped.isWellFormed()).toBe(true);
    expect(clipText('short', 512)).toBe('short');
  });

  test('a user actor id never reaches the entry, and request metadata needs a subject', () => {
    const [kept] = run(baseEvent, tenant) as Record<string, unknown>[];
    expect(kept).not.toHaveProperty('actorId');
    const [bare] = run({ ...baseEvent, subject: null }, tenant) as Record<string, unknown>[];
    expect(bare).toMatchObject({ transport: 'http' });
    expect(bare).not.toHaveProperty('remoteAddress');
    expect(bare).not.toHaveProperty('userAgent');
    const [service] = run(
      { ...baseEvent, subject: null, actor: { kind: 'service', id: 'svc', via: 'v' } },
      tenant,
    ) as Record<string, unknown>[];
    expect(service).toMatchObject({ actorKind: 'service', actorId: 'svc' });
  });
});
