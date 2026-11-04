import { type AppType, defineApp } from '@keelwerk/core';
import { github } from './github/github.ts';
import { trail } from './trail/trail.ts';

const spikeAppDef = defineApp({ id: 'prepare-spike', modules: [trail, github] });

export interface SpikeApp extends AppType<typeof spikeAppDef> {}
export const spikeApp: SpikeApp = spikeAppDef;
