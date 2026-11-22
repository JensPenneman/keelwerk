import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';

/** The flags of `doctor` (section 16.9.7): the connection and output flags every command shares, `--layout` and `--strict`. */
export function doctorFlags(): Readonly<Record<string, FlagParameter>> {
  const common = commonFlags();
  return {
    profile: common.profile,
    backend: common.backend,
    tenant: common.tenant,
    socket: common.socket,
    config: common.config,
    output: common.output,
    fields: common.fields,
    layout: {
      kind: 'boolean',
      brief: 'Run the layout pass alone (section 23.13).',
      optional: true,
      withNegated: false,
    } as unknown as FlagParameter,
    strict: {
      kind: 'boolean',
      brief: 'Exit 1 also when a check that doctor has did not run.',
      optional: true,
      withNegated: false,
    } as unknown as FlagParameter,
  } as Readonly<Record<string, FlagParameter>>;
}
