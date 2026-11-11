import type { FlagTargeting } from '../flags/flag-targeting.ts';

/** The input of `core.flag.set` as the control route checks it against the flag's declaration. */
export interface FlagTargetingCheck {
  readonly key: string;
  readonly backendId?: string | undefined;
  readonly targeting: FlagTargeting;
}
