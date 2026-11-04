import type { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import { createComputePool } from './create-compute-pool.ts';

const spawned = vi.hoisted((): Worker[] => []);

vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  class TrackedWorker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      super(...args);
      spawned.push(this);
    }
  }
  // biome-ignore lint/style/useNamingConvention: the key is the export being replaced
  return { ...actual, Worker: TrackedWorker };
});

describe('a worker lost while the pool closes', () => {
  it('rejects the running job and still lets close finish', async () => {
    const pool = createComputePool({ size: 1 });
    const running = pool.argon2idHash('x', new Uint8Array(16).fill(7));
    const failure = running.then(
      () => undefined,
      (error: unknown) => error,
    );
    const closed = pool.close();
    await spawned[0]?.terminate();
    expect(await failure).toMatchObject({ code: 'core.internal' });
    await closed;
  });
});
