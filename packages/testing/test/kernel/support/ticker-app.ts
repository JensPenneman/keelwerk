import { type AppType, defineApp } from '@keelwerk/core';
import { echo } from './echo-module.ts';
import { ticker } from './ticker-module.ts';

const tickerAppDef = defineApp({ id: 'tickerapp', modules: [ticker, echo] as const });
interface TickerAppType extends AppType<typeof tickerAppDef> {}

/**
 * The ticker app: schedules that tick in every tenant and in the backend, timers and cross-scope
 * commands, and a second module, echo, whose timer has the same key as ticker's and a keyed
 * enqueue under ticker's key.
 */
export const tickerApp: TickerAppType = tickerAppDef;
export type TickerApp = TickerAppType;
