import type { RowEnvironment } from '../authorization/row-environment.ts';
import { envFlagProvider } from './env-flag-provider.ts';
import type { FlagProvider } from './flag-provider.ts';
import { targetingProvider } from './targeting-provider.ts';

/** The ordered `flagProviders` (20.3): core.targeting, the deployment's providers, env outside production. */
export function createFlagChain(input: {
  readonly providers: readonly FlagProvider[];
  readonly environment: RowEnvironment;
  readonly env: Readonly<Record<string, string | undefined>>;
}): readonly FlagProvider[] {
  return [
    targetingProvider(),
    ...input.providers,
    ...(input.environment === 'production' ? [] : [envFlagProvider(input.env)]),
  ];
}
