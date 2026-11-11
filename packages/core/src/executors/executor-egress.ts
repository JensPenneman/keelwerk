import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Egress } from '../contexts/egress.ts';
import { errors } from '../errors/errors.ts';
import { coreError } from '../http/core-error.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import { egressAllowList } from './egress-allow-list.ts';
import type { EgressPolicy } from './egress-policy.ts';
import { embeddedIpv4Of } from './embedded-ipv4-of.ts';
import { isSpecialPurposeAddress } from './is-special-purpose-address.ts';
import { sendEgressRequest } from './send-egress-request.ts';
import { specialPurposeBlockList } from './special-purpose-block-list.ts';

async function resolveAll(host: string): Promise<readonly string[]> {
  const found = await dnsLookup(host, { all: true });
  return found.map((entry) => entry.address);
}

/**
 * `Egress.fetch` for one attempt (12.3, S-131): http and https only (else `validation`); the name
 * is resolved to all its addresses and refused with `forbidden` (`core.forbidden`) when any of
 * them is special-purpose and outside `policy.allow`, so a second record cannot rebind it; the
 * first checked address is pinned for the connection; the answer's body is read up to 1 MiB
 * (`unsupported` beyond it). A request is bound to the attempt's signal as well as to the one the
 * executor passes, and none starts once the attempt has ended. Each call is logged `egress` with the effect, method, host and status,
 * never the path or the query, and the host goes on the span. A network failure is `unavailable`.
 */
export function executorEgress(options: {
  readonly policy: EgressPolicy | undefined;
  readonly effectId: string;
  readonly log: Logger;
  readonly trace: Span;
  /** The attempt's signal: a request of an executor that passes none is bound to it, and no request starts once it has aborted. */
  readonly signal: AbortSignal;
  readonly lookup?: (host: string) => Promise<readonly string[]>;
}): Egress {
  const allowed = egressAllowList(options.policy);
  const special = specialPurposeBlockList();
  const resolve = options.lookup ?? resolveAll;
  const { log, effectId } = options;
  return {
    fetch: async (target, init = {}) => {
      options.signal.throwIfAborted();
      let url: URL;
      try {
        url = new URL(target);
      } catch {
        throw errors.validation('The egress address is not a URL.');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw errors.validation('Egress takes http and https addresses only.');
      }
      const method = init.method ?? 'GET';
      const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
      options.trace.setAttribute('keelwerk.egress.host', host);
      const addresses = isIP(host) === 0 ? await resolve(host) : [host];
      const checked = addresses.map((address) => ({
        address,
        family: isIP(address) === 6 ? (6 as const) : (4 as const),
      }));
      const first = checked[0];
      if (first === undefined) {
        log.warn('egress failed', { effect: effectId, method, host });
        throw errors.unavailable('The host did not resolve.');
      }
      for (const checkedAddress of checked) {
        // An IPv6 address that embeds IPv4 addresses is judged, and allowed, as each of them.
        const embedded = checkedAddress.family === 6 ? embeddedIpv4Of(checkedAddress.address) : [];
        const judged =
          embedded.length === 0
            ? [{ address: checkedAddress.address, family: checkedAddress.family }]
            : embedded.map((address) => ({ address, family: 4 as const }));
        for (const { address, family } of judged) {
          if (
            isSpecialPurposeAddress(special, address, family) &&
            !allowed.check(address, family === 4 ? 'ipv4' : 'ipv6')
          ) {
            log.warn('egress refused', { effect: effectId, method, host });
            throw coreError('core.forbidden', {
              message: 'The destination is a special-purpose address.',
            });
          }
        }
      }
      try {
        const signal =
          init.signal === undefined
            ? options.signal
            : AbortSignal.any([init.signal, options.signal]);
        const answer = await sendEgressRequest(url, first, { ...init, signal });
        log.info('egress', { effect: effectId, method, host, status: answer.status });
        return { status: answer.status, text: () => Promise.resolve(answer.text) };
      } catch (error) {
        log.warn('egress failed', { effect: effectId, method, host });
        throw error;
      }
    },
  };
}
