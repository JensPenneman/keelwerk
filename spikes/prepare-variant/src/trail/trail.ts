import { defineModule, type ModuleType } from '@keelwerk/core';
import { ingestPositions as ingestPositionsInline } from '../inline-before-load/ingest-positions.ts';
import { ingestPositions } from '../separate-prepare/ingest-positions.ts';
import { registerDevice } from './register-device.ts';
import { trailBase } from './trail-base.ts';

const trailDef = defineModule(trailBase, {
  actions: { ingestPositions, ingestPositionsInline, registerDevice },
});

export interface Trail extends ModuleType<typeof trailDef> {}
export const trail: Trail = trailDef;
