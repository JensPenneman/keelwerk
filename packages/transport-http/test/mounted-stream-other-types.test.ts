import type { InvocationSession, Outcome } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { describe, expect, test, vi } from 'vitest';
import { drained } from './support/drained.ts';
import { fakeSession } from './support/fake-session.ts';
import { mounted } from './support/mounted-stream.ts';
import { pinnedTime } from './support/pinned-time.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const { start } = pinnedTime();
const encoder = new TextEncoder();
const options = {
  maxDurationMs: 86_400_000,
  revalidateMs: 5_000,
  contentType: 'application/jsonl',
};
const refused: Outcome<InvocationSession> = {
  ok: false,
  error: coreError('core.unauthenticated', { message: 'The key was revoked.' }),
};

/** A route body that the case keeps open: `push` writes a chunk, `close` ends the body. */
function held() {
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  return {
    keep: (controller: ReadableStreamDefaultController<Uint8Array>) => {
      body = controller;
    },
    push: (text: string) => body?.enqueue(encoder.encode(text)),
    close: () => body?.close(),
  };
}

describe('a counted body that is not an event stream, after the end of its session', () => {
  test('finishes its answer within one revalidation interval; nothing is cut', async () => {
    const route = held();
    const session = fakeSession({ expiresAt: start.add({ milliseconds: 10_000 }) });
    const { open, move, ended } = mounted(setup, session, { ...options, keep: route.keep });
    const body = drained(await open());
    await move(10_000);
    route.push('{"answer":1}\n');
    await move(4_999);
    route.push('{"answer":2}\n');
    route.close();
    expect(await body).toBe('data: first\n\n{"answer":1}\n{"answer":2}\n');
    expect(ended()).toEqual([]);
  });

  test('that never ends is cut one revalidation interval after the expiry', async () => {
    const route = held();
    const session = fakeSession({ expiresAt: start.add({ milliseconds: 10_000 }) });
    const { open, move, ended, record } = mounted(setup, session, { ...options, keep: route.keep });
    const body = drained(await open());
    await move(10_000);
    await move(4_999);
    expect(ended()).toEqual([]);
    expect(record.contextSignals[0]?.aborted).toBe(false);
    await move(1);
    await body;
    expect(ended()).toHaveLength(1);
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
    await vi.waitFor(() => expect(record.contextSignals[0]?.aborted).toBe(true));
  });

  test('that never ends is cut one revalidation interval after a failed check', async () => {
    const route = held();
    const session = fakeSession({ revalidate: async () => refused });
    const { open, move, ended } = mounted(setup, session, { ...options, keep: route.keep });
    const body = drained(await open());
    await move(5_000);
    route.push('{"answer":1}\n');
    await move(4_999);
    expect(ended()).toEqual([]);
    await move(1);
    expect(await body).toBe('data: first\n\n{"answer":1}\n');
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
  });
});
