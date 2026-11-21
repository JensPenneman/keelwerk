import { startPostgres } from '@keelwerk/testing/postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresCluster: {
      readonly adminUrl: string;
      readonly appUrl: string;
      readonly version: string;
      readonly containerId: string;
    };
  }
}

/** Starts the one PostgreSQL container every suite of the project shares; returns its teardown. */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Opted out: the connection guard of this project checks the deadlock counter of every file, one by one.
  const running = await startPostgres({ checkDeadlocks: false });
  project.provide('postgresCluster', {
    adminUrl: running.adminUrl,
    appUrl: running.appUrl,
    version: running.version,
    containerId: running.containerId,
  });
  return async () => {
    await running.stop();
  };
}
