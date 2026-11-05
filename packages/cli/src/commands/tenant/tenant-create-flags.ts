import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { textFlag } from '../operator/text-flag.ts';
import { tenantFlags } from './tenant-flags.ts';

/** The flags of `tenant create`: `--domain` repeats (S-26). */
export function tenantCreateFlags(): Readonly<Record<string, FlagParameter>> {
  return {
    ...tenantFlags(),
    domain: {
      kind: 'parsed',
      parse: String,
      variadic: true,
      brief: 'A host name that resolves to the tenant; repeat for several.',
      placeholder: 'host',
      optional: true,
    } as unknown as FlagParameter,
    'command-id': commonFlags()['command-id'],
    placement: textFlag("The placement for the tenant (default: the backend's).", 'name'),
    'api-version': textFlag('The API version the tenant is pinned to.', 'date'),
  } as Readonly<Record<string, FlagParameter>>;
}
