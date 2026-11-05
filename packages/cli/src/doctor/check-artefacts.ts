import type { ArtefactRun } from './artefact-run.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/**
 * Artefacts are fresh (`generate --check`, section 13.7): the producers of `keelwerk generate` run
 * over the workspace in check mode, and every drift they name is one finding.
 */
export async function checkArtefacts(
  root: string,
  run: (root: string) => Promise<ArtefactRun>,
): Promise<readonly DoctorFinding[]> {
  const result = await run(root);
  if (result.code === 0) return [];
  return [
    findingOf(
      'artefacts',
      'error',
      'keelwerk generate --check',
      result.output === '' ? 'the generated files are out of date' : result.output,
      'run keelwerk generate',
    ),
  ];
}
