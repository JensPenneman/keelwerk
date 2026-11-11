import { createRowMatcher } from '../authorization/create-row-matcher.ts';
import type { RelationAnswerer } from '../authorization/relation-answerer.ts';
import type { Condition } from '../conditions/condition.ts';
import { conditionFields } from '../conditions/condition-fields.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { createEarlierImages, type EarlierImages } from './earlier-images.ts';

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

/** The most quantifier nodes whose every answer is tried for a purged row. */
const maxTried = 4;

/**
 * Whether a purged row (which has no related rows to ask) matched `where`: the condition is
 * evaluated under every combination of answers for its quantifier nodes, and the verdict stands
 * only when they all agree. Otherwise (or with too many nodes) it is undefined: the call is uncertain.
 */
async function verdictWithoutRelations(
  where: Condition,
  row: StorageRow,
  entity: string,
  quantifiers: readonly Extract<Condition, { readonly relation: string }>[],
): Promise<boolean | undefined> {
  if (quantifiers.length > maxTried) return undefined;
  const id = String(row.id);
  let verdict: boolean | undefined;
  for (let mask = 0; mask < 2 ** quantifiers.length; mask += 1) {
    const answerer: RelationAnswerer = async (_ref, node) =>
      (mask >> quantifiers.indexOf(node)) & 1 ? new Set([id]) : new Set<string>();
    const matches = await createRowMatcher([where], [row], { entity, answerer });
    const one = matches(where, row);
    if (verdict !== undefined && verdict !== one) return undefined;
    verdict = one;
  }
  return verdict;
}

/** What `readableBefore` judges. */
export interface ReadableBeforeInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly entry: EntityEntry;
  /** The position `p` of the state asked for. */
  readonly since: Position;
  /** What the principal may read: the plan's selection, with a filter conjoined when the caller has one. */
  readonly where: Condition;
  /** The streams whose state at `since` is asked for. */
  readonly ids: readonly string[];
  /** An archived row is not counted as readable: a caller that does not follow archived rows never held it. */
  readonly skipArchived: boolean;
  /** The streams already rebuilt at `since`, shared with the other plan groups of the pass; absent: rebuilt for this call alone. */
  readonly images?: EarlierImages;
}

/** The streams `where` selected at `since`, each with the row it was then; `uncertain` when the evidence did not suffice (step 5). */
export interface ReadableBefore {
  readonly rows: ReadonlyMap<string, StorageRow>;
  readonly uncertain: boolean;
}

/**
 * Steps 2 to 5 of the disclosure rule (section 15.2.6) for the state at `since`: the row of each
 * stream is rebuilt from its events (the same row the current row and the before-images of the later
 * events give) and judged by `where`. A relation quantifier is answered against the related rows'
 * current state only when none of the types it reaches (the related type, a `through` join entity and
 * the types of nested quantifiers) had an event after `since`, and the stream's own keys (every
 * reference and every relation key) are unchanged; otherwise the call is uncertain.
 */
export async function readableBefore(input: ReadableBeforeInput): Promise<ReadableBefore> {
  const { unit, entry } = input;
  const none = new Map<string, StorageRow>();
  const { quantifiers } = conditionFields(input.where);
  const involved = new Set<string>();
  for (const node of quantifiers) {
    if (!involvedTypes(input.registry, entry, node, involved)) {
      return { rows: none, uncertain: true };
    }
  }
  const images =
    input.images ??
    createEarlierImages({ unit, registry: input.registry, entry, since: input.since });
  // A row can enter or leave the selection through a related row, with no event of its own.
  if (involved.size > 0 && (await images.moved([...involved]))) {
    return { rows: none, uncertain: true };
  }
  const before = new Map<string, StorageRow>();
  let uncertain = false;
  const candidates: StorageRow[] = [];
  for (const id of input.ids) {
    const row = await images.at(id);
    if (row === undefined) {
      uncertain = true;
      continue;
    }
    if (input.skipArchived && row.archivedAt !== undefined && row.archivedAt !== null) continue;
    candidates.push(row);
  }
  if (candidates.length === 0) return { rows: before, uncertain };

  const answerer: RelationAnswerer = (_ref, node, rowIds) =>
    unit.rows.matching(entry.descriptor, rowIds, node);
  const purged = new Set<string>();
  if (quantifiers.length > 0) {
    const keys = ownKeys(entry);
    for (const row of candidates) {
      const { latest, purged: isPurged } = await images.current(String(row.id));
      if (isPurged) purged.add(String(row.id));
      if (
        latest === undefined ||
        keys.some((name) => String(row[name] ?? '') !== String(latest[name] ?? ''))
      ) {
        uncertain = true;
      }
    }
  }
  if (uncertain) return { rows: before, uncertain };
  const present = candidates.filter((row) => !purged.has(String(row.id)));
  const matches = await createRowMatcher([input.where], present, {
    entity: entry.ref,
    answerer,
  });
  for (const row of present) {
    if (matches(input.where, row)) before.set(String(row.id), row);
  }
  for (const row of candidates) {
    if (!purged.has(String(row.id))) continue;
    const verdict = await verdictWithoutRelations(input.where, row, entry.ref, quantifiers);
    if (verdict === undefined) uncertain = true;
    else if (verdict) before.set(String(row.id), row);
  }
  return { rows: before, uncertain };
}
