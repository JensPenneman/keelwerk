import { type AppType, defineApp } from '@keelwerk/core';
import { relay } from './relay-module.ts';
import { watch } from './watch-module.ts';

const relayAppDef = defineApp({ id: 'relayapp', modules: [relay, watch] as const });
interface RelayAppType extends AppType<typeof relayAppDef> {}

/** The relay app: signals, the reactions that answer them and the process that tallies them, and a module that watches them. */
export const relayApp: RelayAppType = relayAppDef;
export type RelayApp = RelayAppType;
