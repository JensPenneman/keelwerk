import {
  type AppType,
  contracts,
  defineApp,
  defineModule,
  defineModuleBase,
  type ModuleBaseType,
  type ModuleType,
} from '@keelwerk/core';
import { library, loans } from '@keelwerk/testing/fixtures';

interface LiveBase extends ModuleBaseType<typeof liveBaseDef> {}

const liveBaseDef = defineModuleBase({
  id: 'live',
  version: '0.1.0',
  provides: [contracts.live],
  generates: ['watch'],
});
const liveBase: LiveBase = liveBaseDef;
const liveDef = defineModule(liveBase, {});
interface Live extends ModuleType<typeof liveDef> {}
const live: Live = liveDef;

const liveAppDef = defineApp({ id: 'live-app', modules: [library, loans, live] as const });

/** An app whose modules include a provider of the live contract, so subscriptions exist. */
export interface LiveApp extends AppType<typeof liveAppDef> {}
