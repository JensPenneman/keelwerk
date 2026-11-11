import process from 'node:process';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { bootHooks } from './hooks-kit.ts';

// A second process of the kill test: argv adminUrl appUrl endpoint backendId tenantId. It joins the
// deployment the parent created and works the effect queues until the parent kills it.
const [adminUrl, appUrl, endpoint, backendId, tenantId] = process.argv.slice(2);
if (
  adminUrl === undefined ||
  appUrl === undefined ||
  endpoint === undefined ||
  backendId === undefined ||
  tenantId === undefined
) {
  throw new Error('usage: executor-child <adminUrl> <appUrl> <endpoint> <backendId> <tenantId>');
}
await bootHooks({
  adapter: 'memory',
  endpoint,
  external: { factory: postgresAdapter({ ownerUrl: adminUrl }), url: appUrl },
  join: { backendId, tenants: { acme: tenantId } },
});
process.stdout.write('ready\n');
await new Promise<never>(() => undefined);
