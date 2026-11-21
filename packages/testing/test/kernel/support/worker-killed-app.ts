import type { AppType } from '@keelwerk/core';
import { defineApp } from '@keelwerk/core';
import { loans } from '../../../src/fixtures/index.ts';

const workerKilledDef = defineApp({ id: 'killed', modules: [loans] });

/** The app of the worker kill test: the loans module only, whose `loans.lend` runs either way. */
export interface WorkerKilledApp extends AppType<typeof workerKilledDef> {}
export const workerKilledApp: WorkerKilledApp = workerKilledDef;
