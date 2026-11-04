import { type AppType, defineApp } from '@keelwerk/core';
import { conformanceApi } from './api-versions.ts';
import { modules } from './modules.ts';

const conformanceDef = defineApp({
  id: 'conformance',
  modules,
  execution: { 'loans.lend': 'sync' },
  api: conformanceApi,
});

export interface Conformance extends AppType<typeof conformanceDef> {}
export const conformance: Conformance = conformanceDef;
