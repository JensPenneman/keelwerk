import { contracts } from '../src/contracts.ts';
import { defineModule, type ModuleType } from '../src/define-module.ts';
import { defineModuleBase, type ModuleBaseType } from '../src/define-module-base.ts';

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
