import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { switchFlag } from '../../routes/switch-flag.ts';

/** The flags of `dev` (section 13.6): the deployment file and `--no-types`, which leaves the type checker out. */
export function devFlags(): Readonly<Record<string, FlagParameter>> {
  const common = commonFlags();
  return {
    config: common.config,
    'no-types': switchFlag('Leave the type checker out.'),
  } as Readonly<Record<string, FlagParameter>>;
}
