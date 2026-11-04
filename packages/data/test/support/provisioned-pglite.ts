import { frameworkTablesDdl, rlsPoliciesDdl } from '../../src/index.ts';
import {
  type PgliteAdapter,
  type PgliteAdapterOptions,
  pgliteAdapter,
  provisionApplicationRole,
} from '../../src/pglite/index.ts';
import { control } from './control.ts';
import { deployment } from './deployment.ts';
import { ns } from './ns.ts';

/** Creates the tables and policies of both roots unless they exist, then the role and its grants. */
async function provision(adapter: PgliteAdapter): Promise<void> {
  await adapter.asOwner(async (database) => {
    const present = await database.query(
      'select 1 from information_schema.schemata where schema_name = $1',
      [ns],
    );
    for (const [root, options] of [
      [ns, {}],
      [control, { control: true }],
    ] as const) {
      if (present.rows.length === 0) {
        for (const statement of [
          ...frameworkTablesDdl(root, options),
          ...rlsPoliciesDdl(root, options),
        ]) {
          await database.query(statement);
        }
      }
      await provisionApplicationRole(database, { root, role: 'kw_app', ...options });
    }
  });
}

/** A connected PGlite adapter whose namespace and control roots are provisioned. */
export async function provisionedPglite(
  options: PgliteAdapterOptions = {},
): Promise<PgliteAdapter> {
  const adapter = pgliteAdapter({ deploymentId: deployment, ...options });
  await adapter.connect();
  await provision(adapter);
  return adapter;
}
