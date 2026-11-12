import { describe, expect, it } from 'vitest';
import { trustedProxies } from '../src/trusted-proxies.ts';

describe('trustedProxies', () => {
  it('ignores forwarding headers when the list is empty', () => {
    expect(trustedProxies([]).clientAddress('10.0.0.1', '1.2.3.4')).toBe('10.0.0.1');
  });

  it('takes the first untrusted address from the right', () => {
    const proxies = trustedProxies(['10.0.0.0/8', '2001:db8::/32']);
    expect(proxies.clientAddress('10.1.1.1', '9.9.9.9, 1.2.3.4, 10.2.2.2')).toBe('1.2.3.4');
    expect(proxies.clientAddress('2001:db8::1', '2001:db8::7, 5.6.7.8')).toBe('5.6.7.8');
    expect(proxies.clientAddress('::ffff:10.0.0.9', '4.4.4.4')).toBe('4.4.4.4');
  });

  it('does not trust a peer outside the ranges', () => {
    expect(trustedProxies(['10.0.0.0/8']).clientAddress('11.0.0.1', '1.2.3.4')).toBe('11.0.0.1');
  });

  it('falls back to the peer when the header is not an address chain', () => {
    expect(trustedProxies(['10.0.0.0/8']).clientAddress('10.0.0.1', 'unknown')).toBe('10.0.0.1');
  });

  it('takes a bare address as a single host and rejects bad ranges', () => {
    expect(trustedProxies(['10.0.0.1']).clientAddress('10.0.0.2', '1.1.1.1')).toBe('10.0.0.2');
    for (const bad of ['nope', '10.0.0.0/33', '10.0.0.0/x', '::1/129']) {
      expect(() => trustedProxies([bad])).toThrow(TypeError);
    }
  });

  it('stores one client in one form: lower case, compressed, a mapped address as IPv4', () => {
    const proxies = trustedProxies(['10.0.0.0/8']);
    expect(proxies.clientAddress('10.0.0.1', '2001:DB8::5')).toBe('2001:db8::5');
    expect(proxies.clientAddress('10.0.0.1', '2001:0db8:0:0:0:0:0:5')).toBe('2001:db8::5');
    expect(proxies.clientAddress('10.0.0.1', '::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(proxies.clientAddress('2001:DB8::5', null)).toBe('2001:db8::5');
  });

  it('takes a forwarded entry with a zone suffix as no address: the socket counts', () => {
    const proxies = trustedProxies(['10.0.0.0/8']);
    expect(proxies.clientAddress('10.0.0.1', 'fe80::1%x')).toBe('10.0.0.1');
    expect(proxies.clientAddress('10.0.0.1', '1.2.3.4, fe80::1%x')).toBe('10.0.0.1');
  });

  it('stores a socket peer without its zone suffix', () => {
    expect(trustedProxies([]).clientAddress('fe80::1%en0', null)).toBe('fe80::1');
    expect(trustedProxies([]).clientAddress('FE80::1%en0', 'fe80::2')).toBe('fe80::1');
  });

  it('reads a forwarded IPv4 entry with a port as its address', () => {
    const proxies = trustedProxies(['10.0.0.0/8']);
    expect(proxies.clientAddress('10.0.0.1', '203.0.113.7:51234')).toBe('203.0.113.7');
    expect(proxies.clientAddress('10.0.0.1', '203.0.113.7:51234, 10.0.0.5:443')).toBe(
      '203.0.113.7',
    );
  });

  it('reads a bracketed IPv6 entry, with or without a port, as its address', () => {
    const proxies = trustedProxies(['10.0.0.0/8']);
    expect(proxies.clientAddress('10.0.0.1', '[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(proxies.clientAddress('10.0.0.1', '[2001:DB8::1]')).toBe('2001:db8::1');
    expect(proxies.clientAddress('10.0.0.1', '[::ffff:203.0.113.7]:80')).toBe('203.0.113.7');
  });

  it('never reads a bare IPv6 address as an address with a port', () => {
    const proxies = trustedProxies(['10.0.0.0/8']);
    expect(proxies.clientAddress('10.0.0.1', '2001:db8::1:443')).toBe('2001:db8::1:443');
    expect(proxies.clientAddress('10.0.0.1', '::1:80')).toBe('::0.1.0.128');
  });

  it('reads an IPv6 entry that ends in a dotted quad and a port as its address', () => {
    const proxies = trustedProxies(['10.0.0.0/8']);
    expect(proxies.clientAddress('10.0.0.1', '::ffff:203.0.113.7:51234')).toBe('203.0.113.7');
    expect(proxies.clientAddress('10.0.0.1', '64:ff9b::203.0.113.7:443')).toBe(
      '64:ff9b::cb00:7107',
    );
  });

  it('takes a malformed entry with a port or brackets as no address: the socket counts', () => {
    const proxies = trustedProxies(['10.0.0.0/8']);
    const malformed = [
      '203.0.113.7:',
      '203.0.113.7:65536',
      '203.0.113.7:x',
      '[2001:db8::1',
      '2001:db8::1]',
      '[2001:db8::1]:',
      '[2001:db8::1]:70000',
      '[2001:db8::1]443',
      '[203.0.113.7]:80',
      '[fe80::1%eth0]:443',
      '::ffff:203.0.113.7:',
      '::ffff:203.0.113.7:65536',
      '::ffff:203.0.113.7:x',
      '[]',
    ];
    for (const entry of malformed) {
      expect(proxies.clientAddress('10.0.0.1', entry), entry).toBe('10.0.0.1');
      expect(proxies.clientAddress('10.0.0.1', `1.2.3.4, ${entry}`), entry).toBe('10.0.0.1');
    }
  });

  it('checks a trusted proxy written with a port against the ranges', () => {
    const proxies = trustedProxies(['10.0.0.0/8']);
    expect(proxies.clientAddress('10.0.0.1', '198.51.100.9, 10.0.0.5:443')).toBe('198.51.100.9');
  });
});
