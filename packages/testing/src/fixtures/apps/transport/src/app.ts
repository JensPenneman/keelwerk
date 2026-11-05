import { type AppType, defineApp } from '@keelwerk/core';
import { transportApi } from './api-versions.ts';
import { modules } from './modules.ts';

const transportDef = defineApp({
  id: 'transport',
  modules,
  execution: { 'loans.lend': 'either' },
  api: transportApi,
});

export interface Transport extends AppType<typeof transportDef> {}
export const transport: Transport = transportDef;
