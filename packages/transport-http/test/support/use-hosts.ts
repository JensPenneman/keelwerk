import { rm } from 'node:fs/promises';
import { afterEach } from 'vitest';
import type { HttpHostDeps, HttpHostInstance, HttpHostOptions } from '../../src/index.ts';
import { createFakeHost, type FakeHost } from './create-fake-host.ts';
import { createFakeInvoker, type FakeInvoker } from './fake-invoker.ts';
import { libraryActions } from './library-actions.ts';
import { librarySurface } from './library-surface.ts';

/**
 * Registers the cleanup of the test file and returns the builder of hosts over the library
 * surface; `directories` collects paths to remove.
 */
export function useHosts(): {
  setup(options?: HttpHostOptions, invoker?: FakeInvoker, deps?: Partial<HttpHostDeps>): FakeHost;
  directories: string[];
} {
  const stopping: HttpHostInstance[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(stopping.splice(0).map((host) => host.stop(100)));
    await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  return {
    directories,
    setup(options = {}, invoker = createFakeInvoker({ actions: libraryActions }), deps = {}) {
      const made = createFakeHost(options, { invoker, surface: librarySurface, deps });
      stopping.push(made.host);
      return made;
    },
  };
}
