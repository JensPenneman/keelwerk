import { renderTypeId } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { testPrincipalHeader } from '../../src/harness/test-principal-header.ts';
import { dataOfStream } from './support/data-of-stream.ts';
import { dispatchUrl } from './support/dispatch-app.ts';
import { type DispatchRuntime, dispatchRuntime } from './support/dispatch-runtime.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

const secrets = [
  'p-1',
  'north',
  'ada@example.org',
  '$kwe',
  'continuation',
  'dispatch.shipped',
  'commandId',
  'attempts',
  'eventIds',
  'performer',
  'principalResolver',
  'principalId',
  'test.principal',
  'T-secret-tracking',
  'outputDigest',
];

/** The tokens an event stream names: the `id:` line of every block that has one. */
function tokensOf(text: string): readonly string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('id: '))
    .map((line) => line.slice(4));
}

/**
 * A status watch over HTTP that a test reads in steps: `until` reads on to the first place the
 * text, from offset `from`, holds `marker`.
 */
async function openWatch(
  booted: DispatchRuntime,
  ids: readonly string[],
  options: { as?: string; tenant?: DispatchRuntime['acme']; lastEventId?: string } = {},
) {
  const response = await booted.runtime.fetch(
    new Request(
      `${dispatchUrl}/_keelwerk/v1/subscribe?action=core.effectStatusWatch&input=${encodeURIComponent(JSON.stringify({ ids }))}`,
      {
        headers: {
          'x-tenant': (options.tenant ?? booted.acme).id,
          [testPrincipalHeader]: JSON.stringify({
            subject: options.as ?? 'ada',
            roles: [],
            claims: {},
          }),
          ...(options.lastEventId === undefined ? {} : { 'last-event-id': options.lastEventId }),
        },
      },
    ),
  );
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  return {
    status: response.status,
    text: () => text,
    until: async (marker: string, from = 0) => {
      for (let rounds = 0; rounds < 100 && !text.slice(from).includes(marker); rounds += 1) {
        const chunk = await reader?.read();
        if (chunk === undefined || chunk.done) break;
        text += decoder.decode(chunk.value);
      }
      return text;
    },
    close: async () => {
      await reader?.cancel();
    },
  };
}

const settle = (booted: DispatchRuntime, id: string) =>
  booted.call('dispatch.report', { effectId: id, ok: true, tracking: 'T-secret-tracking' });

