import { describe, expect, test } from 'vitest';
import { embeddedIpv4Of } from './embedded-ipv4-of.ts';

describe('embeddedIpv4Of', () => {
  test.each([
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['::ffff:7f00:1', '127.0.0.1'],
    ['::7f00:1', '127.0.0.1'],
    ['::a9fe:a9fe', '169.254.169.254'],
    ['::ffff:0:7f00:1', '127.0.0.1'],
    ['64:ff9b::a9fe:a9fe', '169.254.169.254'],
    ['64:ff9b::8.8.8.8', '8.8.8.8'],
    ['2002:7f00:1::', '127.0.0.1'],
    ['2002:c0a8:101:1::1', '192.168.1.1'],
  ])('%s carries %s', (address, v4) => {
    expect(embeddedIpv4Of(address)).toEqual([v4]);
  });

  // RFC 8215 lets the operator pick the prefix length inside 64:ff9b:1::/48; RFC 6052 section 2.2
  // places the IPv4 address at other bits for /48, /56 and /64, around the u octet.
  test.each([
    ['64:ff9b:1:c0a8:0:100:808:808', '192.168.0.1'],
    ['64:ff9b:1:0:c0:a801:101:0', '192.168.1.1'],
    ['64:ff9b:1:c0:a8:101::', '192.168.1.1'],
    ['64:ff9b:1::c0a8:101', '192.168.1.1'],
    ['64:ff9b:1::a9fe:a9fe', '169.254.169.254'],
  ])('%s, of the local-use prefix, carries %s among its readings', (address, v4) => {
    expect(embeddedIpv4Of(address)).toContain(v4);
    expect(embeddedIpv4Of(address)).toHaveLength(4);
  });

  test.each([
    '::',
    '::1',
    '2606:4700::1111',
    'fe80::1',
    '2001:db8::1',
    '93.184.216.34',
    'not an address',
  ])('%s embeds no IPv4 address', (address) => {
    expect(embeddedIpv4Of(address)).toEqual([]);
  });
});
