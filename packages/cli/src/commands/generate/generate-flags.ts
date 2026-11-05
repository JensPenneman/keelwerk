import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { switchFlag } from '../../routes/switch-flag.ts';

/** The flags of `generate` (section 16.9.7): the output flags every command shares, then its own. */
export function generateFlags(): Readonly<Record<string, FlagParameter>> {
  const common = commonFlags();
  return {
    output: common.output,
    fields: common.fields,
    check: switchFlag(
      'Compare every artefact with its sources and exit 1 on drift; write nothing.',
    ),
    watch: switchFlag(
      'Rewrite on change; not served by this command in this release (use keelwerk dev).',
    ),
    only: {
      kind: 'parsed',
      parse: String,
      brief: 'Run one producer: manifests, surfaces, app, openapi, cli or migrations; repeatable.',
      placeholder: 'producer',
      optional: true,
      variadic: true,
    } as unknown as FlagParameter,
  } as Readonly<Record<string, FlagParameter>>;
}
