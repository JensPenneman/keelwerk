import { basename, dirname, join } from 'node:path';
import type { AppDerivation } from './app-derivation.ts';
import { orphanFiles } from './orphan-files.ts';
import type { ProducedFiles } from './produced-files.ts';
import type { ProducerFile } from './producer-file.ts';
import { projectSurface } from './project-surface.ts';
import { transportsOf } from './transports-of.ts';

/**
 * The documents the app's transports derive from each API version's surface: the OpenAPI document
 * of `transport-rest` at `generated/openapi/<app>/<version>.json`, the SDL of GraphQL beside it
 * (section 13.7, S-28). Each adapter's `check` runs first, so a surface it cannot project is a
 * failure here and not a half-written document. Type fragments are not files and are left to
 * `app-generated-files.ts`.
 */
export async function produceTransportArtefacts(
  root: string,
  apps: readonly AppDerivation[],
  check: boolean,
): Promise<ProducedFiles> {
  const files: ProducerFile[] = [];
  const failures: string[] = [];
  const notes: string[] = [];
  for (const app of apps) {
    const transports = transportsOf(app.app);
    const mine = new Map<string, ProducerFile>();
    for (const surface of app.surfaces) {
      for (const transport of transports) {
        const { problems, artifacts } = projectSurface(transport, surface);
        for (const problem of problems) {
          failures.push(
            `${app.shown}: ${transport.name} ${surface.apiVersion}: ${problem.code} ${problem.subject}: ${problem.message}`,
          );
        }
        if (problems.length > 0) continue;
        for (const artifact of artifacts) {
          if (artifact.kind !== 'file') continue;
          const path = join(app.directory, artifact.path);
          if (mine.has(path)) {
            failures.push(`${app.shown}: two transports write ${artifact.path}`);
          } else {
            mine.set(path, { path, text: artifact.content });
          }
        }
      }
    }
    files.push(...mine.values());
    const directories = new Set([
      ...[...mine.keys()].map((path) => dirname(path)),
      join(app.directory, 'generated', 'openapi', app.app.id),
      join(app.directory, 'generated', 'graphql', app.app.id),
    ]);
    for (const directory of directories) {
      const keep = new Set(
        [...mine.keys()]
          .filter((path) => dirname(path) === directory)
          .map((path) => basename(path)),
      );
      const orphans = await orphanFiles(root, directory, keep, app.app.id);
      (check ? failures : notes).push(...orphans);
    }
  }
  return { files, notes, failures };
}
