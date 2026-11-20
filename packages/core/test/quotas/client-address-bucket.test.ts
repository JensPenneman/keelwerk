import { describe, expect, test } from 'vitest';
import { clientAddressBucket } from '../../src/quotas/client-address-bucket.ts';

describe('clientAddressBucket (section 17.2.6)', () => {
  test('an IPv4 address stays as it is', () => {
    expect(clientAddressBucket('203.0.113.7')).toBe('203.0.113.7');
  });

  test('an IPv4-mapped IPv6 address, dotted or hex, is its IPv4 address', () => {
    expect(clientAddressBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddressBucket('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(clientAddressBucket('0:0:0:0:0:ffff:cb00:7107')).toBe('203.0.113.7');
  });

  test('another IPv6 address is its /64 in lower case with no leading zeros', () => {
    expect(clientAddressBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientAddressBucket('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe(
      '2001:db8:1:2::/64',
    );
    expect(clientAddressBucket('::1')).toBe('0:0:0:0::/64');
  });

  test('two hosts of one /64 share a key and two /64s differ, compressed or expanded', () => {
    expect(clientAddressBucket('2001:db8:1:2::1')).toBe(clientAddressBucket('2001:db8:1:2::2'));
    expect(clientAddressBucket('2001:db8:1:2::1')).toBe(
      clientAddressBucket('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'),
    );
    expect(clientAddressBucket('2001:db8:1:2::1')).not.toBe(clientAddressBucket('2001:db8:1:3::1'));
  });

  test('a zone suffix is dropped', () => {
    expect(clientAddressBucket('fe80::1%eth0')).toBe(clientAddressBucket('fe80::2'));
    expect(clientAddressBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  test('text that is no address comes back unchanged', () => {
    for (const text of ['unix:/run/app.sock', 'not-an-address', '', '1:2:3', '1::2::3', 'g::1']) {
      expect(clientAddressBucket(text)).toBe(text);
    }
  });
});
