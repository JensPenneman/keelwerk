import { type AppType, defineApiVersions, defineApp } from '@keelwerk/core';
import { library, loans } from '@keelwerk/testing/fixtures';
import { graphql } from '../../src/module.ts';

const definition = defineApp({
  id: 'transport',
  modules: [library, loans, graphql],
  execution: { 'loans.lend': 'either' },
  api: defineApiVersions({ '2026-11-04': {} }),
});

/** The fixture modules of the suite with the GraphQL module composed in. */
export interface TransportWithGraphql extends AppType<typeof definition> {}
export const transportWithGraphql: TransportWithGraphql = definition;
