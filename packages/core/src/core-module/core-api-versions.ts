import { type ApiVersions, defineApiVersions } from '../dsl/define-api-versions.ts';
import type { Empty } from '../types/empty.ts';

/** The dated API versions of the operator endpoint, maintained by the framework (S-33, section 18.3). */
export const coreApiVersions: ApiVersions<{ readonly '2026-11-04': Empty }> = defineApiVersions({
  '2026-11-04': {},
});
