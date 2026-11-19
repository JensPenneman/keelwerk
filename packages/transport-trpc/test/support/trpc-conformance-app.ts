import { type AppType, defineApiVersions, defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { library, loans } from '@keelwerk/testing/fixtures';
import { trpc } from '../../src/module.ts';

const definition = defineApp({
  id: 'trpc-conformance',
  modules: [live, library, loans, trpc],
  execution: { 'loans.lend': 'either' },
  api: defineApiVersions({
    '2026-11-04': { deprecated: { at: '2026-11-05', sunset: '2099-12-31' } },
    '2026-11-11': {},
  }),
});

/** The fixture modules with the live module and the tRPC module composed in, at an older API version that is deprecated and a head. */
export interface TrpcConformanceApp extends AppType<typeof definition> {}
export const trpcConformanceApp: TrpcConformanceApp = definition;

/** The two API versions of the conformance app: the deprecated one a tenant can be pinned to, and the head. */
export const trpcConformanceVersions = { older: '2026-11-04', head: '2026-11-11' } as const;
