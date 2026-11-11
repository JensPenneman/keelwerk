import { BlockList, isIP } from 'node:net';
import { errors } from '../errors/errors.ts';
import type { EgressPolicy } from './egress-policy.ts';

/**
 * The addresses a policy exempts from the special-purpose refusal: each `allow` entry is a CIDR
 * block (`127.0.0.0/8`, `::1/128`) or a single address. An entry that is neither is `validation`,
 * so a mistyped policy fails when the worker starts, never by letting an address through.
 */
export function egressAllowList(policy: EgressPolicy | undefined): BlockList {
  const list = new BlockList();
  for (const entry of policy?.allow ?? []) {
    const [address = '', prefix, ...rest] = entry.split('/');
    const family = isIP(address);
    const bits = prefix === undefined ? undefined : Number(prefix);
    const valid =
      family !== 0 &&
      rest.length === 0 &&
      (bits === undefined ||
        (Number.isInteger(bits) && bits >= 0 && bits <= (family === 4 ? 32 : 128)));
    if (!valid) throw errors.validation(`The egress allow entry "${entry}" is not a CIDR block.`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) list.addAddress(address, type);
    else list.addSubnet(address, bits, type);
  }
  return list;
}
