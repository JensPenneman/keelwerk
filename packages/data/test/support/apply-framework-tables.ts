import type { Client } from 'pg';
import { applicationRoleDdl, frameworkTablesDdl, rlsPoliciesDdl } from '../../src/index.ts';
import { control } from './control.ts';
import { ns } from './ns.ts';

/** The tables, policies and application role of the namespace root and of the control root. */
export async function applyFrameworkTables(admin: Client): Promise<void> {
  for (const [root, options] of [
    [ns, {}],
    [control, { control: true }],
  ] as const) {
    for (const statement of [
      ...frameworkTablesDdl(root, options),
      ...rlsPoliciesDdl(root, options),
      ...applicationRoleDdl(root, 'kw_app', options),
    ]) {
      await admin.query(statement);
    }
  }
}