describe.each(['memory', 'pglite'] as const)('the status watch on %s', (adapter) => {
  const { start } = dispatchRuntime(adapter);
  // A short heartbeat, so that a test can read up to the next ping within a moment.
  const { start: startPinging } = dispatchRuntime(adapter, { heartbeatMs: 200 });

  test("the submitter's watch shows the current status before head and the settle after it, then stays quiet", async () => {
    const booted = await startPinging();
    const { id, outcome } = await booted.sent();
    // The id comes from the command's answer, as a client reads it, and is rendered for the wire.
    const listed = outcome.ok ? outcome.effects?.[0] : undefined;
    expect(listed).toBeDefined();
    expect(listed).toBe(id);
    const wire = renderTypeId('eff', listed ?? '');
    const watch = await openWatch(booted, [wire]);
    const first = await watch.until('event: head');
    const items = dataOfStream(first);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: wire, type: 'dispatch.ship', status: 'requested' });
    expect(first.indexOf('"status":"requested"')).toBeLessThan(first.indexOf('event: head'));
    await settle(booted, id);
    const later = await watch.until('"status":"succeeded"');
    const after = later.slice(first.length);
    expect(dataOfStream(later).map((item) => item.status)).toEqual(['requested', 'succeeded']);
    expect(after).toContain('"status":"succeeded"');
    expect(after).toContain('"settledAt"');
    // Every effect has settled: the stream sends no further data frame, only heartbeats, and does
    // not end.
    const quiet = (await watch.until(': ping', later.length)).slice(later.length);
    await watch.close();
    expect(quiet).toContain(': ping');
    expect(dataOfStream(quiet)).toEqual([]);
  });

  test('a list of ids answers only the caller’s own', async () => {
    const booted = await start();
    const mine = await booted.sent({}, { as: 'ada' });
    const theirs = await booted.sent({ parcel: 'p-2' }, { as: 'bob' });
    const watch = await openWatch(booted, [
      renderTypeId('eff', theirs.id),
      renderTypeId('eff', mine.id),
    ]);
    const text = await watch.until('event: head');
    await watch.close();
    expect(dataOfStream(text).map((item) => item.id)).toEqual([renderTypeId('eff', mine.id)]);
  });

  test('another user, another tenant and an unknown id see head and no item', async () => {
    const booted = await start();
    const { id } = await booted.sent();
    const wire = renderTypeId('eff', id);
    const unknown = renderTypeId('eff', '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e99');
    const cases = [
      openWatch(booted, [wire], { as: 'bob' }),
      openWatch(booted, [wire], { tenant: booted.runtime.tenants.globex }),
      openWatch(booted, [unknown]),
    ];
    for (const opened of await Promise.all(cases)) {
      const text = await opened.until('event: head');
      await opened.close();
      expect(opened.status).toBe(200);
      expect(text).toContain('event: head');
      expect(dataOfStream(text)).toEqual([]);
    }
  });

  test('a reconnect from the last token never skips the settle', async () => {
    const booted = await start();
    const { id } = await booted.sent();
    const wire = renderTypeId('eff', id);
    const first = await openWatch(booted, [wire]);
    const seen = await first.until('event: head');
    await first.close();
    const token = tokensOf(seen).at(-1);
    expect(token).toBeDefined();
    await settle(booted, id);
    const again = await openWatch(booted, [wire], { lastEventId: token ?? '' });
    const text = await again.until('"status":"succeeded"');
    await again.close();
    expect(dataOfStream(text).map((item) => item.status)).toContain('succeeded');
  });

  test('a token of one submitter shows nothing of it to another', async () => {
    const booted = await start();
    const { id } = await booted.sent();
    const wire = renderTypeId('eff', id);
    const own = await openWatch(booted, [wire]);
    const token = tokensOf(await own.until('event: head')).at(-1);
    await own.close();
    await settle(booted, id);
    const other = await openWatch(booted, [wire], { as: 'bob', lastEventId: token ?? '' });
    // The token binds the submitter: another caller is told to start over (`reset`), and is shown nothing of the effect.
    const text = await other.until('event: head');
    await other.close();
    expect(text).toContain('event: reset');
    expect(text).toContain('"reason":"resync"');
    expect(dataOfStream(text)).toEqual([]);
    expect(text).not.toContain('succeeded');
    expect(text).not.toContain(wire);
  });

  test('the wire bytes of an item hold only its members', async () => {
    const booted = await start();
    const { id } = await booted.sent();
    const wire = renderTypeId('eff', id);
    await settle(booted, id);
    const watch = await openWatch(booted, [wire]);
    const text = await watch.until('event: head');
    await watch.close();
    const [item] = dataOfStream(text);
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ['id', 'requestedAt', 'settledAt', 'status', 'type'].sort(),
    );
    for (const secret of secrets) expect(text).not.toContain(secret);
  });

  test('no id or more than 100 ids is refused with validation', async () => {
    const booted = await start();
    const many = Array.from({ length: 101 }, (_, index) =>
      renderTypeId('eff', `0198a2c4-7e10-7a3b-8c5d-${String(index).padStart(12, '0')}`),
    );
    for (const ids of [[], many]) {
      const watch = await openWatch(booted, ids);
      const text = await watch.until('event: error');
      await watch.close();
      expect(text).toContain('event: error');
      expect(text).toContain('"kind":"validation"');
      expect(dataOfStream(text)).toEqual([]);
    }
  });
});
