import type { FlagParametersForType } from '@stricli/core';
import type { InitFlags } from './init-flags.ts';

function text(brief: string): {
  kind: 'parsed';
  parse: typeof String;
  brief: string;
  optional: true;
} {
  return { kind: 'parsed', parse: String, brief, optional: true };
}

/** The flag definitions of `keelwerk init`. */
export const initFlagParameters: FlagParametersForType<InitFlags> = {
  scope: text('The package scope, such as @acme (default: the directory name).'),
  app: text('The id of the app (default: the directory name).'),
  module: text('The id of the module (default: starter).'),
  'dry-run': { kind: 'boolean', brief: 'List the files without writing them.', optional: true },
};
