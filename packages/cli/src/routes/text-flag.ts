import type { FlagParameter } from './flag-parameter.ts';

/** An optional text flag; `variadic` lets it repeat. */
export function textFlag(brief: string, placeholder: string, variadic = false): FlagParameter {
  return {
    kind: 'parsed',
    parse: String,
    brief,
    placeholder,
    optional: true,
    ...(variadic && { variadic: true }),
  } as unknown as FlagParameter;
}
