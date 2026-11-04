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
});
