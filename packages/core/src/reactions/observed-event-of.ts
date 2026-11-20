import type { AsyncReactionEvent, ObservedEvent } from '../dsl/define-reaction.ts';
import { erasableSubjectPattern } from '../encryption/erasable-subject-pattern.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { Registry } from '../registry/registry.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { Unit } from '../storage/unit.ts';
import { canonicalSubject } from '../subjects/canonical-subject.ts';
import { subjectAt } from '../subjects/subject-at.ts';

/** The request metadata of the receipt of the event's command, when it is kept and is that command's. */
async function requestOf(unit: Unit, stored: StoredEvent): Promise<Receipt['request'] | null> {
  if (stored.commandId === null) return null;
  const receipt = await unit.receipts.get(stored.commandId);
  return receipt !== undefined && receipt.action === stored.action ? receipt.request : null;
}

/** What `subjectTextOf` answers when the event's own row is an erased tombstone. */
const erasedRow = Symbol('erasedRow');

/**
 * The text of the person the event's request came from; undefined when there is none, `erasedRow`
 * when the event's row names a data subject and is an erased tombstone: the person is gone.
 */
async function subjectTextOf(
  unit: Unit,
  registry: Registry,
  stored: StoredEvent,
): Promise<string | undefined | typeof erasedRow> {
  if (stored.scope.level !== 'tenant') return undefined;
  const { actor } = stored;
  if (actor.kind === 'user') return actor.id ?? undefined;
  if (actor.kind !== 'anonymous') return undefined;
  const entry = registry.entities.get(stored.stream.type);
  const path = entry?.descriptor.dataSubject ?? null;
  if (entry === undefined || path === null) return undefined;
  const row = await unit.rows.findOne(entry.descriptor, {
    where: { op: 'eq', field: 'id', value: stored.stream.id },
    includeArchived: true,
    includeErased: true,
  });
  if (row === undefined) return undefined;
  if (row.kwErasedAt !== undefined && row.kwErasedAt !== null) return erasedRow;
  return subjectAt(unit, registry, entry, row, path);
}

/**
 * The event an `on: 'all'` reaction receives (G12): `event` with the action of the command that wrote
 * it, the request metadata of that command's receipt and the person the request came from, all read
 * in `unit`. The remote address and the user agent of the request are kept only with a subject: no
 * erasure reaches a copy that names none, so with a null subject both are null and the transport
 * stays. The key of a subject is read with `create`, which holds it `for share` until the unit
 * commits, so an erasure that starts later waits and finds what the reaction writes. Answers
 * undefined when the subject's key is already destroyed, or when the row of an anonymous actor's
 * event, which names a data subject, is an erased tombstone: the observer then decides nothing.
 */
export async function observedEventOf(
  unit: Unit,
  registry: Registry,
  stored: StoredEvent,
  event: AsyncReactionEvent<string, unknown, Readonly<Record<string, unknown>>>,
): Promise<ObservedEvent | undefined> {
  const request = await requestOf(unit, stored);
  const text = await subjectTextOf(unit, registry, stored);
  if (text === erasedRow) return undefined;
  const canonical = text === undefined ? undefined : canonicalSubject(text);
  const subject =
    canonical !== undefined && erasableSubjectPattern.test(canonical) ? canonical : null;
  if (subject !== null && (await unit.keys.dataKey(subject, { create: true })) === undefined) {
    return undefined;
  }
  return {
    ...event,
    data: event.data as ObservedEvent['data'],
    action: stored.action,
    request:
      request === null || subject !== null
        ? request
        : { transport: request.transport, remoteAddress: null, userAgent: null },
    subject,
  };
}
