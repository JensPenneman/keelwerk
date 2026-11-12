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
