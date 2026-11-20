import type { InvocationSession, Outcome } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { quietHub } from './support/quiet-hub.ts';
import { type StreamHost, streamHost } from './support/stream-host.ts';
import { userSession } from './support/user-session.ts';

const hosts: StreamHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

const revalidateMs = 5_000;

/** Opens the subscription of a session whose check is `revalidate`, moves the clock by `steps`, and answers the whole body. */
async function ended(
  revalidate: () => Promise<Outcome<InvocationSession>>,
  steps: readonly number[],
): Promise<string> {
  const state = { open: 0 };
  const made = streamHost(quietHub(state), {
    host: { liveSocket: { revalidateMs } },
    session: userSession('ada', { revalidate }),
  });
  hosts.push(made);
  const response = await made.open();
  expect(response.status).toBe(200);
  const text = response.text();
  for (const step of steps) {
    await made.at(step);
    await made.at(step);
  }
  const body = await text;
  await vi.waitFor(() => expect(state.open).toBe(0));
  return body;
}

describe('the host ends a subscribe stream whose session check', () => {
  test('answers a retired version with an end event version_retired and no error event', async () => {
    const text = await ended(
      async () => ({ ok: false, error: coreError('core.api_version_retired') }),
      [revalidateMs],
    );
    expect(text.match(/^event: end$/gm)).toHaveLength(1);
    expect(text).toContain('version_retired');
    expect(text).not.toMatch(/^event: error$/m);
  });

  test('renews into another subject: one error event core.unauthenticated', async () => {
    const text = await ended(async () => ({ ok: true, value: userSession('bob') }), [revalidateMs]);
    expect(text.match(/^event: error$/gm)).toHaveLength(1);
    expect(text).toContain('core.unauthenticated');
    expect(text).not.toMatch(/^event: data$/m);
  });

  test('does not answer within one interval: one error event core.unavailable', async () => {
    const text = await ended(
      () => new Promise<Outcome<InvocationSession>>(() => undefined),
      [revalidateMs, 2 * revalidateMs],
    );
    expect(text.match(/^event: error$/gm)).toHaveLength(1);
    expect(text).toContain('core.unavailable');
  });
});
