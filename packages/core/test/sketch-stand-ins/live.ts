import { contracts } from '../../src/dsl/contracts.ts';
import { defineModule } from '../../src/dsl/define-module.ts';
import { defineModuleBase } from '../../src/dsl/define-module-base.ts';
import type { ModuleBaseType } from '../../src/model/module-base-type.ts';
import type { ModuleType } from '../../src/model/module-type.ts';

interface LiveBase extends ModuleBaseType<typeof liveBaseDef> {}

const liveBaseDef = defineModuleBase({
  id: 'live',
  version: '0.1.0',
  provides: [contracts.live],
  generates: ['watch'],
});
const liveBase: LiveBase = liveBaseDef;
const liveDef = defineModule(liveBase, {});

/** Stand-in for @keelwerk/live: provides the live contract and fills the `watch` template. */
export interface Live extends ModuleType<typeof liveDef> {}

/** The live module. */
export const live: Live = liveDef;
