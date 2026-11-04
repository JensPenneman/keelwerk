import type { FlagParametersForType } from '@stricli/core';
import type { NewFlags } from './new-flags.ts';

function text(brief: string): {
  kind: 'parsed';
  parse: typeof String;
  brief: string;
  optional: true;
} {
  return { kind: 'parsed', parse: String, brief, optional: true };
}

/** The flag definitions of `keelwerk new` and its `module new` alias. */
export const newFlagParameters: FlagParametersForType<NewFlags> = {
  kind: text(
    'The variant: command|query (action), domain (module), boolean|string|number|json|variant (flag), an error kind (error).',
  ),
  requires: text('Module: required modules, comma separated.'),
  optional: text('Module: optional modules, comma separated.'),
  app: text('Module: the app whose modules.ts should list it.'),
  from: text('Place the part in this module, as a contribution to the reference module.'),
  when: text('Place the part in a conditional part for these module ids, comma separated.'),
  level: text('Flag: deployment|backend|tenant|principal.'),
  purpose: text('Flag: release|experiment|operational|kill-switch|permission.'),
  expires: text('Flag: the expiry date, YYYY-MM-DD.'),
  effect: text('Rule: allow|deny.'),
  on: text('Reaction: the event, module.entity.event.'),
  every: text('Schedule: the interval, such as 5m or 1d.'),
  modules: text('App: modules to select, comma separated.'),
  scope: text('Package scope for new packages and imports of other modules.'),
  dir: text('The module package directory, when it is not modules/<id> or packages/module-<id>.'),
  'dry-run': { kind: 'boolean', brief: 'List the files without writing them.', optional: true },
};
