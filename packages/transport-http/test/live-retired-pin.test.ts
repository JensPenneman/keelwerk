import { sendCall } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { connectKitSocket } from './support/connect-kit-socket.ts';
import { deprecatedStreamApp, deprecatedVersions } from './support/deprecated-stream-app.ts';
import { startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// Two days after the sunset of the older version, and before any operator retired it: the first
// tenant is still pinned to it.
const clock = { now: () => Temporal.Instant.from('2026-12-03T10:00:00Z') };
const { older, head } = deprecatedVersions;
const kit = await startStreamRuntime(
  { listen: { port: 0 } },
  { app: deprecatedStreamApp, clock, tenantApiVersions: { acme: older } },
);
afterAll(() => kit.runtime.stop());
const watch = { action: 'loans.loanEvents', input: {} };

describe('a stream whose pin is retired and whose request names no version (18.3, 18.5)', () => {
  test('an SSE stream opened without a version header is served under the target of the pin', async () => {
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      ...watch,
      caller: { subject: 'ada' },
    });
    try {
      const seen = await stream?.until((frame) => frame.event === 'head');
      expect(seen?.map((frame) => frame.event)).toEqual(['welcome', 'head']);
      expect(seen?.[0]?.data).toMatchObject({ apiVersion: head });
    } finally {
      await stream?.close();
    }
  });

  test('a socket whose hello names no version is served under the target of the pin', async () => {
    const client = await connectKitSocket(kit, 'ada');
    try {
      expect(await client.next()).toMatchObject({ type: 'welcome', apiVersion: head });
    } finally {
      await client.close();
    }
  });

  test('the retired version in the header of the request is refused 410, with the same pin', async () => {
    const asked = await sendCall(kit.target, {
      ...watch,
      caller: { subject: 'ada', headers: { 'keelwerk-version': older } },
    });
    expect(asked.response.status).toBe(410);
    const unnamed = await sendCall(kit.target, { ...watch, caller: { subject: 'ada' } });
    expect(unnamed.response.status).not.toBe(410);
    expect(unnamed.response.headers.get('keelwerk-version')).toBe(head);
  });
});
