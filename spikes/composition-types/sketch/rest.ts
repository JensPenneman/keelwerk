import { contracts } from '../src/contracts.ts';
import { defineModule, type ModuleType } from '../src/define-module.ts';
import { defineModuleBase, type ModuleBaseType } from '../src/define-module-base.ts';

interface RestBase extends ModuleBaseType<typeof restBaseDef> {}

const restBaseDef = defineModuleBase({
  id: 'rest',
  version: '0.1.0',
  requires: [contracts.httpHost],
});
const restBase: RestBase = restBaseDef;
const restDef = defineModule(restBase, {});

/** Stand-in for @keelwerk/transport-rest: a transport module that requires the HTTP host. */
export interface Rest extends ModuleType<typeof restDef> {}

/** The REST transport module. */
export const rest: Rest = restDef;
