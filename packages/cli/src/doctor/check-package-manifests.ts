import type { LayoutWorkspace } from '../layout/layout-workspace.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';
import { inProjectScope } from './project-package-scope.ts';

const SOURCE = '@keelwerk/source';

/** Package manifests (section 13.4), for the compiled packages (those with a `tsconfig.json`): the source condition in `exports`, absent from `publishConfig.exports`. */
export function checkPackageManifests(workspace: LayoutWorkspace): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  for (const owner of workspace.packages) {
    if (!inProjectScope(owner.dir) || owner.tsconfig === undefined) continue;
    const exports = owner.manifest.exports;
    const file = `${owner.dir}/package.json`;
    if (typeof exports === 'object' && exports !== null) {
      for (const [subpath, entry] of Object.entries(exports)) {
        if (subpath === './package.json') continue;
        if (typeof entry !== 'object' || entry === null || !(SOURCE in entry)) {
          found.push(
            findingOf(
              'manifest',
              'error',
              file,
              `exports "${subpath}" has no ${SOURCE} condition`,
              `add "${SOURCE}": "./src/..." to the entry`,
            ),
          );
        }
      }
    }
    const published = (owner.manifest.publishConfig as { exports?: unknown } | undefined)?.exports;
    if (published !== undefined && JSON.stringify(published).includes(SOURCE)) {
      found.push(
        findingOf(
          'manifest',
          'error',
          file,
          `publishConfig.exports carries the ${SOURCE} condition, which Node refuses under node_modules`,
          `remove ${SOURCE} from publishConfig.exports`,
        ),
      );
    }
  }
  return found;
}
