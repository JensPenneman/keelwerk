import { type AppType, defineApp } from '@keelwerk/core';
import { versionedApi } from './api-versions.ts';
import { modules } from './modules.ts';

const versionedDef = defineApp({ id: 'versioned', modules, api: versionedApi });

export interface Versioned extends AppType<typeof versionedDef> {}
export const versioned: Versioned = versionedDef;
