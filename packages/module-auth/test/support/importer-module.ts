import { defineModule, defineModuleBase, defineReaction, invoke, system } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '../../src/module.generated.ts';

const importerBaseDef = defineModuleBase({
  id: 'importer',
  version: '0.0.0',
  requires: [accounts, auth],
});

/** A module that registers the profile of ada@example.org as the system whenever a sign-up happens, as an import or a tenant hook would. */
const registerImported = defineReaction(importerBaseDef, {
  on: 'auth.credential.signedUp',
  timing: 'inline',
  react: () => ({
    effects: [
      invoke(
        'accounts.register',
        { displayName: 'Imported', email: 'ada@example.org' },
        { as: system('register an imported profile') },
      ),
    ],
  }),
});

const importerDef = defineModule(importerBaseDef, { reactions: { registerImported } });
export const importer: typeof importerDef = importerDef;
