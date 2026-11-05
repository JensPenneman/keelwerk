import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { Registry } from '../registry/registry.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';
import type { FeedHorizon } from './feed-horizon.ts';
import { readAsOfPosition } from './read-as-of-position.ts';
import { replayMismatch } from './replay-mismatch.ts';

/** What the rows of a re-decided decision's drafts are resolved with. */
export interface ResolveReplayedInput {
  /** The real unit, whose events the rows are folded from. */
  readonly unit: Unit;
  readonly registry: Registry;
  readonly behaviours: EntityBehaviours;
  readonly drafts: readonly AnyDraft[];
  /** Rows the decision already holds, by `entity/id`: the target of an entity command. */
  readonly loaded: ReadonlyMap<string, StorageRow>;
  /** The reads the re-decide has made so far; a draft by id appends its read here, as in the original (S-21). */
  readonly reads: RecordedRead[];
  readonly recorded: readonly RecordedRead[];
  readonly ceiling: Position;
  readonly horizon: FeedHorizon;
}

/**
 * The rows `draftsToEvents` would load and lock for the drafts, as they were when the decision
 * was made: a draft by id takes the next read the record holds and the row at that position; a
 * draft built from a row finds that version as of the last position the record names, else
 * `core.version_mismatch`. `draftsToEvents` then finds every row held and reads nothing.
 */
export async function resolveReplayedDrafts(
  input: ResolveReplayedInput,
): Promise<ReadonlyMap<string, StorageRow>> {
  const resolved = new Map(input.loaded);
  const seen = new Set<string>();
  for (const draft of input.drafts) {
    const entry = input.registry.entities.get(draft.entity);
    if (entry === undefined) continue;
    const key = `${entry.ref}/${draft.id}`;
    if (draft.kind === 'create' || seen.has(key)) {
      seen.add(key);
      continue;
    }
    seen.add(key);
    const held = resolved.get(key);
    const expected = draft.expectedVersion;
    if (held !== undefined && (expected === undefined || Number(held.version) === expected)) {
      continue;
    }
    let at = input.ceiling;
    if (expected === undefined) {
      const slot = input.recorded[input.reads.length];
      if (slot === undefined) {
        throw replayMismatch(`the draft for ${key} loads a row the record has no read for`);
      }
      at = slot.at;
    }
    const rows = await readAsOfPosition({
      unit: input.unit,
      entry,
      behaviours: input.behaviours,
      at,
      horizon: input.horizon,
    });
    const row = rows.find((candidate) => candidate.id === draft.id);
    if (row === undefined) throw errors.not_found(`${entry.ref} ${draft.id} does not exist`);
    if (expected === undefined) {
      input.reads.push({ at });
    } else if (Number(row.version) !== expected) {
      throw new KeelwerkError({
        kind: 'conflict',
        code: 'core.version_mismatch',
        message: 'The row is not at the version the draft was built from.',
        details: { entity: entry.ref, id: draft.id, expectedVersion: expected },
      });
    }
    resolved.set(key, row);
  }
  return resolved;
}
