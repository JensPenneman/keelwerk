import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { textFlag } from '../../routes/text-flag.ts';

/** The `--change` flag of `surface version new`. */
export const changeFlag: Readonly<Record<string, FlagParameter>> = {
  change: textFlag('The id of a version change the new version adopts; repeatable.', 'id', true),
};
