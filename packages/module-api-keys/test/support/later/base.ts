import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { library } from '@keelwerk/testing/fixtures';

const laterBaseDef = defineModuleBase({ id: 'later', version: '0.0.0', requires: [library] });

export interface LaterBase extends ModuleBaseType<typeof laterBaseDef> {}
export const laterBase: LaterBase = laterBaseDef;
