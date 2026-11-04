import { contracts } from '@keelwerk/core';
import { createHttpHost } from './create-http-host.ts';
import { defaultMaxBodyBytes } from './default-max-body-bytes.ts';
import type { HttpHostEntry } from './http-host-entry.ts';
import type { HttpHostOptions } from './http-host-options.ts';
import { trustedProxies } from './trusted-proxies.ts';

/**
 * The deployment's HTTP host as an infrastructure entry: it provides `contracts.httpHost` and
 * serves the invocation protocol for every app (section 16.3.3). The options are checked here, so
 * a bad CIDR range or limit fails at definition time.
 */
export function httpHost(options: HttpHostOptions = {}): HttpHostEntry {
  trustedProxies(options.trustedProxies ?? []);
  const limit = options.maxBodyBytes ?? defaultMaxBodyBytes;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('httpHost: maxBodyBytes must be a positive integer.');
  }
  return {
    kind: 'httpHost',
    provides: [contracts.httpHost],
    options,
    create: (deps) => createHttpHost(options, deps),
  };
}
