import { allOf } from '../authorization/all-of.ts';
import { checkFilterFields } from '../authorization/check-filter-fields.ts';
import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import { createEntityRepository } from '../repositories/entity-repository.ts';
import { argumentsOf } from './arguments-of.ts';
import { asOfInstant } from './as-of-instant.ts';
import type { GeneratedRead } from './generated-read-input.ts';
import { isRowId } from './is-row-id.ts';
import { readSession } from './read-session.ts';
import { readSize } from './read-size.ts';
import { readString } from './read-string.ts';

function only(
  record: Readonly<Record<string, unknown>> | null | undefined,
  shown: (name: string) => boolean,
): Record<string, unknown> | null {
  if (record === null || record === undefined) return null;
  return Object.fromEntries(Object.entries(record).filter(([name]) => shown(name)));
}

/** The fields one event changed, with the before-image and the written value, for the fields the caller may see. */
function changesOf(
  event: StoredEvent,
  shown: (name: string) => boolean,
): Record<string, { before: unknown; after?: unknown }> {
  const data = (typeof event.data === 'object' && event.data !== null ? event.data : {}) as Record<
    string,
    unknown
  >;
  const written = {
    ...((data.values ?? {}) as Record<string, unknown>),
    ...((data.set ?? {}) as Record<string, unknown>),
  };
  const touched = new Set([
    ...Object.keys(written),
    ...['inc', 'add', 'remove'].flatMap((op) => Object.keys((data[op] ?? {}) as object)),
  ]);
  const before = only(event.before, shown) ?? {};
  return Object.fromEntries(
    [...touched].filter(shown).map((name) => [
      name,
      {
        before: before[name] ?? null,
        ...(name in written ? { after: written[name] } : {}),
      },
    ]),
  );
}

/**
 * The generated `history` (section 6.7, opt-in): the entries of one row (version, instant, event name,
 * actor and the changed fields with their before and after), oldest first, from `fromVersion`
 * (default the first) and up to `asOf` when given, at most `limit` entries (default and cap: the
 * entity's page maximum), so a longer history is read by continuing from the last version plus
 * one. The row must be one the caller may read now; fields that are hidden, sealed or masked
 * for the caller are left out of every version, so history shows nothing `get` does not.
 */
export const generatedHistory: GeneratedRead = async (input) => {
  const { entry, unit } = input;
  const args = argumentsOf(input.input);
  const id = readString(args.id, 'id');
  if (id === undefined) {
    throw errors.validation('history needs an id.', {
      issues: [{ path: ['id'], message: 'Required.' }],
    });
  }
  if (entry.descriptor.history !== 'chain') {
    throw errors.unsupported(`${entry.ref} is not a chain entity: it keeps no versions.`);
  }
  if (!isRowId(id)) throw errors.not_found(`${entry.ref} ${id} does not exist`);
  const session = readSession(input);
  const found = await createEntityRepository(unit, entry).find({
    where: allOf([{ op: 'eq', field: 'id', value: id }, session.view.plan.where]),
    page: { first: 1 },
    includeArchived: true,
  });
  if (found.rows.length === 0) throw errors.not_found(`${entry.ref} ${id} does not exist`);
  const at = args.asOf === undefined || args.asOf === null ? undefined : asOfInstant(args.asOf);
  const events: readonly StoredEvent[] = await unit.events.readStream({ type: entry.ref, id });
  const shown = (name: string): boolean => {
    const field = entry.descriptor.fields[name];
    if (field === undefined) return false;
    if (field.hidden !== false || field.sealed || field.stateOnly || field.kind === 'verifier') {
      return false;
    }
    try {
      checkFilterFields(session.view.plan, [name]);
      return true;
    } catch {
      return false;
    }
  };
  const limit = readSize(args.limit, 'limit', entry.page.maxSize) ?? entry.page.maxSize;
  const fromVersion = readSize(args.fromVersion, 'fromVersion', Number.MAX_SAFE_INTEGER) ?? 1;
  const entries = events
    .filter((event) => event.version >= fromVersion)
    .filter((event) => at === undefined || Temporal.Instant.compare(event.recordedAt, at) <= 0)
    .slice(0, limit)
    .map((event) => ({
      version: event.version,
      at: event.recordedAt,
      event: event.type.slice(entry.ref.length + 1),
      actor: event.actor,
      changes: changesOf(event, shown),
    }));
  return { entries };
};
