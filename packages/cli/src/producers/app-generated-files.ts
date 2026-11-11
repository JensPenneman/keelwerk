import { join } from 'node:path';
import { coreApiVersions, renderAppGeneratedFile } from '@keelwerk/core';
import type { AppDerivation } from './app-derivation.ts';
import type { ProducedFiles } from './produced-files.ts';
import type { ProducerFile } from './producer-file.ts';
import { typeFragmentsOf } from './type-fragments-of.ts';

/**
 * `src/keelwerk.generated.ts` of each app (section 13.7): the app's type fold re-exported once, the
 * typed client and the head API version. The type fragments of transports (the tRPC router type)
 * come from the head surface's `type-fragment` artefacts (`typeFragmentsOf`); an app with a refused
 * fragment gets no file, so no half-correct file is written.
 */
export async function produceAppGeneratedFiles(
  root: string,
  apps: readonly AppDerivation[],
): Promise<ProducedFiles> {
  const files: ProducerFile[] = [];
  const failures: string[] = [];
  for (const app of apps) {
    const source = {
      appFile: './app.ts',
      appType: app.appType,
      apiVersion: app.app.api?.head ?? coreApiVersions.head,
      hash: app.surfaces.at(-1)?.hash ?? '',
    };
    const plain = renderAppGeneratedFile({ ...source, fragments: [] });
    const found = await typeFragmentsOf(root, app, plain);
    if (found.failures.length > 0) {
      failures.push(...found.failures);
      continue;
    }
    files.push({
      path: join(app.directory, 'src', 'keelwerk.generated.ts'),
      text:
        found.fragments.length === 0
          ? plain
          : renderAppGeneratedFile({ ...source, fragments: found.fragments }),
    });
  }
  return { files, notes: [], failures };
}
