import type { FlagResolution } from '../contexts/flag-resolution.ts';

/** What `core.flag.evaluate` answers; no rule id, rule version or provider: operator data stays with operators. */
export interface ClientFlagDocument {
  readonly key: string;
  readonly value: unknown;
  readonly variant: string;
  readonly reason: FlagResolution['reason'];
  readonly errorCode?: NonNullable<FlagResolution['errorCode']>;
}
