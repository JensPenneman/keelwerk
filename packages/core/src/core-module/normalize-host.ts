import { errors } from '../errors/errors.ts';

const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A host name as the edge resolves it: lower case, without a port and without a trailing dot.
 * A name that is not a dotted sequence of letters, digits and hyphens is `validation`.
 */
export function normalizeHost(host: string): string {
  const name = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (
    name.length === 0 ||
    name.length > 253 ||
    !name.split('.').every((part) => label.test(part))
  ) {
    throw errors.validation(`"${host}" is not a host name.`);
  }
  return name;
}
