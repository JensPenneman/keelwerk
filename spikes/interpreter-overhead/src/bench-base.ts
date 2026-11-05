import { defineFlag, defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { benchItem } from './bench-item.ts';

const benchBaseDef = defineModuleBase({
  id: 'bench',
  version: '0.1.0',
  entities: { item: benchItem },
  flags: {
    enabled: defineFlag({
      kind: 'boolean',
      default: true,
      level: 'tenant',
      purpose: 'operational',
    }),
  },
});

export interface BenchBase extends ModuleBaseType<typeof benchBaseDef> {}
export const benchBase: BenchBase = benchBaseDef;
