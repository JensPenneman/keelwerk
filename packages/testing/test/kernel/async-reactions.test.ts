import type { StoredJobSpec } from '@keelwerk/core';
import { kernelCommandId, reactionJob, reactionsInModuleOrder } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import {
  bootReactions,
  reactionsStart,
  relayOwner,
  tenantEventsOf,
} from './support/reactions-kit.ts';
import { relayControl } from './support/relay-control.ts';

const kit = await bootReactions({ watched: true, env: {} });
afterAll(() => kit.stop());
const { runtime } = kit;

const signalIdOf = (outcome: Awaited<ReturnType<typeof kit.send>>): string => {
  if (!outcome.ok) throw outcome.error;
  return outcome.value.signalId;
};
const echoesOf = async (reaction: string, tenant: 'acme' | 'globex' = 'acme') =>
  (await kit.rows(tenant, 'relay.echo')).filter((row) => row.reaction === reaction);

describe('async reactions', () => {
  test('a signal is answered by an echo row of every reaction that listens, each once', async () => {
    const id = signalIdOf(await kit.send('acme', { channel: 'news' }));
    await kit.settle();
    const rows = (await kit.rows('acme', 'relay.echo')).filter((row) => row.signal === id);
    expect(rows.map((row) => row.reaction).sort()).toEqual([
      'relay.echo',
      'relay.flaky',
      'relay.latest',
      'relay.note',
      'relay.ordered',
      'relay.tally',
    ]);
    // Nothing leaks to the other tenant.
    expect(await kit.rows('globex', 'relay.echo')).toEqual([]);
  });

  test('FIFO keeps the jobs of one key in event order', async () => {
    relayControl.decided.length = 0;
    const many = await kit.call<{ signalIds: string[] }>('acme', 'relay.sendMany', {
      channel: 'fifo',
      texts: ['a', 'b', 'c', 'd'],
      owner: relayOwner,
    });
    if (!many.ok) throw many.error;
    await kit.settle();
    expect(relayControl.decided.filter((line) => line.startsWith('relay.ordered:'))).toEqual(
      many.value.signalIds.map((id) => `relay.ordered:${id}`),
    );
  });

  test('coalesce replaces a pending job of the same key: only the newest event is decided', async () => {
    relayControl.decided.length = 0;
    const many = await kit.call<{ signalIds: string[] }>('acme', 'relay.sendMany', {
      channel: 'latest',
      texts: ['a', 'b', 'c'],
      owner: relayOwner,
    });
    if (!many.ok) throw many.error;
    await kit.settle();
    const last = many.value.signalIds.at(-1);
    expect(relayControl.decided.filter((line) => line.startsWith('relay.latest:'))).toEqual([
      `relay.latest:${last}`,
    ]);
    expect((await echoesOf('relay.latest')).filter((row) => row.channel === 'latest')).toHaveLength(
      1,
    );
  });

  test('the reaction writes as its module service principal, caused by the event and its actor', async () => {
    const id = signalIdOf(await kit.send('acme', { channel: 'cause' }));
    await kit.settle();
    const events = await tenantEventsOf(kit, 'acme');
    const created = events.find(
      (event) => event.type === 'relay.signal.created' && event.stream.id === id,
    );
    if (created === undefined) throw new Error('the signal event is missing');
    const echoes = (await echoesOf('relay.echo')).filter((row) => row.signal === id);
    const written = events.filter(
      (event) => event.type === 'relay.echo.created' && event.stream.id === echoes[0]?.id,
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      actor: { kind: 'service', id: 'relay.system', via: 'core.module' },
      causationId: created.eventId,
      action: 'relay.echo',
    });
    // The command id is the idempotency key of (reaction, event), in the form only the kernel makes.
    expect(written[0]?.commandId).toBe(kernelCommandId('reaction', 'relay.echo', created.eventId));
  });

  test('a command a reaction invokes is caused by the event, not by the reaction command', async () => {
    const id = signalIdOf(await kit.send('acme', { channel: 'nested' }));
    await kit.settle();
    const events = await tenantEventsOf(kit, 'acme');
    const created = events.find(
      (event) => event.type === 'relay.signal.created' && event.stream.id === id,
    );
    const note = (await echoesOf('relay.note')).find((row) => row.signal === id);
    const noteEvent = events.find(
      (event) => event.type === 'relay.echo.created' && event.stream.id === note?.id,
    );
    expect(noteEvent?.causationId).toBe(created?.eventId);
    expect(noteEvent?.actor).toMatchObject({ id: 'relay.system' });
  });

  test('current is the row when the job runs, not the one of the event', async () => {
    const drafted = await kit.call<{ signalId: string }>('acme', 'relay.draft', {
      channel: 'late',
      owner: relayOwner,
    });
    if (!drafted.ok) throw drafted.error;
    await kit.settle();
    const echo = (await echoesOf('relay.echo')).find(
      (row) => row.signal === drafted.value.signalId,
    );
    expect(echo?.seenText).toBe('second');
  });

  test('a second job for one (reaction, event) replays the receipt and writes nothing', async () => {
    const id = signalIdOf(await kit.send('acme', { channel: 'twice' }));
    await kit.settle();
    const before = await kit.rows('acme', 'relay.echo');
    const events = await tenantEventsOf(kit, 'acme');
    const created = events.find(
      (event) => event.type === 'relay.signal.created' && event.stream.id === id,
    );
    const reaction = reactionsInModuleOrder(runtime.app.registry, 'async').find(
      (one) => one.id === 'relay.echo',
    );
    if (created === undefined || reaction === undefined) throw new Error('fixture is incomplete');
    const spec = reactionJob({
      reaction,
      event: created,
      declaredKey: undefined,
      build: { id: 'test-build', revision: 1 },
      now: kit.now(),
    });
    await runtime.adapter.unit(runtime.namespace, kit.scopeOf('acme'), async (unit) => {
      await unit.jobs.enqueue({
        ...spec,
        kind: 'action',
        laneCap: 4,
        createdAt: kit.now(),
      } satisfies StoredJobSpec);
    });
    const completions = kit.spy?.completions.length ?? 0;
    await kit.settle();
    expect(await kit.rows('acme', 'relay.echo')).toHaveLength(before.length);
    expect(kit.spy?.completions.slice(completions).map((one) => one.outcome.kind)).toEqual([
      'succeeded',
    ]);
  });

  test('a reaction that fails for good is a dead letter with the closed error, and its follower still runs', async () => {
    const many = await kit.call<{ signalIds: string[] }>('acme', 'relay.sendMany', {
      channel: 'dead',
      texts: ['bad', 'fine'],
      owner: relayOwner,
    });
    if (!many.ok) throw many.error;
    const completions = kit.spy?.completions.length ?? 0;
    await kit.settle();
    const [badId, fineId] = many.value.signalIds;
    const outcomes = kit.spy?.completions.slice(completions) ?? [];
    const dead = outcomes.find((one) => one.outcome.kind === 'dead');
    expect(dead?.outcome).toMatchObject({
      kind: 'dead',
      error: {
        kind: 'validation',
        code: 'core.validation',
        message: 'The reaction failed with core.validation.',
        retryable: false,
        requestId: '',
      },
    });
    expect(JSON.stringify(dead?.outcome)).not.toContain('ada@example.com');
    const ordered = await echoesOf('relay.ordered');
    expect(ordered.some((row) => row.signal === badId)).toBe(false);
    expect(ordered.some((row) => row.signal === fineId)).toBe(true);
  });

  test('a dead reaction job decided nothing, so its replay decides once, and a further replay writes nothing', async () => {
    const many = await kit.call<{ signalIds: string[] }>('acme', 'relay.sendMany', {
      channel: 'revive',
      texts: ['bad'],
      owner: relayOwner,
    });
    if (!many.ok) throw many.error;
    const [badId] = many.value.signalIds;
    const completions = kit.spy?.completions.length ?? 0;
    await kit.settle();
    expect(
      kit.spy?.completions.slice(completions).filter((one) => one.outcome.kind === 'dead'),
    ).toHaveLength(1);
    const answered = async () =>
      (await echoesOf('relay.ordered')).filter((row) => row.signal === badId).length;
    expect(await answered()).toBe(0);

    const created = (await tenantEventsOf(kit, 'acme')).find(
      (event) => event.type === 'relay.signal.created' && event.stream.id === badId,
    );
    const reaction = reactionsInModuleOrder(runtime.app.registry, 'async').find(
      (one) => one.id === 'relay.ordered',
    );
    if (created === undefined || reaction === undefined) throw new Error('fixture is incomplete');
    const replay = async () => {
      const spec = reactionJob({
        reaction,
        event: created,
        declaredKey: 'revive',
        build: { id: 'test-build', revision: 1 },
        now: kit.now(),
      });
      await runtime.adapter.unit(runtime.namespace, kit.scopeOf('acme'), async (unit) => {
        await unit.jobs.enqueue({
          ...spec,
          kind: 'action',
          laneCap: 4,
          createdAt: kit.now(),
        } satisfies StoredJobSpec);
      });
      await kit.settle();
    };
    relayControl.fixed = true;
    try {
      await replay();
      expect(await answered()).toBe(1);
      const eventsAfter = (await tenantEventsOf(kit, 'acme')).length;
      await replay();
      expect(await answered()).toBe(1);
      expect((await tenantEventsOf(kit, 'acme')).length).toBe(eventsAfter);
    } finally {
      relayControl.fixed = false;
    }
  });

  test('a gated action reads the flag value when the job runs, not when the event was written', async () => {
    const env = {} as Record<string, string | undefined>;
    const gatedKit = await bootReactions({ env, watched: true });
    try {
      const id = signalIdOf(await gatedKit.send('acme', { channel: 'gate' }));
      await gatedKit.settle();
      // Attempt 1 failed with unavailable; the gate was closed when the signal was written and is open for the retry.
      expect(
        (await gatedKit.rows('acme', 'relay.echo')).some((row) => row.reaction === 'relay.gated'),
      ).toBe(false);
      env.KEELWERK_FLAG_RELAY_OPEN = 'true';
      await gatedKit.advanceTo(gatedKit.now().add({ minutes: 1 }));
      const gated = (await gatedKit.rows('acme', 'relay.echo')).filter(
        (row) => row.reaction === 'relay.gated',
      );
      expect(gated.map((row) => row.signal)).toEqual([id]);
    } finally {
      await gatedKit.stop();
    }
  });

  test("another module's reaction sees the same of an event as of a row, an async reaction as an inline one", async () => {
    // Sections 6.6 and 7.7: a hidden member is absent from other modules' rows and from `before`, and
    // the one rule (`fieldWithheldFrom`) decides it for rows and for event payloads, for inline and
    // async reactions alike. The relay module owns `internalNote`; `watch` is another module.
    await kit.send('acme', {
      channel: 'view',
      contact: 'ada@example.com',
      internalNote: 'private',
    });
    await kit.settle();
    const seen = (await kit.rows('acme', 'watch.seen')).filter((row) =>
      String(row.data).includes('"contactLength":15'),
    );
    const asyncView = seen.find((row) => row.kind === 'async');
    const inlineView = seen.find((row) => row.kind === 'inline');
    const keys = (row: { keys?: unknown } | undefined): string[] =>
      JSON.parse(String(row?.keys)) as string[];
    expect(keys(asyncView)).toEqual(keys(inlineView));
    expect(keys(asyncView)).toContain('contact');
    expect(keys(asyncView)).not.toContain('internalNote');
    // The payload is the same for both: personal values opened (15 characters), the hidden member absent.
    expect(asyncView?.data).toBe(inlineView?.data);
    expect(JSON.parse(String(asyncView?.data))).toMatchObject({
      contactLength: 15,
      internalNote: 'absent',
    });
  });

  test('a clock that has not moved leaves the start where the kit put it', () => {
    expect(kit.now().epochMilliseconds).toBeGreaterThanOrEqual(reactionsStart.epochMilliseconds);
  });
});
