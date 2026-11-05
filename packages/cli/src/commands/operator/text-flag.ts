import type { FlagParameter } from '../../routes/flag-parameter.ts';

/** A text flag. */
export function textFlag(brief: string, placeholder: string): FlagParameter {
  return {
    kind: 'parsed',
    parse: String,
    brief,
    placeholder,
    optional: true,
  } as unknown as FlagParameter;
}
