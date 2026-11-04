import { defineModule, defineModuleBase } from '@keelwerk/core';
import type { DemoBase } from './demo-types.ts';

export const demoBase = defineModuleBase({ id: 'demo' }); // expect: plugin/named-module-types

export const namedBase: DemoBase = defineModuleBase({ id: 'named' });

export const demo = defineModule(demoBase, { id: 'demo' }); // expect: plugin/named-module-types
