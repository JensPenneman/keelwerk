import { type AppType, defineApp } from '@keelwerk/core';
import { libraryApi } from './api-versions.ts';
import { modules } from './modules.ts';

const libraryDef = defineApp({ id: 'library', modules, api: libraryApi });

export interface Library extends AppType<typeof libraryDef> {}
export const library: Library = libraryDef;
