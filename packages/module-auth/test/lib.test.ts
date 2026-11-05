import { describe, expect, test } from 'vitest';
import { addressBucket } from '../src/lib/address-bucket.ts';
import { sessionCacheKey } from '../src/lib/session-cache-key.ts';

describe('sessionCacheKey', () => {
  test('digests the whole token: one public id with two secrets gives two keys, none showing either', () => {
    const first = sessionCacheKey('kw_ses_abcd1234_secretone');
    const second = sessionCacheKey('kw_ses_abcd1234_secrettwo');
    expect(first).not.toBe(second);
    expect(first + second).not.toMatch(/abcd1234|secret/);
    expect(first).toBe(sessionCacheKey('kw_ses_abcd1234_secretone'));
  });
});

describe('addressBucket', () => {
  test('an IPv4 address is its own bucket', () => {
    expect(addressBucket('203.0.113.7')).toBe('203.0.113.7');
  });

  test('IPv6 addresses of one /64 share a bucket, another /64 does not', () => {
    const one = addressBucket('2001:db8:1:2::1');
    expect(addressBucket('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe(one);
    expect(addressBucket('2001:db8:1:2:aaaa::5')).toBe(one);
    expect(addressBucket('2001:db8:1:3::1')).not.toBe(one);
    expect(one).toBe('2001:db8:1:2::/64');
  });

  test('an IPv4-mapped address counts as the IPv4 address, and a compressed prefix expands', () => {
    expect(addressBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressBucket('::1')).toBe('0:0:0:0::/64');
    expect(addressBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });
});
