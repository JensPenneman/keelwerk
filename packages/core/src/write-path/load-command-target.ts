import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { loadTarget } from './load-target.ts';
import type { RunCommandInput } from './run-command-input.ts';

/** What the command's entity, target row and reads are before its decision opens. */
export interface CommandTarget {
  readonly entry: EntityEntry | undefined;
  readonly target: StorageRow | undefined;
  readonly reads: RecordedRead[];
  readonly loaded: Map<string, StorageRow>;
}

/** Loads and locks the row an entity command runs on; a collection command has none. */
export async function loadCommandTarget(unit: Unit, run: RunCommandInput): Promise<CommandTarget> {
  const { action, registry } = run;
  const reads: RecordedRead[] = [];
  const loaded = new Map<string, StorageRow>();
  const entry =
    action.instance && action.entity !== undefined
      ? registry.entities.get(action.entity)
      : undefined;
  if (!action.instance) return { entry, target: undefined, reads, loaded };
  if (entry === undefined) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `"${action.ref}" is an entity command without an entity.`,
    });
  }
  const target = await loadTarget({
    unit,
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
  loaded.set(`${entry.ref}/${String(target.id)}`, target);
  return { entry, target, reads, loaded };
}
