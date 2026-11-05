import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';

/** The flags of `start` (section 16.9.7): the process role and the deployment file. */
export function startFlags(): Readonly<Record<string, FlagParameter>> {
  const common = commonFlags();
  return {
    config: common.config,
    role: {
      kind: 'enum',
      values: ['serve', 'work', 'all'],
      brief: 'The role of the process (default all).',
      optional: true,
    } as unknown as FlagParameter,
  } as Readonly<Record<string, FlagParameter>>;
}
