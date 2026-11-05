import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtefactRun } from './artefact-run.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

const GENERATORS: readonly { readonly script: string; readonly fix: string }[] = [
  { script: 'scripts/generate-manifests.ts', fix: 'run pnpm manifests' },
  { script: 'scripts/generate-surfaces.ts', fix: 'run pnpm surfaces' },
];

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Artefacts are fresh (`generate --check`, section 13.7): the module manifests and the generated surfaces, each by its script's own `--check`. */
export async function checkArtefacts(
  root: string,
  run: (script: string, args: readonly string[]) => Promise<ArtefactRun>,
): Promise<readonly DoctorFinding[]> {
  const found: DoctorFinding[] = [];
  let ran = 0;
  for (const generator of GENERATORS) {
    if (!(await exists(join(root, generator.script)))) continue;
    ran += 1;
    const result = await run(generator.script, ['--check']);
    if (result.code !== 0) {
      found.push(
        findingOf(
          'artefacts',
          'error',
          generator.script,
          result.output === '' ? 'the generated files are out of date' : result.output,
          generator.fix,
        ),
      );
    }
  }
  if (ran === 0) {
    found.push(
      findingOf(
        'artefacts',
        'note',
        'artefacts',
        'the generated files were not checked: the project has no scripts/generate-manifests.ts or scripts/generate-surfaces.ts',
        'run keelwerk generate --check when the CLI offers it (WP-59)',
      ),
    );
  }
  return found;
}
