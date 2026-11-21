import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { workerKilledApp } from './support/worker-killed-app.ts';

const childFile = fileURLToPath(new URL('./support/worker-child.ts', import.meta.url));
const packageDir = fileURLToPath(new URL('../..', import.meta.url));
const commandId = '00000000-0000-7000-8000-000000000091';
/** A lease is three heartbeats of ten seconds (9.5.4). */
const leaseMs = 30_000;
const bea = { subject: 'bea', roles: [], claims: {} };

/**
 * Starts the second process. `ready` settles when it says its workers run, or rejects when it ends
 * first. The caller registers the kill of `child` before it waits for `ready`.
 */
function spawnChild(args: readonly string[]): {
  readonly child: ChildProcess;
  readonly ready: Promise<void>;
} {
  const child = spawn(process.execPath, ['--conditions=@keelwerk/source', childFile, ...args], {
    cwd: packageDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise<void>((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('ready')) resolve();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('exit', (code, signal) => {
      reject(new Error(`the child ended before it was ready (${code ?? signal}): ${output}`));
    });
  });
  // A rejection nobody awaits (the test ended before it waited) is not an unhandled error.
  ready.catch(() => undefined);
  return { child, ready };
}

describe('a worker process that is killed mid-job (9.5.4, 21.7, criterion 9)', () => {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  const stops: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    urls = await createTestDatabase('worker_killed');
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  });

  test('a worker process killed with SIGKILL mid-job loses its lease, the job is available again within 30 seconds, the next attempt completes, and the killed attempt left no row (criterion 9)', {
    timeout: 240_000,
  }, async () => {
    const external = { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl };
    // P creates the deployment and only serves: it accepts the command and runs no worker.
    const p = await startTestRuntime(workerKilledApp, { tenants: ['acme'], external });
    stops.push(() => p.stop());
    const tenantId = p.tenants.acme.id;
    const scope = { level: 'tenant', backendId: p.backendId, tenantId } as const;
    // The test arms the child before it accepts the command; the child writes `holding` when the unit
    // of that command stands open after its receipt was completed, with the loan row in it.
    const directory = mkdtempSync(join(tmpdir(), 'worker-killed-'));
    const marker = join(directory, 'holding');
    stops.push(async () => {
      rmSync(directory, { recursive: true, force: true });
    });
    // The kill is registered before the wait for `ready`, and the file's `afterAll` runs it whatever
    // happened: a test that fails, times out or throws while the child still boots cannot leave it
    // alive, and a child that already ended is killed again harmlessly.
    const { child, ready } = spawnChild([
      urls.adminUrl,
      urls.appUrl,
      p.backendId,
      tenantId,
      directory,
    ]);
    stops.push(async () => {
      child.kill('SIGKILL');
    });
    await ready;
    const owner = new pg.Client({ connectionString: urls.adminUrl });
    await owner.connect();
    stops.push(() => owner.end());
    const root = `"${p.namespace.root.replaceAll('"', '""')}"`;
    const jobs = async () =>
      (
        await owner.query<{ state: string; attempt: number; leaseUntil: Date | null }>(
          `select state, attempt, lease_until as "leaseUntil" from ${root}.kw_jobs where queue = 'commands'`,
        )
      ).rows;
    const loans = () =>
      p.adapter.unit(p.namespace, scope, (unit) => {
        const descriptor = workerKilledApp.registry.entities.get('loans.loan')?.descriptor;
        if (descriptor === undefined) throw new Error('the app has no loans.loan entity');
        return unit.rows.count(descriptor);
      });

    // Whatever the deployment's own start enqueued on the command queue has run before the child holds.
    await vi.waitFor(async () => expect(await jobs()).toEqual([]), {
      timeout: 60_000,
      interval: 100,
    });
    writeFileSync(join(directory, 'armed'), 'armed\n');
    const accepting = p.invoker.invoke({
      action: 'loans.lend',
      input: { bookTitle: 'Dune', dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z') },
      carrier: testCarrier(p.tenants.acme, bea),
      requestId: crypto.randomUUID(),
      commandId,
      prefer: 'async',
      signal: new AbortController().signal,
    });
    accepting.catch(() => undefined);
    // The child took the job and its unit stands open after the receipt completed.
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true), {
      timeout: 60_000,
      interval: 50,
    });
    child.kill('SIGKILL');
    await vi.waitFor(
      () => expect(child.exitCode !== null || child.signalCode !== null).toBe(true),
      {
        timeout: 10_000,
      },
    );
    // Read once the child is gone: every lease it wrote was computed before this reading, so a
    // renewal that fell between the kill and its delivery cannot pass the bound.
    const killedAt = Date.now();
    expect((await accepting).ok).toBe(true);

    // Right after the kill the job is running under the dead worker's lease, which ends within 30 s.
    const [dead] = await jobs();
    expect(dead).toMatchObject({ state: 'running', attempt: 1 });
    const leaseUntil = dead?.leaseUntil;
    if (leaseUntil === null || leaseUntil === undefined) throw new Error('the job has no lease');
    expect(leaseUntil.getTime()).toBeLessThanOrEqual(killedAt + leaseMs);
    expect(await loans()).toBe(0);

    // R joins with workers; once the lease ended it takes the job and completes the second attempt.
    const r = await startTestRuntime(workerKilledApp, {
      tenants: ['acme'],
      external,
      join: { backendId: p.backendId, tenants: { acme: tenantId } },
      workers: { queues: ['commands'] },
    });
    stops.push(() => r.stop());
    // R's test resolver rebuilds the principal of the job only for one it has seen.
    await r.invoker.invoke({
      action: 'loans.about',
      input: {},
      carrier: testCarrier(r.tenants.acme, bea),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    // The rest of the dead worker's lease is a wait of its own, decided by the clock: at most
    // `leaseMs` after the kill. The bound that follows covers only R's take (its poll is about one
    // second) and the run of the second attempt.
    const leaseLeft = Math.max(0, leaseUntil.getTime() - Date.now());
    await new Promise((resolve) => setTimeout(resolve, leaseLeft));
    await vi.waitFor(
      async () => {
        const receipt = await p.adapter.unit(p.namespace, scope, (unit) =>
          unit.receipts.get(commandId),
        );
        expect(receipt?.status, JSON.stringify(receipt?.outcome)).toBe('completed');
      },
      { timeout: 60_000, interval: 500 },
    );
    const history = (
      await owner.query<{ outcome: string; attempts: number; startedAt: Date }>(
        `select outcome, attempts, started_at as "startedAt" from ${root}.kw_job_history where queue = 'commands'`,
      )
    ).rows;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ outcome: 'succeeded', attempts: 2 });
    // Nobody took the job before the dead worker's lease ended.
    expect(history[0]?.startedAt.getTime()).toBeGreaterThanOrEqual(leaseUntil.getTime());
    expect(await jobs()).toEqual([]);
    // One loan: the killed attempt's insert is absent, and the second attempt did not fail alreadyLent.
    expect(await loans()).toBe(1);
  });
});
