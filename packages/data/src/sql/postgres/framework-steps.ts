import { applicationRoleDdl } from './application-role.ts';
import type { FrameworkStep } from './framework-step.ts';
import { frameworkTablesDdl } from './framework-tables.ts';
import { m2ApplicationRoleDdl } from './m2-application-role.ts';
import { m2FrameworkTablesDdl } from './m2-framework-tables.ts';
import { m2RlsPoliciesDdl } from './m2-rls-policies.ts';
import { rlsPoliciesDdl } from './rls-policies.ts';

/**
 * The framework track in order: step 0001 is the M1 tables, policies and grants; step 0002 adds
 * the M2 tables (S-117). Never edited: a new framework table is a new step.
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
];
