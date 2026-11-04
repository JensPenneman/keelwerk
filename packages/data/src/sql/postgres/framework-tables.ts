import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { kwEvents } from './kw-events.ts';
import { kwIndexKeys } from './kw-index-keys.ts';
import { kwJobGroups } from './kw-job-groups.ts';
import { kwJobHistory } from './kw-job-history.ts';
import { kwJobLaneCounts } from './kw-job-lane-counts.ts';
import { kwJobLanes } from './kw-job-lanes.ts';
import { kwJobs } from './kw-jobs.ts';
import { kwMigrations } from './kw-migrations.ts';
import { kwPositions } from './kw-positions.ts';
import { kwRateBuckets } from './kw-rate-buckets.ts';
import { kwScopeKeys } from './kw-scope-keys.ts';
import { kwSerials } from './kw-serials.ts';
import { kwShapes } from './kw-shapes.ts';
import { kwSubjectKeys } from './kw-subject-keys.ts';
import { kwSubjectRefs } from './kw-subject-refs.ts';
import { kwUsage } from './kw-usage.ts';
import { kwValueKeys } from './kw-value-keys.ts';

/**
 * The DDL statements of every M1 framework table of a namespace, in dependency order, for the
 * namespace root `root`. The control store's root (`kw__control`, S-09) also gets `kw_scope_keys`
 * (S-55). Stored format: final from M1, changed only by migration steps.
 */
export function frameworkTablesDdl(
  root: string,
  options: { readonly control?: boolean } = {},
): readonly string[] {
  const schema = assertNamespaceRoot(root);
  return [
    `create schema "${schema}"`,
    ...kwPositions(schema),
    ...kwShapes(schema),
    ...kwEvents(schema),
    ...kwJobLanes(schema),
    ...kwJobLaneCounts(schema),
    ...kwJobGroups(schema),
    ...kwJobs(schema),
    ...kwJobHistory(schema),
    ...kwSerials(schema),
    ...kwUsage(schema),
    ...kwRateBuckets(schema),
    ...kwSubjectKeys(schema),
    ...kwValueKeys(schema),
    ...kwIndexKeys(schema),
    ...kwSubjectRefs(schema),
    ...kwMigrations(schema),
    ...(options.control === true ? kwScopeKeys(schema) : []),
  ];
}
