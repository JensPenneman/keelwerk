import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';

/** The connection and output flags the operator commands share (section 16.9.7). */
export function operatorFlags(): Readonly<Record<string, FlagParameter>> {
  const common = commonFlags();
  return {
    profile: common.profile,
    socket: common.socket,
    config: common.config,
    output: common.output,
    fields: common.fields,
  } as Readonly<Record<string, FlagParameter>>;
}
