import { allOf } from '../authorization/all-of.ts';
import type { Condition } from '../conditions/condition.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Position } from '../storage/position.ts';
import type { Unit } from '../storage/unit.ts';
import { readableBefore } from './readable-before.ts';

const page = 100;

function chunks<T>(items: readonly T[]): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let at = 0; at < items.length; at += page) result.push(items.slice(at, at + page));
  return result;
}

async function readableNow(input: DisclosureInput, ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const batch of chunks(ids)) {
    const rows = await input.unit.rows.find(input.entry.descriptor, {
      where: allOf([{ op: 'in', field: 'id', value: batch }, input.where]),
      page: { first: batch.length },
      ...(input.includeArchived === true ? { includeArchived: true } : {}),
    });
    for (const row of rows.rows) found.add(String(row.id));
  }
  return found;
}

/** What the disclosure rule of section 15.2.6 (steps 2 to 5) judges. */
export interface DisclosureInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly entry: EntityEntry;
  /** The position `p` the client's token named. */
  readonly since: Position;
  /** What the principal may read: the plan's selection, with the filter of a `queryState` conjoined. */
  readonly where: Condition;
  /** The streams that had events after `since` (step 1), with whether their `created` event is among them. */
  readonly streams: ReadonlyMap<string, { readonly createdAfter: boolean }>;
  /** `readable` asks for the state at `since` of every stream; `unreadable` only of those the principal cannot read now (what `changes` needs). */
  readonly earlier: 'all' | 'unreadable';
  /** The principal follows archived rows: an archived row is read now and was read at `since` like any other. */
  readonly includeArchived?: boolean;
}

/** The verdict per stream. */
export interface Disclosure {
  /** The streams the principal can read now (and that match the filter). */
  readonly now: ReadonlySet<string>;
  /** The streams the principal could read at `since`, among those asked for. */
  readonly before: ReadonlySet<string>;
  /** Step 5: the evidence did not suffice. */
  readonly uncertain: boolean;
}

/**
 * The disclosure rule (section 15.2.6). A stream whose current row the principal can read is
 * `now`. For every other stream the row at `since` is rebuilt from its events (the same row the
 * current row and the before-images of the later events give) and judged by the same selection:
 * the principal could read it then, or never could. A relation quantifier is answered against the
 * related rows' current state only when none of the types it reaches (the related type, a `through`
 * join entity and the types of nested quantifiers) had an event after `since`, and the stream's own
 * keys (every reference and every relation key) are unchanged; otherwise the call is uncertain.
 */
export async function disclosureRule(input: DisclosureInput): Promise<Disclosure> {
  const ids = [...input.streams.keys()];
  const now = await readableNow(input, ids);
  const wanted = ids.filter(
    (id) =>
      input.streams.get(id)?.createdAfter !== true && (input.earlier === 'all' || !now.has(id)),
  );
  const found = await readableBefore({
    unit: input.unit,
    registry: input.registry,
    entry: input.entry,
    since: input.since,
    where: input.where,
    ids: wanted,
    skipArchived: input.includeArchived !== true,
  });
  return { now, before: new Set(found.rows.keys()), uncertain: found.uncertain };
}
