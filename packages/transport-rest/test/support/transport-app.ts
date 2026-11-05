import { type AppType, defineApiVersions, defineApp } from '@keelwerk/core';
import { library, loans } from '@keelwerk/testing/fixtures';
import { rest } from '@keelwerk/transport-rest';

const definition = defineApp({
  id: 'transport',
  modules: [library, loans, rest],
  execution: { 'loans.lend': 'either' },
  api: defineApiVersions({ '2026-11-04': {} }),
});

/** The fixture modules of the suite with the REST module composed in. */
export interface TransportWithRest extends AppType<typeof definition> {}
export const transportWithRest: TransportWithRest = definition;
