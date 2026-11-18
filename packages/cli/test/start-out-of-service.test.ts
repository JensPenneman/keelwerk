import type { DeploymentDefinition } from '@keelwerk/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bootApp } from '../src/serve/boot-app.ts';
import { createFakeHost } from './support/fake-host.ts';
import { runCliWith } from './support/run-cli-with.ts';

vi.mock('../src/db/load-definition.ts', () => ({
  loadDefinition: async () => ({ apps: [], infrastructure: [] }) as unknown as DeploymentDefinition,
}));
vi.mock('../src/serve/boot-app.ts', () => ({ bootApp: vi.fn() }));

const host = () =>
  createFakeHost({ files: { '/work/project/keelwerk.config.ts': 'export default {};' } }).host;

/** A booted app whose runtime settles `outOfService` when `leave` is called; `stop` records its calls. */
function boot() {
  const leaving = Promise.withResolvers<string>();
  const stop = vi.fn(async (_deadlineMs: number) => undefined);
  vi.mocked(bootApp).mockResolvedValueOnce({
    runtime: { outOfService: leaving.promise },
    port: 4123,
    operatorSocket: '/tmp/kw.sock',
    stop,
  } as never);
  return { leave: leaving.resolve, stop };
}

describe('start when the process takes itself out of service', () => {
  beforeEach(() => {
    vi.mocked(bootApp).mockReset();
  });

  test('stops the process and fails with core.unavailable so that its supervisor restarts it', async () => {
    const booted = boot();
    booted.leave('position');
    const run = await runCliWith(['start'], host());
    expect(booted.stop).toHaveBeenCalledExactlyOnceWith(60_000);
    expect(run.code).toBe(10);
    expect(`${run.stdout}${run.stderr}`).toContain('core.unavailable');
    expect(`${run.stdout}${run.stderr}`).toContain('a restore was detected under it (position)');
  });

  test('an interrupt stops the process and ends without a failure', async () => {
    const booted = boot();
    const abort = new AbortController();
    const running = runCliWith(['start'], host(), abort.signal);
    await vi.waitFor(() => expect(vi.mocked(bootApp)).toHaveBeenCalled());
    abort.abort();
    const run = await running;
    expect(booted.stop).toHaveBeenCalledExactlyOnceWith(60_000);
    expect(run.code).toBe(0);
  });
});
