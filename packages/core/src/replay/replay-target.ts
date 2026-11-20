import { errors } from '../errors/errors.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { loadTarget } from '../write-path/load-target.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';

/** The target of an entity command, loaded in the as-of view; the target's load is the first of `reads`. */
export interface ReplayedTarget {
  readonly entry: EntityEntry;
  readonly row: StorageRow;
}

/**
 * Loads the target of an entity command in the as-of `view` (the position of the record's first
 * read) and pushes its read to `reads`. A command that is not an entity command has none.
 */
export async function replayTarget(
  view: Unit,
  run: RunCommandInput,
  reads: RecordedRead[],
): Promise<ReplayedTarget | undefined> {
  const { action, registry } = run;
  if (!action.instance) return undefined;
  const entry = action.entity === undefined ? undefined : registry.entities.get(action.entity);
  if (entry === undefined) {
    throw errors.internal(`"${action.ref}" is an entity command without an entity.`);
  }
  const row = await loadTarget({
    unit: view,
    registry,
    rules: run.rules,
    action,
    entry,
    principal: run.principal,
    scope: run.scope,
    input: run.input,
    reads,
    flags: run.flags,
  });
  return { entry, row };
}
