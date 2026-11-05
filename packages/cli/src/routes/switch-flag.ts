import type { FlagParameter } from './flag-parameter.ts';

/** An optional boolean flag without a `--no-` form. */
export function switchFlag(brief: string): FlagParameter {
  return { kind: 'boolean', brief, optional: true, withNegated: false } as unknown as FlagParameter;
}
