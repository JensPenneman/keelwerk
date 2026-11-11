import type { FlagResolution } from '../contexts/flag-resolution.ts';
import { defaultFlagResolution } from './default-flag-resolution.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagProvider } from './flag-provider.ts';
import type { FlagSpec } from './flag-spec.ts';

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

/** Whether a provider's value is of the flag's kind (20.2); a json value is any. */
function isOfKind(flag: FlagSpec, value: unknown): boolean {
  switch (flag.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'variant':
      return typeof value === 'string' && (flag.variants ?? []).includes(value);
    case 'json':
      return true;
  }
}

/**
 * Asks the providers in order; the first resolution wins, else the declared default. Synchronous
 * while every provider asked answers synchronously, else a promise. A principal-level flag with
 * no targeting key answers TARGETING_KEY_MISSING without asking. A throw or rejection answers
 * ERROR/GENERAL with that provider's id and calls `onError`; a value of the wrong kind answers
 * ERROR/TYPE_MISMATCH with that provider's id. Never throws.
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
  const failed = (provider: FlagProvider, error: unknown): FlagResolution<T> => {
    try {
      onError?.(provider.id, error);
    } catch {
      // A failing observer never changes the answer.
    }
    return defaultFlagResolution(flag, { errorCode: 'GENERAL', provider: provider.id });
  };
  /** The resolution a provider gave, checked; undefined passes the flag on. */
  const checked = (
    provider: FlagProvider,
    answer: FlagResolution<T> | undefined,
  ): FlagResolution<T> | undefined => {
    if (answer === undefined) return undefined;
    return isOfKind(flag, answer.value)
      ? answer
      : defaultFlagResolution(flag, { errorCode: 'TYPE_MISMATCH', provider: provider.id });
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
