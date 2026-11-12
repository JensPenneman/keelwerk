import { defineApiVersions, defineApp } from '@keelwerk/core';
import { library, loans } from '@keelwerk/testing/fixtures';
import { apiKeys } from '../../src/module.generated.ts';
import { later } from './later/module.ts';

/**
 * The module with three modules to act on: `library` (reads and writes), `loans` (an action that
 * runs asynchronously on request) and `later` (work queued for a later instant). The older API version is retired on 2026-12-02.
 */
export const keysApp = defineApp({
  id: 'keys',
  modules: [apiKeys, library, loans, later] as const,
  api: defineApiVersions({
    '2026-11-04': { deprecated: { at: '2026-11-10', sunset: '2026-12-01' } },
    '2026-11-11': {},
  }),
});
