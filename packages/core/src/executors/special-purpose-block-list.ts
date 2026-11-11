import { BlockList } from 'node:net';

const v4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const v6: readonly (readonly [string, number])[] = [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

/** The special-purpose address tables as one block list; built for each egress, which is cheap. */
export function specialPurposeBlockList(): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of v4) list.addSubnet(address, prefix, 'ipv4');
  for (const [address, prefix] of v6) list.addSubnet(address, prefix, 'ipv6');
  return list;
}
