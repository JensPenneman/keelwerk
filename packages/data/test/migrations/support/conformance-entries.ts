import type { EntityEntry } from '@keelwerk/core';
import { conformanceApp } from '@keelwerk/testing/fixtures';

/** The entities of the conformance fixture app: core, library, and loans with its contribution and conditional part. */
export const conformanceEntries: readonly EntityEntry[] = [
  ...conformanceApp.registry.entities.values(),
];
