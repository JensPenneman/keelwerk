import type { FlagResolution } from '../contexts/flag-resolution.ts';
import { defaultFlagResolution } from './default-flag-resolution.ts';
import type { FlagProvider } from './flag-provider.ts';
import type { FlagSpec } from './flag-spec.ts';

/** `mail-store.sendLater` is `KEELWERK_FLAG_MAIL_STORE_SEND_LATER`. */
function variableOf(key: string): string {
  const split = key.lastIndexOf('.');
  const upper = (part: string): string =>
    part
      .replace(/-/g, '_')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toUpperCase();
  return `KEELWERK_FLAG_${upper(key.slice(0, split))}_${upper(key.slice(split + 1))}`;
}

/** The value a variable holds for a flag of this kind, or undefined when it does not parse. */
function parsed(flag: FlagSpec, raw: string): { readonly value: unknown } | undefined {
  switch (flag.kind) {
    case 'boolean':
      return raw === 'true' || raw === 'false' ? { value: raw === 'true' } : undefined;
    case 'number': {
      const value = raw.trim() === '' ? Number.NaN : Number(raw);
      return Number.isFinite(value) ? { value } : undefined;
    }
    case 'string':
    case 'variant':
      return { value: raw };
    case 'json':
      try {
        return { value: JSON.parse(raw) as unknown };
      } catch {
        return undefined;
      }
  }
}

/**
 * `env` (20.3): the variable `KEELWERK_FLAG_<MODULE>_<FLAG>`, for development and tests only.
 * An unset or empty variable passes the flag on; a value that does not parse answers the default
 * with `PARSE_ERROR`, a variant the flag does not list with `TYPE_MISMATCH`. The variable is read
 * when the flag is resolved.
 */
export function envFlagProvider(env: Readonly<Record<string, string | undefined>>): FlagProvider {
  return {
    id: 'env',
    sync: true,
    start: () => Promise.resolve(),
    resolve: <T>(flag: FlagSpec<T>): FlagResolution<T> | undefined => {
      const raw = env[variableOf(flag.key)];
      if (raw === undefined || raw === '') return undefined;
      const result = parsed(flag, raw);
      if (result === undefined) {
        return defaultFlagResolution(flag, { errorCode: 'PARSE_ERROR', provider: 'env' });
      }
      if (flag.kind === 'variant' && !(flag.variants ?? []).includes(raw)) {
        return defaultFlagResolution(flag, { errorCode: 'TYPE_MISMATCH', provider: 'env' });
      }
      const value = result.value as T;
      return {
        value,
        variant: flag.kind === 'json' ? 'env' : String(value),
        reason: 'STATIC',
        provider: 'env',
      };
    },
  };
}
