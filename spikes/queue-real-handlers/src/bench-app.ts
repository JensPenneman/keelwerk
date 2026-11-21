import { type AppType, defineApp } from '@keelwerk/core';
import { bench } from './bench-module.ts';
import { watch } from './watch-module.ts';

const plainAppDef = defineApp({ id: 'queue-real-handlers', modules: [bench] });
const reactionAppDef = defineApp({ id: 'queue-real-handlers-reactions', modules: [bench, watch] });

export interface PlainApp extends AppType<typeof plainAppDef> {}
export interface ReactionApp extends AppType<typeof reactionAppDef> {}

/** The app with the commands and the effect, and the app that adds the reaction job's module. */
export const plainApp: PlainApp = plainAppDef;
export const reactionApp: ReactionApp = reactionAppDef;
