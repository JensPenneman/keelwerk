import process from 'node:process';
import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { afterEach, expect, test, vi } from 'vitest';
import { quietHub } from './support/quiet-hub.ts';
import { type StreamHost, streamHost } from './support/stream-host.ts';
import { userSession } from './support/user-session.ts';

const hosts: StreamHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

test('a session already expired at the open gets one error event, no item, a free slot and a released subscription', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const lines: LoggedLine[] = [];
    const state = { open: 0 };
    const made = streamHost(quietHub(state), {
      host: { live: { maxStreamsPerPrincipal: 1 } },
      session: userSession('ada', {
        expiresAt: Temporal.Instant.from('2026-11-11T12:00:00Z').subtract({ milliseconds: 1 }),
      }),
      log: recordingLogger(lines),
    });
    hosts.push(made);
    const response = await made.open();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.match(/^event: error$/gm)).toHaveLength(1);
    expect(text).toContain('core.unauthenticated');
    expect(text).not.toMatch(/^event: data$/m);
    expect(text).not.toMatch(/^event: head$/m);
    await vi.waitFor(() => expect(made.subscribed[0]?.signal.aborted).toBe(true));
    await vi.waitFor(() => expect(state.open).toBe(0));
    expect(made.timers.pending()).toBe(0);
    // The one slot of the principal is free again: a second open is served, not refused with 429.
    const again = await made.open();
    expect(again.status).toBe(200);
    expect(await again.text()).toContain('core.unauthenticated');
    expect(lines.filter((line) => line.message === 'a stream carrier failed')).toEqual([]);
    expect(lines.filter((line) => line.level === 'error')).toEqual([]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
