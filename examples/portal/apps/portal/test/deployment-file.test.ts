import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRuntime } from '@keelwerk/core';
import { afterEach, describe, expect, test, vi } from 'vitest';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('the portal deployment file', () => {
  test('is a defineDeployment value with a PGlite entry, and it boots on PGlite through the runtime-owned host', {
    timeout: 120_000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-portal-deployment-'));
    directories.push(directory);
    vi.stubEnv('PORT', '0');
    vi.stubEnv('KEELWERK_HOST', '127.0.0.1');
    vi.stubEnv('KEELWERK_LEDGER', join(directory, 'ledger.log'));
    const loaded: unknown = await import(
      new URL('../../../.launchway/deployment.ts', import.meta.url).href
    );
    const deployment = (
      loaded as { default: Parameters<typeof startRuntime>[0] & { kind?: string } }
    ).default;
    expect(deployment.kind).toBe('deployment');
    expect(deployment.infrastructure).toContainEqual(expect.objectContaining({ id: 'pglite' }));
    const runtime = await startRuntime(
      {
        ...deployment,
        control: { adapter: 'pglite' },
        placements: { default: { adapter: 'pglite', strategy: 'shared-tables' } },
      },
      {
        role: 'all',
        listen: true,
        environment: 'test',
        env: Object.fromEntries([['KEELWERK_MASTER_KEY', randomBytes(32).toString('base64')]]),
      },
    );
    try {
      expect(runtime.port).toBeGreaterThan(0);
      const health = await fetch(`http://127.0.0.1:${runtime.port}/_keelwerk/health`);
      expect(health.status).toBe(200);
      await health.arrayBuffer();
    } finally {
      const started = performance.now();
      await runtime.stop(1000);
      expect(performance.now() - started).toBeLessThan(2000);
    }
  });
});
