import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { device } from './device.ts';
import { position } from './position.ts';

const trailBaseDef = defineModuleBase({
  id: 'trail',
  version: '0.1.0',
  entities: { device, position },
});

export interface TrailBase extends ModuleBaseType<typeof trailBaseDef> {}
export const trailBase: TrailBase = trailBaseDef;
