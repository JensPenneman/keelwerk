import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { jobSpy } from './job-spy.ts';
import { workerKilledApp } from './worker-killed-app.ts';

// A second process of the worker kill test: argv adminUrl appUrl backendId tenantId directory. It joins the
// deployment the parent created and works the command queue. The unit of the first command it runs
// stops after the receipt was completed, with the loan row inserted in the open transaction and the
// job not completed: it writes the `holding` file and waits for the parent's SIGKILL. It holds only
// once the parent wrote the `armed` file, so the receipts the deployment completes while it starts
// pass.
const [adminUrl, appUrl, backendId, tenantId, directory] = process.argv.slice(2);
if (
  adminUrl === undefined ||
  appUrl === undefined ||
  backendId === undefined ||
  tenantId === undefined ||
  directory === undefined
) {
  throw new Error('usage: worker-child <adminUrl> <appUrl> <backendId> <tenantId> <directory>');
}
const { spy, factory } = jobSpy(() => undefined, postgresAdapter({ ownerUrl: adminUrl }));
let held = false;
spy.afterReceiptComplete = async () => {
  if (held || !existsSync(join(directory, 'armed'))) return;
  held = true;
  writeFileSync(join(directory, 'holding'), 'holding\n');
  await new Promise<never>(() => undefined);
};
const runtime = await startTestRuntime(workerKilledApp, {
  tenants: ['acme'],
  external: { factory, url: appUrl },
  join: { backendId, tenants: { acme: tenantId } },
  workers: { queues: ['commands'] },
});
// The test resolver of a process rebuilds a principal it has seen: this one sees `bea`, whose command
// the job runs.
await runtime.invoker.invoke({
  action: 'loans.about',
  input: {},
  carrier: testCarrier(runtime.tenants.acme, { subject: 'bea', roles: [], claims: {} }),
  requestId: crypto.randomUUID(),
  signal: new AbortController().signal,
});
process.stdout.write('ready\n');
await new Promise<never>(() => undefined);
