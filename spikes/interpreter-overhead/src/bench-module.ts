import { defineModule, type ModuleType } from '@keelwerk/core';
import { benchBase } from './bench-base.ts';
import {
  generatorAll,
  generatorFlag,
  generatorNewId,
  generatorUnbatched,
  plainDecision,
  seedItem,
} from './handlers.ts';

const benchDef = defineModule(benchBase, {
  actions: {
    generatorAll,
    generatorFlag,
    generatorNewId,
    generatorUnbatched,
    plainDecision,
    seedItem,
  },
});

export interface Bench extends ModuleType<typeof benchDef> {}
export const bench: Bench = benchDef;
