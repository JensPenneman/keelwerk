import { defineApiVersions } from '@keelwerk/core';

export const versionedApi = defineApiVersions({
  '2026-11-04': {},
  '2026-11-11': { changes: ['roster.contactDisplayName'] },
});
