import { type AppType, defineApp } from '@keelwerk/core';
import { bench } from './bench-module.ts';

const benchAppDef = defineApp({ id: 'interpreter-overhead', modules: [bench] });

export interface BenchApp extends AppType<typeof benchAppDef> {}
export const benchApp: BenchApp = benchAppDef;
