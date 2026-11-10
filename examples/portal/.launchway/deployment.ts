import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { byHeader, byHostname, defineDeployment, env, secret } from '@keelwerk/core';
import { ledgerFile } from '@keelwerk/core/ledger';
import { schemaPlanner } from '@keelwerk/data';
import { pgliteAdapterFactory } from '@keelwerk/data/pglite';
import { httpHost } from '@keelwerk/transport-http';
import { portal } from '@keelwerk-examples/app-portal';

/**
 * The portal's deployment (section 4.6): PostgreSQL addressed by the environment in production.
 * `keelwerk dev` swaps the data layer, the ledger and the operator socket for PGlite below
 * `.keelwerk/`, so the three database settings below are read by `keelwerk start` alone.
 * The PGlite entry lets a placement or the control store run on `adapter: 'pglite'` without a server.
 */
const deployment = defineDeployment({
  apps: [portal],
  infrastructure: [
    postgresAdapter(),
    pgliteAdapterFactory(),
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
  tenantResolution: [byHeader('x-keelwerk-tenant'), byHostname()],
  keys: { masterKey: secret('KEELWERK_MASTER_KEY') },
});

export default deployment;
