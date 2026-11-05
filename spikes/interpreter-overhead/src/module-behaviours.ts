import type { EntityBehaviours } from '@keelwerk/core';
import { entityBehavioursOf } from '@keelwerk/core';
import type { BenchApp } from './bench-app.ts';

/** The entity behaviours of the bench app's modules. */
export const moduleBehaviours = (app: BenchApp): EntityBehaviours =>
  entityBehavioursOf(app.modules);
