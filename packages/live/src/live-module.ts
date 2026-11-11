import type { ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  contracts,
  core,
  defineContribution,
  defineLiveHub,
  defineModule,
  defineModuleBase,
} from '@keelwerk/core';
import { createLiveHub } from './hub/create-live-hub.ts';
import { version } from './version.ts';

const toCore = defineContribution(core, {});

interface LiveBase extends ModuleBaseType<typeof liveBaseDef> {}

const liveBaseDef = defineModuleBase({
  id: 'live',
  version,
  provides: [contracts.live],
  contributions: { toCore },
});
const liveBase: LiveBase = liveBaseDef;
const liveDef = defineModule(liveBase, {
  contributes: {
    toCore: {
      extensionPoints: { liveHub: [defineLiveHub((services) => createLiveHub(services))] },
    },
  },
});

/** The live module: provides the `live` contract and fills the core's `liveHub` point with the hub filler (15.4.1); each runtime opens its own hub. */
export interface Live extends ModuleType<typeof liveDef> {}

/** The live module. */
export const live: Live = liveDef;
