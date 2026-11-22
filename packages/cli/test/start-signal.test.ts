import type { DeploymentDefinition } from '@keelwerk/core';
import { beforeEach, expect, test, vi } from 'vitest';
import { bootApp } from '../src/serve/boot-app.ts';
import { createFakeHost } from './support/fake-host.ts';
import { runCliWith } from './support/run-cli-with.ts';

vi.mock('../src/db/load-definition.ts', () => ({
  loadDefinition: async () => ({ apps: [], infrastructure: [] }) as unknown as DeploymentDefinition,
}));
vi.mock('../src/serve/boot-app.ts', () => ({ bootApp: vi.fn() }));

beforeEach(() => {
  vi.mocked(bootApp).mockReset();
});

test('start hands the interrupt signal to the boot, so that an interrupt ends a start that waits for its database', async () => {
  const host = createFakeHost({
    files: { '/work/project/keelwerk.config.ts': 'export default {};' },
  }).host;
  const booting = Promise.withResolvers<never>();
  const reached = Promise.withResolvers<void>();
  vi.mocked(bootApp).mockImplementationOnce(() => {
    reached.resolve();
    return booting.promise;
  });
  const abort = new AbortController();
  const running = runCliWith(['start'], host, abort.signal);
  await reached.promise;
  const passed = vi.mocked(bootApp).mock.calls[0]?.[1].signal;
  expect(passed?.aborted).toBe(false);
  abort.abort();
  expect(passed?.aborted).toBe(true);
  booting.reject(new Error('the start was interrupted'));
  await running;
});
