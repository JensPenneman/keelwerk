import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { devPgliteFactory } from '../src/dev/dev-pglite-factory.ts';

const scratch: string[] = [];

afterEach(async () => {
  for (const directory of scratch.splice(0)) await rm(directory, { recursive: true, force: true });
});

test('reports the one-process capability of PGlite, so the core opens no concurrent units on it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'keelwerk-pglite-'));
  scratch.push(directory);
  const adapter = devPgliteFactory().create(
    { id: 'main', strategy: 'shared-tables', url: join(directory, 'db') },
    {
      deploymentId: '00000000-0000-7000-8000-000000000000',
      tracer: undefined,
    } as never,
  );
  try {
    expect((await adapter.connect()).processes).toBe('single');
  } finally {
    await adapter.close(1000);
  }
}, 60_000);
