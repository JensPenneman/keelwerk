import type { FlagResolution } from '../contexts/flag-resolution.ts';
import { defaultFlagResolution } from './default-flag-resolution.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagProvider } from './flag-provider.ts';
import type { FlagSpec } from './flag-spec.ts';
import { isFlagValue } from './is-flag-value.ts';

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

/**
 * Asks the providers in order; the first resolution wins, else the declared default. Synchronous
 * while every provider asked answers synchronously, else a promise. A principal-level flag with
 * no targeting key answers TARGETING_KEY_MISSING without asking. A throw or rejection answers
 * ERROR/GENERAL with that provider's id and calls `onError`; a value of the wrong kind answers
 * ERROR/TYPE_MISMATCH with that provider's id and calls `onError` too (the error names the flag
 * and its kind, never the value). Never throws.
 */
export function resolveFlag<T>(
  providers: readonly FlagProvider[],
  flag: FlagSpec<T>,
  context: FlagContext,
  onError?: (provider: string, error: unknown) => void,
): FlagResolution<T> | Promise<FlagResolution<T>> {
  if (flag.level === 'principal' && context.targetingKey === null) {
    return defaultFlagResolution(flag, { errorCode: 'TARGETING_KEY_MISSING' });
  }
  const failed = (
    provider: FlagProvider,
    error: unknown,
    errorCode: 'GENERAL' | 'TYPE_MISMATCH' = 'GENERAL',
  ): FlagResolution<T> => {
    try {
      onError?.(provider.id, error);
    } catch {
      // A failing observer never changes the answer.
    }
    return defaultFlagResolution(flag, { errorCode, provider: provider.id });
  };
  /** The resolution a provider gave, checked; undefined passes the flag on. */
  const checked = (
    provider: FlagProvider,
    answer: FlagResolution<T> | undefined,
  ): FlagResolution<T> | undefined => {
    if (answer === undefined) return undefined;
    if (isFlagValue(flag, answer.value)) return answer;
    return failed(
      provider,
      new Error(`The value is not a ${flag.kind} as "${flag.key}" declares (TYPE_MISMATCH).`),
      'TYPE_MISMATCH',
    );
  };
  const ask = (from: number): FlagResolution<T> | Promise<FlagResolution<T>> => {
    for (let index = from; index < providers.length; index++) {
      const provider = providers[index];
      if (provider === undefined) continue;
      let answer: FlagResolution<T> | undefined | Promise<FlagResolution<T> | undefined>;
      try {
        answer = provider.resolve(flag, context);
      } catch (error) {
        return failed(provider, error);
      }
      if (isPromise(answer)) {
        return answer.then(
          (settled) => checked(provider, settled) ?? ask(index + 1),
          (error: unknown) => failed(provider, error),
        );
      }
      const result = checked(provider, answer);
      if (result !== undefined) return result;
    }
    return defaultFlagResolution(flag);
  };
  return ask(0);
}
