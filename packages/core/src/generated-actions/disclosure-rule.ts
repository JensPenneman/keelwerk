import { allOf } from '../authorization/all-of.ts';
import { createRowMatcher } from '../authorization/create-row-matcher.ts';
import type { RelationAnswerer } from '../authorization/relation-answerer.ts';
import type { Condition } from '../conditions/condition.ts';
import { conditionFields } from '../conditions/condition-fields.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { foldStream } from './fold-stream.ts';

const page = 100;

/** The own-side keys of every relation and every reference: what a relation quantifier reads of the row itself. */
function ownKeys(entry: EntityEntry): readonly string[] {
  const keys = new Set<string>();
  for (const [name, field] of Object.entries(entry.descriptor.fields)) {
    if (field.ref !== null) keys.add(name);
  }
  for (const relation of Object.values(entry.descriptor.relations)) {
    for (const name of [relation.by, relation.to]) {
      if (name in entry.descriptor.fields) keys.add(name);
    }
  }
  return [...keys];
}

/**
 * Adds the entity types a quantifier reads (the related type, a `through` join entity and every
 * type a nested quantifier reaches). False when a relation or entity cannot be resolved.
 */
function involvedTypes(
  registry: Registry,
  entry: EntityEntry,
  node: Extract<Condition, { readonly relation: string }>,
  into: Set<string>,
): boolean {
  const relation = entry.descriptor.relations[node.relation];
  if (relation === undefined) return false;
  into.add(relation.target);
  if (relation.through !== undefined) {
    into.add(`${relation.through.module}.${relation.through.entity}`);
  }
  const target = registry.entities.get(relation.target);
  const nested = conditionFields(node.where).quantifiers;
  if (nested.length > 0 && target === undefined) return false;
  return nested.every(
    (inner) => target !== undefined && involvedTypes(registry, target, inner, into),
  );
}

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
  const { unit, entry } = input;
  const ids = [...input.streams.keys()];
  const now = await readableNow(input, ids);
  const { quantifiers } = conditionFields(input.where);
  const involved = new Set<string>();
  for (const node of quantifiers) {
    if (!involvedTypes(input.registry, entry, node, involved)) {
      return { now, before: new Set<string>(), uncertain: true };
    }
  }
  if (involved.size > 0) {
    // A row can enter or leave the selection through a related row, with no event of its own.
    const moved = await unit.events.readAll(input.since, {
      limit: 1,
      selector: { streamTypes: [...involved] },
      includeTransient: true,
    });
    if (moved.events.length > 0) return { now, before: new Set<string>(), uncertain: true };
  }
  const before = new Set<string>();
  let uncertain = false;
  const wanted = ids.filter(
    (id) =>
      input.streams.get(id)?.createdAfter !== true && (input.earlier === 'all' || !now.has(id)),
  );
  const candidates: StorageRow[] = [];
  for (const id of wanted) {
    const folded = await foldStream({
      unit,
      registry: input.registry,
      entry,
      id,
      keep: (event) => event.position <= input.since,
    });
    if (!folded.complete || folded.kept.length === 0 || folded.row === undefined) {
      uncertain = true;
      continue;
    }
    if (folded.row.archivedAt !== undefined && folded.row.archivedAt !== null) continue;
    candidates.push(folded.row);
  }
  if (candidates.length === 0) return { now, before, uncertain };

  const answerer: RelationAnswerer = (_ref, node, rowIds) =>
    unit.rows.matching(entry.descriptor, rowIds, node);
  if (quantifiers.length > 0) {
    const keys = ownKeys(entry);
    for (const row of candidates) {
      const current = await unit.rows.find(entry.descriptor, {
        where: { op: 'eq', field: 'id', value: String(row.id) },
        page: { first: 1 },
        includeArchived: true,
      });
      const [now_] = current.rows;
      if (
        now_ === undefined ||
        keys.some((name) => String(row[name] ?? '') !== String(now_[name] ?? ''))
      ) {
        uncertain = true;
      }
    }
  }
  if (uncertain) return { now, before, uncertain };
  const matches = await createRowMatcher([input.where], candidates, {
    entity: entry.ref,
    answerer,
  });
  for (const row of candidates) {
    if (matches(input.where, row)) before.add(String(row.id));
  }
  return { now, before, uncertain };
}
