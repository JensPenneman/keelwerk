import { startPostgres } from '@keelwerk/testing/postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    portalCluster: {
      readonly adminUrl: string;
      readonly appUrl: string;
      readonly version: string;
    };
  }
}

/** Starts the one PostgreSQL container every suite of the project shares; returns its teardown. */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const running = await startPostgres();
  project.provide('portalCluster', {
    adminUrl: running.adminUrl,
    appUrl: running.appUrl,
    version: running.version,
  });
  return async () => {
    await running.stop();
  };
}
