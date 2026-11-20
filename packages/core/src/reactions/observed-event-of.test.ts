import { describe, expect, test, vi } from 'vitest';
import { noteEvent, reactionRegistry } from '../../test/reaction-kit.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { observedEventOf } from './observed-event-of.ts';

const registry = reactionRegistry();
const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a99';
const request = { transport: 'http', remoteAddress: '203.0.113.7', userAgent: 'agent/1' };
/** The actor of a request that comes from a data subject: the observer then gets the whole request. */
const person = { actor: { kind: 'user', id: subject, via: 'auth.session' } } as const;

interface Fixture {
  readonly receipt?: Partial<Receipt> | undefined;
  readonly row?: Partial<StorageRow> | undefined;
  readonly shredded?: boolean;
}

/** A unit that answers the three reads the helper makes. */
function unitOf(fixture: Fixture = {}) {
  const dataKey = vi.fn(() =>
    Promise.resolve(
      fixture.shredded === true ? undefined : { id: 'key-1', material: new Uint8Array() },
    ),
  );
  const receiptsGet = vi.fn(() =>
    Promise.resolve(
      fixture.receipt === undefined
        ? undefined
        : ({ action: 'logs.write', request, ...fixture.receipt } as Receipt),
    ),
  );
  const findOne = vi.fn(() => Promise.resolve(fixture.row as StorageRow | undefined));
  const unit = {
    receipts: { get: receiptsGet },
    keys: { dataKey },
    rows: { findOne },
  } as unknown as Unit;
  return { unit, dataKey, receiptsGet, findOne };
}

const asyncEvent = (stored = noteEvent()) =>
  ({
    id: stored.eventId,
    type: stored.type,
    stream: stored.stream,
    version: stored.version,
    position: stored.position,
    data: {},
    before: null,
    actor: stored.actor,
    commandId: stored.commandId,
    causationId: stored.causationId,
    at: stored.recordedAt,
    current: undefined,
  }) as never;

async function observe(fixture: Fixture, over: Parameters<typeof noteEvent>[0] = {}) {
  const stored = noteEvent(over);
  const made = unitOf(fixture);
  const observed = await observedEventOf(made.unit, registry, stored, asyncEvent(stored));
  return { observed, ...made };
}

describe('the event an observer receives', () => {
  test("the request is the receipt's when its action is the event's", async () => {
    const { observed } = await observe({ receipt: {} }, person);
    expect(observed?.action).toBe('logs.write');
    expect(observed?.request).toEqual(request);
  });

  test('the address and the agent reach the observer only with a subject; the transport stays', async () => {
    const withoutAddress = { transport: 'http', remoteAddress: null, userAgent: null };
    const receipt = { receipt: {} };
    // A user actor still gets both.
    expect((await observe(receipt, person)).observed?.request).toEqual(request);
    // An operator command, a service call and a system event name no subject.
    for (const kind of ['operator', 'service', 'system'] as const) {
      const run = await observe(receipt, { actor: { kind, id: subject, via: 'v' } });
      expect(run.observed?.subject).toBeNull();
      expect(run.observed?.request).toEqual(withoutAddress);
    }
    // An anonymous actor whose row names no data subject, and an entity that has none.
    const anonymous = { actor: { kind: 'anonymous', id: null, via: 'auth.login' } } as const;
    const noRow = await observe(receipt, anonymous);
    expect(noRow.observed?.subject).toBeNull();
    expect(noRow.observed?.request).toEqual(withoutAddress);
    const noSubject = await observe(receipt, {
      ...anonymous,
      stream: { type: 'logs.entry', id: 'x' },
    });
    expect(noSubject.observed?.subject).toBeNull();
    expect(noSubject.observed?.request).toEqual(withoutAddress);
    // An anonymous actor whose row names a subject keeps both.
    const named = await observe({ ...receipt, row: { id: 'x', owner: subject } }, anonymous);
    expect(named.observed?.request).toEqual(request);
    // No receipt kept: still null.
    expect(
      (await observe({}, { actor: { kind: 'operator', id: null, via: 'v' } })).observed?.request,
    ).toBeNull();
  });

  test("another action's receipt, a missing receipt and no command id give no request", async () => {
    expect(
      (await observe({ receipt: { action: 'logs.other' } }, person)).observed?.request,
    ).toBeNull();
    expect((await observe({}, person)).observed?.request).toBeNull();
    const none = await observe({ receipt: {} }, { ...person, commandId: null, action: null });
    expect(none.observed?.request).toBeNull();
    expect(none.receiptsGet).not.toHaveBeenCalled();
  });

  test('a user actor gives its subject, canonical', async () => {
    const upper = subject.toUpperCase().replaceAll('-', '');
    const { observed } = await observe(
      {},
      { actor: { kind: 'user', id: upper, via: 'auth.session' } },
    );
    expect(observed?.subject).toBe(subject);
  });

  test('an anonymous actor gives the data subject of the row, an erased row no event', async () => {
    const anonymous = { actor: { kind: 'anonymous', id: null, via: 'auth.login' } } as const;
    const live = await observe({ row: { id: 'x', owner: subject } }, anonymous);
    expect(live.observed?.subject).toBe(subject);
    expect(live.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeArchived: true }),
    );
    const erased = await observe(
      {
        row: { id: 'x', owner: subject, kwErasedAt: Temporal.Instant.from('2026-03-02T00:00:00Z') },
      },
      anonymous,
    );
    expect(erased.observed).toBeUndefined();
    expect(erased.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeErased: true }),
    );
    expect((await observe({}, anonymous)).observed?.subject).toBeNull();
  });

  test('a service or operator actor, a backend event and a text that is no subject give none', async () => {
    for (const kind of ['service', 'operator', 'system'] as const) {
      const run = await observe({}, { actor: { kind, id: subject, via: 'v' } });
      expect(run.observed?.subject).toBeNull();
    }
    const backend = await observe(
      {},
      {
        scope: { level: 'backend', backendId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01' },
        actor: { kind: 'user', id: subject, via: 'auth.session' },
      },
    );
    expect(backend.observed?.subject).toBeNull();
    const text = await observe({}, { actor: { kind: 'user', id: 'ada', via: 'auth.session' } });
    expect(text.observed?.subject).toBeNull();
    expect(text.dataKey).not.toHaveBeenCalled();
  });

  test('a shredded subject answers undefined and a live one is read with create', async () => {
    const live = await observe({}, { actor: { kind: 'user', id: subject, via: 'auth.session' } });
    expect(live.dataKey).toHaveBeenCalledWith(subject, { create: true });
    const shredded = await observe(
      { shredded: true },
      { actor: { kind: 'user', id: subject, via: 'auth.session' } },
    );
    expect(shredded.observed).toBeUndefined();
  });
});
