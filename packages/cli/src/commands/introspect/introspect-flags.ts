import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { operatorFlags } from '../operator/operator-flags.ts';

/** The flags of the introspect commands: the connection selectors and the output. */
export function introspectFlags(): Readonly<Record<string, FlagParameter>> {
  return {
    ...operatorFlags(),
    backend: commonFlags().backend,
    tenant: commonFlags().tenant,
  } as Readonly<Record<string, FlagParameter>>;
}
