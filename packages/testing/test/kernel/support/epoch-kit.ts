import type { ScopeMark } from '@keelwerk/core';
import { libraryApp } from '../../../src/fixtures/index.ts';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import type { IdentityOf } from '../../../src/harness/identity-of.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import { useEpochDirectories, type Warning, warnings } from './epoch-directories.ts';

export type EpochRuntime = TestRuntime<typeof libraryApp, 'acme'>;

/** A booted runtime of the library app, with the warnings it logged and the ids a later boot joins. */
export interface EpochBooted {
  readonly runtime: EpochRuntime;
  readonly warnings: Warning[];
  readonly ids: { readonly backendId: string; readonly tenants: Record<string, string> };
}

/** The directories, the boot and the reads the restore-detection tests on PGlite share. */
export function useEpochKit() {
  const directories = useEpochDirectories();
  /** A runtime on the directories of the test; the first boot creates the backend and the tenant, later ones join them. */
  const boot = async (join_?: EpochBooted['ids'], identity?: IdentityOf): Promise<EpochBooted> => {
    const logged: Warning[] = [];
    const runtime = await startTestRuntime(libraryApp, {
      external: {
        factory: directories.durableFactory(identity),
        url: 'pglite',
      },
      tenants: ['acme'],
      logger: warnings(logged),
      ...(join_ === undefined ? {} : { join: join_ }),
    });
    directories.track(() => runtime.stop(1000));
    return {
      runtime,
      warnings: logged,
      ids: { backendId: runtime.backendId, tenants: { acme: runtime.tenants.acme.id } },
    };
  };
  const stop = async (booted: EpochBooted): Promise<void> => {
    await booted.runtime.stop(1000);
    directories.release();
  };
  const ada = (runtime: EpochRuntime) =>
    createLocalClient(runtime, { principal: testPrincipal('ada') });
  const addBook = (runtime: EpochRuntime, isbn: string) =>
    ada(runtime).invoke('library.addBook', { title: `Book ${isbn}`, isbn });
  const stateOf = async (runtime: EpochRuntime): Promise<string> =>
    String(
      (
        (await ada(runtime).invoke('library.book.get' as never, { ids: [] } as never)) as {
          state: string;
        }
      ).state,
    );
  const changesSince = (runtime: EpochRuntime, since: string) =>
    ada(runtime).invoke('library.book.changes' as never, { since } as never) as Promise<
      Record<string, unknown>
    >;
  const bumpedMarks = (runtime: EpochRuntime): Promise<readonly ScopeMark[]> =>
    runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      async (unit) => unit.marks?.bumped() ?? [],
      { readOnly: true },
    );
  const headOf = (runtime: EpochRuntime): Promise<bigint> =>
    runtime.adapter.unit(
      runtime.namespace,
      { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme.id },
      async (unit) => (await unit.events.head()) ?? 0n,
      { readOnly: true },
    );
  const bumps = (booted: EpochBooted): readonly Warning[] =>
    booted.warnings.filter((entry) => entry.message.includes('a restore was detected'));
  return {
    directories,
    boot,
    stop,
    ada,
    addBook,
    stateOf,
    changesSince,
    bumpedMarks,
    headOf,
    bumps,
  };
}
