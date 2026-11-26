import type { InvocationSession } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { createStreamLimits } from '../src/create-stream-limits.ts';
import { fakeSession } from './support/fake-session.ts';

const bounds = { perPrincipal: 2, perTenant: 10, perTenantAnonymous: 4, total: 100 };

const asUser = (subject: string): InvocationSession =>
  fakeSession({
    principal: {
      kind: 'user',
      subject,
      subjectRef: null,
      subjectAs: () => null,
      scope: { backend: 'b1', tenant: 't1' },
      claims: {},
      roles: [],
      memberships: [],
      via: 'test',
      ref: { resolver: 'test', principalId: subject },
    } as never,
  });

describe('the stream limits of a host', () => {
  test('a user is counted per principal, whatever the address', () => {
    const limits = createStreamLimits(bounds);
    limits.take(asUser('ada'), '10.0.0.1');
    limits.take(asUser('ada'), '10.0.0.2');
    expect(() => limits.take(asUser('ada'), '10.0.0.3')).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    expect(() => limits.take(asUser('bob'), '10.0.0.1')).not.toThrow();
  });

  test('anonymous callers are counted per address, so one client cannot lock the others out', () => {
    const limits = createStreamLimits(bounds);
    const anonymous = fakeSession();
    limits.take(anonymous, '203.0.113.7');
    limits.take(anonymous, '203.0.113.7');
    expect(() => limits.take(anonymous, '203.0.113.7')).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    expect(() => limits.take(anonymous, '203.0.113.8')).not.toThrow();
  });

  test('anonymous streams from many addresses stop at the tenant aggregate, and a user still gets in', () => {
    const limits = createStreamLimits(bounds);
    const anonymous = fakeSession();
    for (let address = 1; address <= 4; address += 1)
      limits.take(anonymous, `203.0.113.${address}`);
    expect(() => limits.take(anonymous, '203.0.113.99')).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    expect(() => limits.take(asUser('ada'), '203.0.113.99')).not.toThrow();
    expect(() => limits.take(asUser('ada'), '203.0.113.99')).not.toThrow();
  });

  test('the aggregate gets its count back on release', () => {
    const limits = createStreamLimits(bounds);
    const releases = [1, 2, 3, 4].map((n) => limits.take(fakeSession(), `203.0.113.${n}`));
    expect(() => limits.take(fakeSession(), '203.0.113.9')).toThrow();
    releases[0]?.();
    expect(() => limits.take(fakeSession(), '203.0.113.9')).not.toThrow();
  });

  test('the addresses of one IPv6 network are one client', () => {
    const limits = createStreamLimits(bounds);
    const anonymous = fakeSession();
    limits.take(anonymous, '2001:db8:1:2::1');
    limits.take(anonymous, '2001:0DB8:1:2:ffff:ffff:ffff:ffff');
    expect(() => limits.take(anonymous, '2001:db8:1:2:0:0:0:9')).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    expect(() => limits.take(anonymous, '2001:db8:1:3::1')).not.toThrow();
  });

  test('a release gives the count back once', () => {
    const limits = createStreamLimits(bounds);
    const release = limits.take(fakeSession(), '203.0.113.7');
    limits.take(fakeSession(), '203.0.113.7');
    release();
    release();
    limits.take(fakeSession(), '203.0.113.7');
    expect(() => limits.take(fakeSession(), '203.0.113.7')).toThrow();
  });
});

describe('the subscriptions of a socket', () => {
  test('count against the tenant and the process, not against a principal', () => {
    const limits = createStreamLimits({ ...bounds, perPrincipal: 1, perTenant: 3 });
    const ada = asUser('ada');
    limits.take(ada, '10.0.0.1');
    limits.takeSubscription(ada, '10.0.0.1');
    limits.takeSubscription(ada, '10.0.0.1');
    expect(() => limits.takeSubscription(ada, '10.0.0.1')).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    expect(() => limits.take(asUser('bob'), '10.0.0.1')).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
  });

  test('of an anonymous session count against the anonymous bound, and give the count back once', () => {
    const limits = createStreamLimits({ ...bounds, perPrincipal: 100, perTenantAnonymous: 2 });
    const anonymous = fakeSession();
    const release = limits.takeSubscription(anonymous, '10.0.0.1');
    limits.takeSubscription(anonymous, '10.0.0.1');
    expect(() => limits.takeSubscription(anonymous, '10.0.0.1')).toThrow();
    release();
    release();
    limits.takeSubscription(anonymous, '10.0.0.1');
    expect(() => limits.takeSubscription(anonymous, '10.0.0.1')).toThrow();
    expect(() => limits.takeSubscription(asUser('ada'), '10.0.0.1')).not.toThrow();
  });

  test('of an anonymous session count against its address, shared with its streams', () => {
    const limits = createStreamLimits({ ...bounds, perPrincipal: 3, perTenantAnonymous: 50 });
    limits.take(fakeSession(), '203.0.113.7');
    limits.takeSubscription(fakeSession(), '203.0.113.7');
    limits.takeSubscription(fakeSession(), '203.0.113.7');
    expect(() => limits.takeSubscription(fakeSession(), '203.0.113.7')).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    expect(() => limits.take(fakeSession(), '203.0.113.7')).toThrow();
    expect(() => limits.takeSubscription(fakeSession(), '203.0.113.8')).not.toThrow();
  });
});

