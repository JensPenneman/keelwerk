import { normalizeHost } from '../../core-module/normalize-host.ts';
import { isKeelwerkError } from '../../errors/is-keelwerk-error.ts';
import type { Carrier } from '../carrier.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import { operatorTokenOf } from './operator-token-of.ts';

function hostOf(host: string): string | undefined {
  try {
    return normalizeHost(host);
  } catch (error) {
    if (isKeelwerkError(error) && error.kind === 'validation') return undefined;
    throw error;
  }
}

/**
 * Whether the carrier presents an operator token at an operator host name (sections 3.5 and 8.8,
 * glossary: the operator endpoint is the Unix socket and the operator host names). A token sent to
 * any other host is no operator credential there: the tenant resolvers and the app's resolvers
 * handle the request. Without `operatorHosts` no host is an operator host.
 */
export function atOperatorHost(env: InvokerEnv, carrier: Carrier): boolean {
  const { operatorTokens, operatorHosts } = env.options;
  if (operatorTokens === undefined || operatorHosts === undefined) return false;
  if (carrier.host === undefined || operatorTokenOf(carrier) === undefined) return false;
  const host = hostOf(carrier.host);
  return host !== undefined && operatorHosts.some((name) => hostOf(name) === host);
}
