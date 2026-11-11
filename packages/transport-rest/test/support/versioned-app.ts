import { type AppType, defineApiVersions, defineApp } from '@keelwerk/core';
import { roster } from '@keelwerk/testing/fixtures';
import { rest } from '@keelwerk/transport-rest';

const definition = defineApp({
  id: 'versioned',
  modules: [roster, rest],
  api: defineApiVersions({
    '2026-11-04': {},
    '2026-11-11': { changes: ['roster.contactDisplayName'] },
  }),
});

/** The roster fixture, whose version change renames a field, with the REST module composed in. */
export interface VersionedWithRest extends AppType<typeof definition> {}
export const versionedWithRest: VersionedWithRest = definition;
