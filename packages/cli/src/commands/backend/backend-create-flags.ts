import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { operatorFlags } from '../operator/operator-flags.ts';
import { textFlag } from '../operator/text-flag.ts';

/** The flags of `backend create`: the connection and output flags, the app, the placement and the API version pin (S-26). */
export function backendCreateFlags(): Readonly<Record<string, FlagParameter>> {
  return {
    ...operatorFlags(),
    app: textFlag('The app the backend serves.', 'id'),
    placement: textFlag('The placement that holds its data.', 'name'),
    'api-version': textFlag('The API version it is pinned to.', 'date'),
    settings: textFlag(
      'Per-module configuration as JSON, @file or - for standard input.',
      'json|@file|-',
    ),
    'command-id': commonFlags()['command-id'],
    input: commonFlags().input,
  } as Readonly<Record<string, FlagParameter>>;
}
