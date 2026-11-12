import { pinnedLiveTimers, sendCall } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { connectKitSocket } from './support/connect-kit-socket.ts';
import { deprecatedStreamApp, deprecatedVersions } from './support/deprecated-stream-app.ts';
import { startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let now = Temporal.Instant.from('2026-11-12T10:00:00Z');
const clock = { now: () => now };
const timers = pinnedLiveTimers(clock);
// Only the hub's revalidation interval is faked: the tests step its tick by hand, with no real wait.
vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
const kit = await startStreamRuntime(
  { listen: { port: 0 } },
  { app: deprecatedStreamApp, clock, timers },
);
afterAll(() => kit.runtime.stop());

const { older } = deprecatedVersions;
const watch = { action: 'loans.loanEvents', input: {} };
const versionNotice = {
  type: 'notice',
  notice: { kind: 'deprecation', apiVersion: older, at: '2026-11-05', sunset: '2026-12-01' },
};
const actionNotice = {
  type: 'notice',
  notice: { kind: 'deprecation', action: 'chores.oldPing', at: '2026-11-05', sunset: '2026-12-01' },
};

/** Moves the clock and fires the waits until `done` holds (the hub and the socket revalidate on timers). */
async function pass(seconds: number, done: () => boolean): Promise<void> {
  now = now.add({ seconds });
  await vi.waitFor(
    async () => {
      await timers.fire();
      expect(done()).toBe(true);
    },
    { timeout: 20_000 },
  );
}

describe('deprecation over the live carriers (15.4.6, 18.5)', () => {
  test('an SSE stream at a deprecated version opens with welcome, then one notice', async () => {
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      ...watch,
      caller: { subject: 'ada', headers: { 'keelwerk-version': older } },
    });
    try {
      const seen = await stream?.until((frame) => frame.event === 'head');
      expect(seen?.map((frame) => frame.event)).toEqual(['welcome', 'notice', 'head']);
      expect(seen?.[1]?.data).toEqual(versionNotice.notice);
    } finally {
      await stream?.close();
    }
  });

  test('a socket at a deprecated version gets the notice after welcome', async () => {
    const client = await connectKitSocket(kit, 'ada', { apiVersion: older });
    try {
      expect(await client.next()).toMatchObject({ type: 'welcome', apiVersion: older });
      expect(await client.next()).toEqual(versionNotice);
    } finally {
      await client.close();
    }
  });

  test('the first invoke of a deprecated action over a socket sends one action notice, the second none', async () => {
    const client = await connectKitSocket(kit, 'ada', { apiVersion: deprecatedVersions.head });
    try {
      await client.next();
      const invoke = (id: string) =>
        client.send({ type: 'invoke', id, request: { action: 'chores.oldPing', input: {} } });
      invoke('a');
      const first = await client.until((message) => message.type === 'result');
      expect(first.map((message) => message.type)).toEqual(['notice', 'result']);
      expect(first[0]).toEqual(actionNotice);
      invoke('b');
      const second = await client.until((message) => message.type === 'result');
      expect(second.map((message) => message.type)).toEqual(['result']);
    } finally {
      await client.close();
    }
  });

  test('an SSE stream of a deprecated subscription at the head opens with welcome, the action notice, then head', async () => {
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      action: 'chores.oldWatch',
      input: {},
      caller: { subject: 'ada', headers: { 'keelwerk-version': deprecatedVersions.head } },
    });
    try {
      const seen = await stream?.until((frame) => frame.event === 'head');
      expect(seen?.map((frame) => frame.event)).toEqual(['welcome', 'notice', 'head']);
      expect(seen?.[1]?.data).toEqual({ ...actionNotice.notice, action: 'chores.oldWatch' });
    } finally {
      await stream?.close();
    }
  });

  test('an SSE stream of a subscription deprecated without a date opens with welcome, a notice without at, then head', async () => {
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      action: 'chores.quietWatch',
      input: {},
      caller: { subject: 'ada', headers: { 'keelwerk-version': deprecatedVersions.head } },
    });
    try {
      const seen = await stream?.until((frame) => frame.event === 'head');
      expect(seen?.map((frame) => frame.event)).toEqual(['welcome', 'notice', 'head']);
      expect(seen?.[1]?.data).toEqual({ kind: 'deprecation', action: 'chores.quietWatch' });
    } finally {
      await stream?.close();
    }
  });

  test('a socket subscription to a deprecated subscription gets the action notice before its head', async () => {
    const client = await connectKitSocket(kit, 'ada', { apiVersion: deprecatedVersions.head });
    try {
      await client.next();
      client.send({ type: 'subscribe', id: 'w1', action: 'chores.oldWatch', input: {} });
      const seen = await client.until((message) => message.type === 'head');
      expect(seen.map((message) => message.type)).toEqual(['notice', 'head']);
      expect(seen[0]).toEqual({
        ...actionNotice,
        notice: { ...actionNotice.notice, action: 'chores.oldWatch' },
      });
    } finally {
      await client.close();
    }
  });

  test('an SSE notice names the action as the version of the request knows it, not by its head name', async () => {
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      action: 'chores.oldStream',
      input: {},
      caller: { subject: 'ada', headers: { 'keelwerk-version': older } },
    });
    try {
      const seen = await stream?.until((frame) => frame.event === 'head');
      expect(seen?.map((frame) => frame.event)).toEqual(['welcome', 'notice', 'notice', 'head']);
      expect(seen?.[1]?.data).toEqual(versionNotice.notice);
      expect(seen?.[2]?.data).toEqual({ ...actionNotice.notice, action: 'chores.oldStream' });
    } finally {
      await stream?.close();
    }
  });

  test('a socket notice names the action as the version of the hello knows it, not by its head name', async () => {
    const client = await connectKitSocket(kit, 'ada', { apiVersion: older });
    try {
      await client.next();
      await client.next();
      client.send({ type: 'subscribe', id: 'r1', action: 'chores.oldStream', input: {} });
      const seen = await client.until((message) => message.type === 'head');
      expect(seen.map((message) => message.type)).toEqual(['notice', 'head']);
      expect(seen[0]).toEqual({
        ...actionNotice,
        notice: { ...actionNotice.notice, action: 'chores.oldStream' },
      });
    } finally {
      await client.close();
    }
  });

  test('a generated watch at a deprecated version opens with welcome, the version notice, then head', async () => {
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      action: 'chores.chore.watch',
      input: {},
      caller: { subject: 'ada', headers: { 'keelwerk-version': older } },
    });
    try {
      const seen = await stream?.until((frame) => frame.event === 'head');
      expect(seen?.map((frame) => frame.event)).toEqual(['welcome', 'notice', 'head']);
      expect(seen?.[1]?.data).toEqual(versionNotice.notice);
    } finally {
      await stream?.close();
    }
  });

  test('past the sunset an SSE stream ends with end version_retired, never error', async () => {
    now = Temporal.Instant.from('2026-12-01T23:50:00Z');
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      ...watch,
      caller: { subject: 'ada', headers: { 'keelwerk-version': older } },
    });
    try {
      await stream?.until((frame) => frame.event === 'head');
      // The first tick only notes when the stream was last checked; the second, after the clock moved on, finds it due.
      vi.advanceTimersByTime(1_000);
      now = now.add({ seconds: 20 * 60 });
      vi.advanceTimersByTime(1_000);
      await timers.fire();
      const frames = (await stream?.until((frame) => frame.event === 'end')) ?? [];
      expect(frames.map((frame) => frame.event)).not.toContain('error');
      expect(frames.at(-1)?.data).toEqual({ reason: 'version_retired' });
    } finally {
      await stream?.close();
    }
  });

  test('past the sunset a generated watch over SSE ends with end version_retired, never error', async () => {
    now = Temporal.Instant.from('2026-12-01T23:50:00Z');
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      action: 'chores.chore.watch',
      input: {},
      caller: { subject: 'ada', headers: { 'keelwerk-version': older } },
    });
    try {
      await stream?.until((frame) => frame.event === 'head');
      vi.advanceTimersByTime(1_000);
      now = now.add({ seconds: 20 * 60 });
      vi.advanceTimersByTime(1_000);
      await timers.fire();
      const frames = (await stream?.until((frame) => frame.event === 'end')) ?? [];
      expect(frames.map((frame) => frame.event)).not.toContain('error');
      expect(frames.at(-1)?.data).toEqual({ reason: 'version_retired' });
    } finally {
      await stream?.close();
    }
  });

  test('past the sunset each socket subscription ends version_retired and the socket closes 1000 version_retired', async () => {
    now = Temporal.Instant.from('2026-12-01T23:50:00Z');
    const client = await connectKitSocket(kit, 'ada', { apiVersion: older });
    try {
      await client.next();
      await client.next();
      client.send({ type: 'subscribe', id: 's1', ...watch });
      client.send({ type: 'subscribe', id: 's2', ...watch });
      await client.until((message) => message.type === 'head');
      await client.until((message) => message.type === 'head');
      const seen: { type: string; id?: string; reason?: string }[] = [];
      const reader = (async () => {
        for (;;) {
          const message = await client.next(20_000);
          seen.push(message as never);
          if (seen.filter((entry) => entry.type === 'end').length === 2) return;
        }
      })();
      await pass(20 * 60, () => seen.filter((entry) => entry.type === 'end').length === 2);
      await reader;
      expect(seen.filter((entry) => entry.type === 'error')).toEqual([]);
      expect(
        seen
          .filter((entry) => entry.type === 'end')
          .map((entry) => [entry.id, entry.reason])
          .sort(),
      ).toEqual([
        ['s1', 'version_retired'],
        ['s2', 'version_retired'],
      ]);
      expect(await client.closed).toEqual({ code: 1000, reason: 'version_retired' });
    } finally {
      await client.close();
    }
  });

  test('a hello at a retired version is refused with core.api_version_retired, as POST /invoke answers 410', async () => {
    const client = await connectKitSocket(kit, 'ada', { apiVersion: older });
    try {
      expect(await client.next()).toMatchObject({
        type: 'error',
        error: { code: 'core.api_version_retired' },
      });
      expect((await client.closed).code).toBe(4404);
    } finally {
      await client.close();
    }
    const answer = await sendCall(kit.target, {
      action: 'loans.loanEvents',
      input: {},
      caller: { subject: 'ada', headers: { 'keelwerk-version': older } },
    });
    expect(answer.response.status).toBe(410);
  });
});
