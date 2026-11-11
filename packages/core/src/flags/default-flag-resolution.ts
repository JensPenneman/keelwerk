import type { FlagResolution } from '../contexts/flag-resolution.ts';
import { defaultFlagReason } from '../events/default-flag-reason.ts';
import type { FlagSpec } from './flag-spec.ts';

/** The declared default: reason DEFAULT, provider 'default'; with a failure, reason ERROR and its code. */
export function defaultFlagResolution<T>(
  flag: FlagSpec<T>,
  failure?: {
    readonly errorCode: NonNullable<FlagResolution['errorCode']>;
    readonly provider?: string;
  },
): FlagResolution<T> {
  const value = flag.default;
  const variant = typeof value === 'object' ? 'default' : String(value);
  if (failure === undefined) {
    return { value, variant, reason: defaultFlagReason, provider: 'default' };
  }
  return {
    value,
    variant,
    reason: 'ERROR',
    errorCode: failure.errorCode,
    provider: failure.provider ?? 'default',
  };
}
