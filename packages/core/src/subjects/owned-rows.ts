import { compareCodePoints } from '../conditions/compare-code-points.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { canonicalSubject } from './canonical-subject.ts';
import { handledElsewhere } from './handled-elsewhere.ts';
import { subjectSpellings } from './subject-spellings.ts';

const chunkSize = 500;

function* chunksOf(values: readonly string[]): Generator<readonly string[]> {
  for (let at = 0; at < values.length; at += chunkSize) yield values.slice(at, at + chunkSize);
}

/** The texts a lookup of the subject in this field asks for: ids and references are stored in one form only. */
function valuesFor(entry: EntityEntry, field: string, subjectId: string): readonly string[] {
  return field === 'id' || entry.descriptor.fields[field]?.kind === 'ref'
    ? [canonicalSubject(subjectId)]
    : subjectSpellings(subjectId);
}

/**
 * The ids of the rows of `entry` whose `field` is one of `values`. A hop row counts erased or not,
 * because a hop row erased first must still lead to its children, as the write path's hops do.
 */
async function idsWhere(
  unit: Unit,
  entry: EntityEntry,
  field: string,
  values: readonly string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const chunk of chunksOf(values)) {
    let after: string | undefined;
    for (;;) {
      const page = await unit.rows.find(entry.descriptor, {
        where: { op: 'in', field, value: chunk },
        select: ['id'],
        page: { first: chunkSize, ...(after === undefined ? {} : { after }) },
        includeArchived: true,
        includeErased: true,
      });
      for (const row of page.rows) ids.push(String(row.id));
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) break;
      after = page.pageInfo.endCursor;
    }
  }
  return ids;
}

/**
 * The ids a path `a.b.c` leads to from the entity's first reference `a`: the rows of the last hop
 * whose `c` is the subject, then the rows of each earlier hop whose reference is among them. The
 * answer is the ids of the entity `a` points at; the entity's own rows are those whose `a` is one.
 */
async function parentsOf(
  unit: Unit,
  registry: Registry,
  entry: EntityEntry,
  segments: readonly string[],
  subjectId: string,
): Promise<string[]> {
  const chain: EntityEntry[] = [entry];
  for (const segment of segments.slice(0, -1)) {
    const target = chain.at(-1)?.descriptor.fields[segment]?.ref?.entity;
    const next = target === undefined ? undefined : registry.entities.get(target);
    if (next === undefined) return [];
    chain.push(next);
  }
  const last = chain.length - 1;
  const lastEntry = chain[last];
  const lastField = segments[last];
  if (lastEntry === undefined || lastField === undefined) return [];
  let ids = await idsWhere(unit, lastEntry, lastField, valuesFor(lastEntry, lastField, subjectId));
  for (let hop = last - 1; hop >= 1 && ids.length > 0; hop -= 1) {
    const hopEntry = chain[hop];
    const field = segments[hop];
    if (hopEntry === undefined || field === undefined) return [];
    ids = await idsWhere(unit, hopEntry, field, ids);
  }
  return ids;
}

/** The entities that can own a row of a subject: tenant entities with a data subject, in the order of their refs. */
function entitiesOf(input: OwnedRowsInput): readonly EntityEntry[] {
  return [...input.registry.entities.values()]
    .filter(
      (entry) =>
        entry.descriptor.tenancy === 'tenant' &&
        entry.descriptor.dataSubject !== null &&
        !handledElsewhere.has(entry.ref) &&
        (input.module === undefined || entry.module === input.module),
    )
    .sort((a, b) => compareCodePoints(a.ref, b.ref));
}

/** Where a walk over the owned rows stopped: the next read starts here. */
export interface OwnedRowsCursor {
  readonly entity: string;
  /** The ids a path leads to, resolved once when the walk enters the entity; `null` before that. Held in memory only. */
  readonly parents: readonly string[] | null;
  /** The chunk of `parents` being read. */
  readonly chunk: number;
  /** The row cursor inside the chunk. */
  readonly after: string | null;
}

/** What a walk over the rows of a subject reads (decision 107: the types live beside the function). */
export interface OwnedRowsInput {
  readonly registry: Registry;
  readonly subjectId: string;
  /** Only the entities of this module. */
  readonly module?: string;
  /** Erased tombstones count too: an erasure that runs again must still see what it erased. */
  readonly includeErased: boolean;
  readonly after: OwnedRowsCursor | null;
  readonly limit: number;
}

/** One page of owned rows; `next` is `null` once the walk is over. */
export interface OwnedRowsPage {
  readonly rows: readonly StreamRef[];
  readonly next: OwnedRowsCursor | null;
}

/**
 * The rows a subject owns, found by a lookup per entity (14.7.5): every tenant entity with a data
 * subject, in the order of its ref, and its rows in the order of their ids. A data subject that is
 * `id` is one read; one field is `field in spellings`; a path `a.b.c` is read backwards: the rows
 * of the last hop whose `c` is the subject, then the rows of each earlier hop whose reference is
 * among those ids (in chunks of 500), then the entity's rows whose `a` is among the ids reached,
 * chunk by chunk. Archived rows are always read; erased ones when `includeErased` is set. The read
 * runs on the kernel's own unit with no authorization plan: the adapter's scope predicate keeps it
 * inside the tenant. No reference is needed, so a row that holds no personal value is found too.
 * Pass `next` back as `after` for the following page.
 */
export async function ownedRows(unit: Unit, input: OwnedRowsInput): Promise<OwnedRowsPage> {
  const entries = entitiesOf(input);
  const rows: StreamRef[] = [];
  const start = input.after;
  let index = 0;
  if (start !== null) {
    index = entries.findIndex((entry) => compareCodePoints(entry.ref, start.entity) >= 0);
    if (index === -1) return { rows, next: null };
  }
  let resume = start !== null && entries[index]?.ref === start.entity ? start : null;
  for (; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const path = entry.descriptor.dataSubject;
    if (path === null) continue;
    const segments = path.split('.');
    const [first = ''] = segments;
    let parents: readonly string[] | null = resume?.parents ?? null;
    let chunk = resume?.chunk ?? 0;
    let after: string | null = resume?.after ?? null;
    resume = null;
    if (segments.length > 1 && parents === null) {
      parents = await parentsOf(unit, input.registry, entry, segments, input.subjectId);
    }
    const lookups: readonly (readonly string[])[] =
      parents === null ? [valuesFor(entry, first, input.subjectId)] : [...chunksOf(parents)];
    const successor = entries[index + 1];
    const following: OwnedRowsCursor | null =
      successor === undefined
        ? null
        : { entity: successor.ref, parents: null, chunk: 0, after: null };
    for (; chunk < lookups.length; chunk += 1) {
      const values = lookups[chunk] ?? [];
      for (;;) {
        const space = input.limit - rows.length;
        const page = await unit.rows.find(entry.descriptor, {
          where: { op: 'in', field: first, value: values },
          select: ['id'],
          page: { first: space, ...(after === null ? {} : { after }) },
          includeArchived: true,
          includeErased: input.includeErased,
        });
        for (const row of page.rows) rows.push({ type: entry.ref, id: String(row.id) });
        const more = page.pageInfo.hasNextPage && page.pageInfo.endCursor !== null;
        after = more ? page.pageInfo.endCursor : null;
        if (rows.length >= input.limit) {
          const next: OwnedRowsCursor | null = more
            ? { entity: entry.ref, parents, chunk, after }
            : chunk + 1 < lookups.length
              ? { entity: entry.ref, parents, chunk: chunk + 1, after: null }
              : following;
          return { rows, next };
        }
        if (!more) break;
      }
    }
  }
  return { rows, next: null };
}
