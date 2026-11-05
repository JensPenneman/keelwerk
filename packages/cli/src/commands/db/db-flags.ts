import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';

/** The output flags every `db` command takes, then its own; `connection` adds the deployment file flags of the commands that run against a deployment. */
export function dbFlags(
  own: Readonly<Record<string, FlagParameter>>,
  connection = false,
): Readonly<Record<string, FlagParameter>> {
  const common = commonFlags();
  return {
    output: common.output,
    fields: common.fields,
    ...(connection
      ? { profile: common.profile, socket: common.socket, config: common.config }
      : {}),
    ...own,
  } as Readonly<Record<string, FlagParameter>>;
}
