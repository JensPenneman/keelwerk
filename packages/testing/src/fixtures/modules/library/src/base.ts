import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { book } from './entities/book.ts';

const libraryBaseDef = defineModuleBase({
  id: 'library',
  version: '0.1.0',
  entities: { book },
});

export interface LibraryBase extends ModuleBaseType<typeof libraryBaseDef> {}
export const libraryBase: LibraryBase = libraryBaseDef;
