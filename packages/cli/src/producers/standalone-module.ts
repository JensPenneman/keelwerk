import type { EntityEntry } from '@keelwerk/core';

/** What a module package describes when it stands alone: its id and the entities of an app of it. */
export interface StandaloneModule {
  readonly id: string;
  readonly entries: readonly EntityEntry[];
}
