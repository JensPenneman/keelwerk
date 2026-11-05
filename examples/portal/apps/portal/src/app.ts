import { type AppType, defineApp } from '@keelwerk/core';
import { portalApi } from './api-versions.ts';
import { modules } from './modules.ts';

const portalDef = defineApp({
  id: 'portal',
  modules,
  api: portalApi,
});

export interface Portal extends AppType<typeof portalDef> {}
export const portal: Portal = portalDef;
