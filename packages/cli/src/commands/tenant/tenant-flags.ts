import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { operatorFlags } from '../operator/operator-flags.ts';

/** The flags of the tenant commands: the connection and output flags and the backend they address. */
export function tenantFlags(): Readonly<Record<string, FlagParameter>> {
  return {
    ...operatorFlags(),
    backend: commonFlags().backend,
  } as Readonly<Record<string, FlagParameter>>;
}
