import { planTrack } from '@keelwerk/data';
import type { AppDerivation } from './app-derivation.ts';
import { migrationTargets } from './migration-targets.ts';
import type { ProducerResult } from './producer-result.ts';
import { shownPath } from './shown-path.ts';

/**
 * Definitions against snapshots (sections 14.6.4 and 14.8.5) for the modules whose package has a
 * `migrations/` directory. The producer only checks: a track whose definitions differ from its
 * snapshot, or that has no snapshot yet, fails with `check` and is a note without it, naming
 * `keelwerk db generate`. Migration files are written by `db generate` alone, explicit and never
 * by `generate` or a watch loop (section 13.7).
 */
export async function produceMigrationsAgainstSnapshots(
  root: string,
  apps: readonly AppDerivation[],
  check: boolean,
): Promise<ProducerResult> {
  const written: string[] = [];
  const notes: string[] = [];
  const failures: string[] = [];
  let targets: Awaited<ReturnType<typeof migrationTargets>>;
  try {
    targets = await migrationTargets(root, apps, true);
  } catch (error) {
    // A module that cannot be composed is a failure of this producer, not a crash of the run.
    return { written, notes, failures: [error instanceof Error ? error.message : String(error)] };
  }
  for (const target of targets) {
    const plan = await planTrack({
      previous: target.committed.snapshot,
      desired: target.desired,
      name: 'initial',
      ask: async () => false,
    });
    if (plan === null) continue;
    const shown = shownPath(root, target.directory);
    const first = target.committed.snapshot === null && target.committed.files.length === 0;
    const next = first
      ? `run keelwerk db generate ${target.track} --name initial`
      : `run keelwerk db generate ${target.track} --name <name>`;
    const line = `${shown}: the definitions of ${target.track} differ from its snapshot; ${next}`;
    (check ? failures : notes).push(line);
  }
  return { written, notes, failures };
}
