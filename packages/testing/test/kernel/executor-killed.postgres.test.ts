import { type ChildProcess, spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { startHookEndpoint } from './support/hook-endpoint.ts';
import { bootHooks } from './support/hooks-kit.ts';
import { attemptsOf, effectOf, rowsOf } from './support/hooks-reads.ts';

const childFile = fileURLToPath(new URL('./support/executor-child.ts', import.meta.url));
const packageDir = fileURLToPath(new URL('../..', import.meta.url));

/** Starts the second process and settles when it says its workers run. */
function spawnChild(args: readonly string[]): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--conditions=@keelwerk/source', childFile, ...args], {
    cwd: packageDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('ready')) resolve(child);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('exit', (code, signal) => {
      reject(new Error(`the child ended before it was ready (${code ?? signal}): ${output}`));
    });
  });
}

describe('an executing process that is killed (7.9.5, D1, criterion 10)', () => {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  const stops: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    urls = await createTestDatabase('executor_killed');
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  });

  test('a process killed after the destination received the post leaves an open attempt, and the next taker settles abandoned without posting again', {
    timeout: 180_000,
  }, async () => {
    let child: ChildProcess | undefined;
    // The destination kills the process that posted, on the first request, and never answers it.
    const endpoint = await startHookEndpoint((index) => {
      if (index === 0) child?.kill('SIGKILL');
      return index === 0 ? 'hang' : 200;
    });
    stops.push(() => endpoint.close());
    const external = { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl };

    // P creates the deployment and only serves: it requests the effect and runs no worker.
    const p = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external,
      serveOnly: true,
    });
    stops.push(() => p.runtime.stop());
    const tenantId = p.runtime.tenants.acme.id;
    child = await spawnChild([
      urls.adminUrl,
      urls.appUrl,
      endpoint.url,
      p.runtime.backendId,
      tenantId,
    ]);
    stops.push(async () => {
      child?.kill('SIGKILL');
    });

    await p.client.invoke('hooks.notify', { payload: 'killed mid-attempt' });
    await vi.waitFor(() => expect(endpoint.requests).toHaveLength(1), { timeout: 60_000 });
    await vi.waitFor(
      () => expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true),
      {
        timeout: 10_000,
      },
    );
    const requested = await effectOf(p, 'hooks.post');
    expect(requested).toMatchObject({ status: 'requested' });
    // The start record is committed and there is no end record: the attempt may have acted.
    const open = await attemptsOf(p, String(requested?.id));
    expect(open).toHaveLength(1);
    expect(open[0]).not.toHaveProperty('endedAt');

    // R joins with workers; when the dead process's lease expires R takes the job and finds the open attempt.
    const r = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external,
      join: { backendId: p.runtime.backendId, tenants: { acme: tenantId } },
    });
    stops.push(() => r.runtime.stop());
    await vi.waitFor(
      async () => {
        expect((await effectOf(p, 'hooks.post'))?.status).toBe('abandoned');
      },
      { timeout: 120_000, interval: 1000 },
    );
    const effect = await effectOf(p, 'hooks.post');
    expect(effect).toMatchObject({
      status: 'abandoned',
      attempts: 1,
      error: { kind: 'unavailable', code: 'core.effect_outcome_unknown', retryable: false },
    });
    // The destination received the post once and is not asked again.
    expect(endpoint.requests).toHaveLength(1);
    await vi.waitFor(
      async () => {
        expect((await rowsOf(p, 'hooks.delivery'))[0]).toMatchObject({ status: 'failed' });
      },
      { timeout: 30_000, interval: 500 },
    );
    expect(await attemptsOf(p, String(effect?.id))).toHaveLength(1);
  });
});
