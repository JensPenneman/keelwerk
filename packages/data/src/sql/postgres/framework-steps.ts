import { applicationRoleDdl } from './application-role.ts';
import type { FrameworkStep } from './framework-step.ts';
import { frameworkTablesDdl } from './framework-tables.ts';
import { kwJobsQueuedDdl } from './kw-jobs-queued-ddl.ts';
import { ledgerIndexesDdl } from './ledger-indexes.ts';
import { m2ApplicationRoleDdl } from './m2-application-role.ts';
import { m2FrameworkTablesDdl } from './m2-framework-tables.ts';
import { m2RlsPoliciesDdl } from './m2-rls-policies.ts';
import { rlsPoliciesDdl } from './rls-policies.ts';
import { transientPurgeDdl } from './transient-purge-ddl.ts';
import { transientPurgeRoleDdl } from './transient-purge-role-ddl.ts';

/**
 * The framework track in order: step 0001 is the M1 tables, policies and grants; step 0002 adds
 * the M2 tables (S-117); step 0003 adds the indexes of the control ledger (a namespace root records
 * it with no statement); step 0004 adds the function through which the application role purges transient
 * event records (the retention worker) and the columns of a retention run's outcome; step 0005 adds
 * the partial index of the jobs that wait to run. Never edited: a new framework table is a new step.
 */
export const frameworkSteps: readonly FrameworkStep[] = [
  {
    id: '0001',
    marker: 'kw_migrations',
    ddl: (root, options) => [
      ...frameworkTablesDdl(root, options),
      ...rlsPoliciesDdl(root, options),
    ],
    grants: applicationRoleDdl,
  },
  {
    id: '0002',
    marker: 'kw_consumers',
    ddl: (root, options) => [
      ...m2FrameworkTablesDdl(root, options),
      ...m2RlsPoliciesDdl(root, options),
    ],
    grants: m2ApplicationRoleDdl,
  },
  {
    id: '0003',
    marker: 'kw_ledger_erasure_identity',
    ddl: (root, options) => (options.control === true ? ledgerIndexesDdl(root) : []),
    grants: () => [],
  },
  {
    id: '0004',
    marker: 'kw_events_transient',
    ddl: transientPurgeDdl,
    grants: transientPurgeRoleDdl,
  },
  {
    id: '0005',
    marker: 'kw_jobs_queued',
    ddl: kwJobsQueuedDdl,
    grants: () => [],
  },
];