/** A pending socket: ends itself when asked (`ended` counts the asks that were answered true) unless it has said who it is. */
function waiting(waits = true) {
  const socket = {
    ended: 0,
    said: !waits,
    evict: () => {
      if (socket.said) return false;
      socket.ended += 1;
      return true;
    },
  };
  return socket;
}

describe('the sockets that have not said who they are', () => {
  test('count against their address and a count of their own, never against the tenant', () => {
    const limits = createStreamLimits({ ...bounds, perTenantAnonymous: 1, perTenant: 1, total: 3 });
    const anonymous = fakeSession();
    const first = limits.takePending(anonymous, '203.0.113.7', waiting(false).evict);
    limits.takePending(anonymous, '203.0.113.7', waiting(false).evict);
    // The address is at its bound, shared with the streams of that address.
    expect(() => limits.takePending(anonymous, '203.0.113.7', waiting().evict)).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    expect(() => limits.take(anonymous, '203.0.113.7')).toThrow();
    // The tenant's bounds hold none of them: a user and another address are let in.
    expect(() => limits.take(asUser('ada'), '203.0.113.9')).not.toThrow();
    limits.takePending(anonymous, '203.0.113.8', waiting(false).evict);
    // The count of the process is the host's total; every socket in it has said who it is, none can be ended.
    expect(() => limits.takePending(anonymous, '203.0.113.9', waiting().evict)).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    first();
    first();
    expect(() => limits.takePending(anonymous, '203.0.113.9', waiting().evict)).not.toThrow();
  });

  test('a full count ends the oldest waiting socket and admits the new one, in the order they came', () => {
    const limits = createStreamLimits({ ...bounds, total: 3 });
    const anonymous = fakeSession();
    const sockets = ['1', '2', '3', '4', '5'].map(() => waiting());
    const releases = sockets
      .slice(0, 3)
      .map((socket, at) => limits.takePending(anonymous, `203.0.113.${at}`, socket.evict));
    expect(releases).toHaveLength(3);
    limits.takePending(anonymous, '203.0.113.3', sockets[3]?.evict ?? waiting().evict);
    expect(sockets.map((socket) => socket.ended)).toEqual([1, 0, 0, 0, 0]);
    limits.takePending(anonymous, '203.0.113.4', sockets[4]?.evict ?? waiting().evict);
    expect(sockets.map((socket) => socket.ended)).toEqual([1, 1, 0, 0, 0]);
  });

  test('never end a socket that has said who it is: the oldest one that still waits goes', () => {
    const limits = createStreamLimits({ ...bounds, total: 2 });
    const anonymous = fakeSession();
    const said = waiting(false);
    const second = waiting();
    limits.takePending(anonymous, '203.0.113.1', said.evict);
    limits.takePending(anonymous, '203.0.113.2', second.evict);
    limits.takePending(anonymous, '203.0.113.3', waiting().evict);
    expect([said.ended, second.ended]).toEqual([0, 1]);
  });

  test('an address at its own bound is refused and ends nobody', () => {
    const limits = createStreamLimits({ ...bounds, perPrincipal: 2, total: 2 });
    const anonymous = fakeSession();
    const sockets = [waiting(), waiting()];
    for (const socket of sockets) limits.takePending(anonymous, '203.0.113.1', socket.evict);
    expect(() => limits.takePending(anonymous, '203.0.113.1', waiting().evict)).toThrow(
      expect.objectContaining({ code: 'core.quota_exceeded' }),
    );
    expect(sockets.map((socket) => socket.ended)).toEqual([0, 0]);
  });

  test('an ended socket gives its place back once: its own release afterwards frees nothing more', () => {
    const limits = createStreamLimits({ ...bounds, total: 2 });
    const anonymous = fakeSession();
    const [first, second] = [waiting(), waiting()];
    const releaseFirst = limits.takePending(anonymous, '203.0.113.1', first.evict);
    limits.takePending(anonymous, '203.0.113.2', second.evict);
    limits.takePending(anonymous, '203.0.113.3', waiting().evict);
    releaseFirst();
    releaseFirst();
    // Still full: the next one ends the second, the oldest left.
    limits.takePending(anonymous, '203.0.113.4', waiting().evict);
    expect([first.ended, second.ended]).toEqual([1, 1]);
  });

  test('sockets that leave, by any release, leave a count of zero: a full count of new ones ends nobody', () => {
    const limits = createStreamLimits({ ...bounds, total: 3 });
    const anonymous = fakeSession();
    const first = [waiting(), waiting(), waiting()];
    const held = first.map((socket, at) =>
      limits.takePending(anonymous, `203.0.113.${at}`, socket.evict),
    );
    // A release twice, and the others once: closed, failed, refused and aborted sockets all end in it.
    held[0]?.();
    held[0]?.();
    held[1]?.();
    held[2]?.();
    const second = [waiting(), waiting(), waiting()];
    second.forEach((socket, at) => {
      limits.takePending(anonymous, `203.0.113.${at}`, socket.evict);
    });
    expect([...first, ...second].map((socket) => socket.ended)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
