import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { textFlag } from '../../routes/text-flag.ts';

/** The flags of `surface diff` and `surface version new` (sections 18.2 and 18.6): output, `--app`, then the command's own. */
export function surfaceFlags(
  extra: Readonly<Record<string, FlagParameter>>,
): Readonly<Record<string, FlagParameter>> {
  const common = commonFlags();
  return {
    output: common.output,
    fields: common.fields,
    app: textFlag('Only this app.', 'id'),
    ...extra,
  } as Readonly<Record<string, FlagParameter>>;
}
