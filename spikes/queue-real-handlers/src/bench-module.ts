import { defineModule, type ModuleType } from '@keelwerk/core';
import { record, request } from './bench-actions.ts';
import { benchBase } from './bench-base.ts';
import { touch, touchExecutor } from './bench-touch.ts';

const benchDef = defineModule(benchBase, {
  actions: { record, request },
  effects: { touch },
  executors: { touch: touchExecutor },
});

export interface Bench extends ModuleType<typeof benchDef> {}
export const bench: Bench = benchDef;
