import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { textFlag } from '../../routes/text-flag.ts';

/** The `--base` flag of `surface diff`. */
export const baseFlag: Readonly<Record<string, FlagParameter>> = {
  base: textFlag('The git ref to compare with (default origin/main).', 'ref'),
};
