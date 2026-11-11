import { type AppType, defineApp } from '@keelwerk/core';
import { ticker } from './ticker-module.ts';

const tickerAppDef = defineApp({ id: 'tickerapp', modules: [ticker] as const });
interface TickerAppType extends AppType<typeof tickerAppDef> {}

/** The ticker app: schedules that tick in every tenant and in the backend, timers and cross-scope commands. */
export const tickerApp: TickerAppType = tickerAppDef;
export type TickerApp = TickerAppType;
