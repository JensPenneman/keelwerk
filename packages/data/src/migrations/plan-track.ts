import type { TrackSnapshot } from '@keelwerk/core';
import { classifyContractSteps } from './classify-contract-steps.ts';
import type { AskRename } from './diff-snapshots.ts';
import { diffSnapshots } from './diff-snapshots.ts';
import { recordRenames } from './record-renames.ts';
import type { GeneratedMigration } from './render-migration-file.ts';

const pad = (number: number): string => String(number).padStart(4, '0');

/** What `db generate <track> --name <name>` writes for a track. */
export interface TrackPlan {
  /** The expand file first, then the contract file when there are contract steps. */
  readonly files: readonly GeneratedMigration[];
  /** The snapshot as of the last file: its version is that file's number. */
  readonly snapshot: TrackSnapshot;
}

/** Input of `planTrack`. */
export interface TrackPlanInput {
  /** The track's snapshot after its last file; null before its first. */
  readonly previous: TrackSnapshot | null;
  /** The snapshot the definitions describe now. */
  readonly desired: TrackSnapshot;
  /** The kebab-case name of the change: `0003-<name>`. */
  readonly name: string;
  readonly ask: AskRename;
}

/**
 * Plans the next migration of a track (section 14.6.4): the neutral steps from the previous
 * snapshot to the desired one, split into a file of expand steps and, when the change has
 * contract steps, a file after it, so `db apply` can run the first alone. The answers to rename
 * questions go into the expand file and the snapshot's rename history. Null when nothing changed.
 */
export async function planTrack(input: TrackPlanInput): Promise<TrackPlan | null> {
  const { steps, renames } = await diffSnapshots(input.previous, input.desired, input.ask);
  if (steps.length === 0) return null;
  const last = input.previous?.version ?? 0;
  const { expand, contract } = classifyContractSteps(steps);
  const files: GeneratedMigration[] = [];
  const track = input.desired.track;
  if (expand.length > 0 || renames.length > 0) {
    files.push({ id: `${pad(last + 1)}-${input.name}`, track, steps: expand, renames });
  }
  if (contract.length > 0) {
    files.push({
      id: `${pad(last + files.length + 1)}-${input.name}-contract`,
      track,
      steps: contract,
    });
  }
  const first = files[0];
  const version = last + files.length;
  const snapshot = recordRenames({ ...input.desired, version }, renames, first?.id ?? '');
  return { files, snapshot };
}
