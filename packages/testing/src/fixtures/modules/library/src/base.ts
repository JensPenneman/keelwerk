import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { book } from './entities/book.ts';
import { newFlow } from './flags/new-flow.ts';

const libraryBaseDef = defineModuleBase({
  id: 'library',
  version: '0.1.0',
  entities: { book },
  flags: { newFlow },
});

export interface LibraryBase extends ModuleBaseType<typeof libraryBaseDef> {}
export const libraryBase: LibraryBase = libraryBaseDef;
