import type { FlagSpec } from './flag-spec.ts';

/** Whether a value is of the flag's kind (20.2); a json value is any. */
export function isFlagValue(flag: Pick<FlagSpec, 'kind' | 'variants'>, value: unknown): boolean {
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
