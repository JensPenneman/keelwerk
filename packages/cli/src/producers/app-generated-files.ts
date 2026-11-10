import { join } from 'node:path';
import { coreApiVersions, renderAppGeneratedFile } from '@keelwerk/core';
import type { AppDerivation } from './app-derivation.ts';
import type { ProducedFiles } from './produced-files.ts';

/**
 * `src/keelwerk.generated.ts` of each app (section 13.7): the app's type fold re-exported once, the
 * typed client and the head API version. The type fragments of transports (the tRPC router type)
 * enter here once a transport offers them in the form of a `TypeFragment`; none does in M1.
 */
export function produceAppGeneratedFiles(apps: readonly AppDerivation[]): ProducedFiles {
  return {
    files: apps.map((app) => ({
      path: join(app.directory, 'src', 'keelwerk.generated.ts'),
      text: renderAppGeneratedFile({
        appFile: './app.ts',
        appType: app.appType,
        apiVersion: app.app.api?.head ?? coreApiVersions.head,
        hash: app.surfaces.at(-1)?.hash ?? '',
        fragments: [],
      }),
    })),
    notes: [],
    failures: [],
  };
}
