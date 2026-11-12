import {
  applicationRoleDdl,
  frameworkSteps,
  frameworkTablesDdl,
  rlsPoliciesDdl,
} from '@keelwerk/data';
import pg from 'pg';

/**
 * Creates an application root and the control root as the owner: framework tables, forced
 * row-level security and the grants of the `kw_app` role.
 */
export async function prepareNamespaces(adminUrl: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const roots = [
      { root: 'app', control: false },
      { root: 'kw__control', control: true },
    ];
    for (const { root, control } of roots) {
      const options = { control };
      const statements = [
        ...frameworkTablesDdl(root, options),
        ...rlsPoliciesDdl(root, options),
        ...applicationRoleDdl(root, 'kw_app', options),
      ];
      // The control root also takes the tables of step 0002 (kw_api_usage among them).
      const second = control ? frameworkSteps.find((step) => step.id === '0002') : undefined;
      if (second !== undefined) {
        statements.push(...second.ddl(root, options), ...second.grants(root, 'kw_app', options));
      }
      for (const statement of statements) await admin.query(statement);
    }
  } finally {
    await admin.end();
  }
}
