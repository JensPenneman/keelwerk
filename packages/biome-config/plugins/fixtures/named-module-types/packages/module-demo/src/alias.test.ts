import { defineModuleBase } from '@keelwerk/core';

const authBaseDef = defineModuleBase({ id: 'auth' });
export const authBase = authBaseDef; // expect: plugin/named-module-types
