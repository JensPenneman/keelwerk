import { errors } from '../errors/errors.ts';
import type { SecretProvider } from '../kernel/secret-provider.ts';
import type { SecretResolver } from '../kernel/secret-resolver.ts';
import type { Logger } from '../observability/logger.ts';

/**
 * The resolver over the deployment's secret providers in order, the process environment last
 * (section 4.6: "secret providers default to the process environment"); `env` is the environment
 * the caller handed the runtime. A reference no provider holds is `unavailable`; the reason is
 * logged with the lookup, never the value.
 */
export function secretResolverOf(
  providers: readonly SecretProvider[],
  env: Readonly<Record<string, string | undefined>>,
  log: Logger,
): SecretResolver {
  return {
    resolve: async (ref, reason) => {
      log.debug('a secret is resolved', { ref: ref.ref, reason });
      for (const provider of providers) {
        const value = await provider.resolve(ref);
        if (value !== undefined) return value;
      }
      const value = env[ref.ref];
      if (value === undefined) {
        throw errors.unavailable(`No secret provider holds "${ref.ref}".`);
      }
      return value;
    },
  };
}
