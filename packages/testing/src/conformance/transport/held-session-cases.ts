import { expect, test } from 'vitest';
import type { Caller } from './call.ts';
import { freshName } from './fresh-name.ts';
import { liveSocketDialect } from './live-socket-dialect.ts';
import { originOf } from './origin-of.ts';
import { requestHeaders } from './request-headers.ts';
import type { SocketDialect } from './socket-dialect.ts';
import type { TestSocket } from './test-socket.ts';
import type { TransportTarget } from './transport-target.ts';

/**
 * A socket holds the session it was opened with. A session that no longer holds (its subject
 * revoked, as a logout or a deactivated profile does) starts nothing on it (16.3.4): the host's
 * session check runs when a subscription starts, whatever the protocol, and the socket closes 4401
 * as it does for a session that ends. Nothing here reads a clock or waits for a time limit: the
 * refusal is the answer to the subscribe itself, and the close is awaited as an event. Skipped
 * without `target.connect`, `target.live` or `target.revoke`.
 */
export function heldSessionCases(target: TransportTarget): void {
  const skip = target.connect === undefined || target.live !== true || target.revoke === undefined;
  const dialect: SocketDialect = target.codec.socket ?? liveSocketDialect;

  // The credentials the socket is opened with: the test principal header, or the session cookie of a browser
  // (own origin), which the auth module answers as anonymous once it is logged out (16.3.4).
  const held: readonly [string, (subject: string) => Caller][] = [
    ['the credentials of a header', (subject) => ({ subject })],
    ['a session cookie', (subject) => ({ cookie: `user:${subject}` })],
  ];
  test.skipIf(skip).each(held)(
    'a socket held with %s, its session revoked, starts no subscription (a public one included) and closes 4401',
    async (_title, callerOf) => {
      if (target.connect === undefined) throw new Error('The target has no connect hook.');
      const subject = freshName('ada');
      const base = callerOf(subject);
      const caller: Caller = { ...base, origin: originOf(target, base) };
      const headers = requestHeaders(caller);
      headers.set('sec-websocket-protocol', dialect.protocol);
      const result = await target.connect(
        new Request(`${originOf(target, caller)}${dialect.path}`, { headers }),
        { remoteAddress: '203.0.113.96' },
      );
      if (result.kind !== 'open')
        throw new Error(`The upgrade was refused: ${result.response.status}.`);
      const socket: TestSocket = result.socket;
      try {
        await dialect.open(socket);
        target.revoke?.(subject);
        const answer = await dialect.subscribe(socket, 'late').catch(() => 'closed' as const);
        // No head and no item: the subscription is refused, or the socket is already gone.
        expect(answer === 'closed' || answer.kind === 'refused').toBe(true);
        expect(await socket.closed).toMatchObject({ code: 4401 });
      } finally {
        await socket.close();
      }
    },
  );
}
