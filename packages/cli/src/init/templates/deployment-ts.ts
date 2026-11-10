import { camelFromKebab } from '@keelwerk/core';
import type { InitNames } from '../init-names.ts';

/**
 * `.launchway/deployment.ts` (section 4.6): the app's deployment, the only default export of the
 * project, written with `defineDeployment`, whose value is what `startRuntime` takes (section 3.3).
 * `keelwerk dev` swaps the data layer for PGlite, so the PostgreSQL settings below apply to
 * `keelwerk start` alone.
 */
export function deploymentTs(names: InitNames): string {
  const app = camelFromKebab(names.app);
  return `import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { byHeader, defineDeployment, env, secret } from '@keelwerk/core';
import { ledgerFile } from '@keelwerk/core/ledger';
import { schemaPlanner } from '@keelwerk/data';
import { httpHost } from '@keelwerk/transport-http';
import { ${app} } from '../apps/${names.app}/src/app.ts';

const deployment = defineDeployment({
  apps: [${app}],
  infrastructure: [
    postgresAdapter(),
    schemaPlanner(),
    httpHost({
      listen: {
        port: Number(process.env.PORT ?? 3000),
        hostname: process.env.KEELWERK_HOST ?? '127.0.0.1',
      },
    }),
    ledgerFile({ path: process.env.KEELWERK_LEDGER ?? '/var/lib/keelwerk/ledger/ledger.log' }),
  ],
  control: { adapter: 'postgres', url: env('KEELWERK_CONTROL_URL') },
  placements: {
    default: { adapter: 'postgres', url: env('KEELWERK_DATA_URL'), strategy: 'shared-tables' },
  },
  tenantResolution: [byHeader('x-keelwerk-tenant')],
  keys: { masterKey: secret('KEELWERK_MASTER_KEY') },
});

export default deployment;
`;
}
