import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { ActorRef } from '../principals/actor-ref.ts';
import { type ErasureReason, erasureReasons } from './erasure-reasons.ts';

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An anchor with every member of F-12 in place; anything less is not trusted as one. */
function anchorOf(value: Record<string, unknown>): LedgerRecord | undefined {
  const { scopeId, position, hash, stream, recordedAt, writer } = value;
  if (!(isText(scopeId) && isText(position) && isText(hash) && isText(recordedAt)))
    return undefined;
  if (!/^[0-9]+$/.test(position)) return undefined;
  if (!(isObject(stream) && isText(stream.type) && isText(stream.id))) return undefined;
  if (!(isObject(writer) && isText(writer.process) && isText(writer.build))) return undefined;
  return {
    type: 'anchor',
    scopeId,
    position,
    hash,
    stream: { type: stream.type, id: stream.id },
    recordedAt,
    writer: { process: writer.process, build: writer.build },
  };
}

const principalKinds: ReadonlySet<string> = new Set([
  'anonymous',
  'user',
  'service',
  'operator',
  'system',
]);
const tombstoneReasons: ReadonlySet<string> = new Set(['erasure', 'rotation', 'tenantDeleted']);

/** An instant in the ISO 8601 form the writers produce: `Z` or an offset, never a bare date. */
function isInstant(value: unknown): value is string {
  return (
    isText(value) &&
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value))
  );
}

function actorOf(value: unknown): ActorRef | undefined {
  if (!isObject(value)) return undefined;
  const { kind, id, via } = value;
  if (!(isText(kind) && principalKinds.has(kind) && isText(via))) return undefined;
  if (!(id === null || isText(id))) return undefined;
  return { kind: kind as ActorRef['kind'], id, via };
}

const knownReasons: ReadonlySet<string> = new Set(erasureReasons);

/**
 * The reason of an erasure record. A reader never drops a record for a reason it does not know,
 * because skipping it would skip an erasure at a replay: a reason that is missing, not text or not
 * on the list is read as `operator`.
 */
function reasonOf(reason: unknown): ErasureReason {
  return typeof reason === 'string' && knownReasons.has(reason)
    ? (reason as ErasureReason)
    : 'operator';
}

/** An erasure record with every member of F-20 in place (S-176). */
function erasureOf(value: Record<string, unknown>): LedgerRecord | undefined {
  const { tenantId, subjectId, recordedAt, requester, reason, commandId } = value;
  if (!(isText(tenantId) && isText(subjectId) && isText(commandId))) return undefined;
  if (!isInstant(recordedAt)) return undefined;
  const actor = actorOf(requester);
  if (actor === undefined) return undefined;
  return {
    type: 'erasure',
    tenantId,
    subjectId,
    recordedAt,
    requester: actor,
    reason: reasonOf(reason),
    commandId,
  };
}

/**
 * A completion record with every member in place. The epoch is a whole number that is not
 * negative: a count that is not one is not trusted, and the record is skipped (a skipped completion
 * only makes an erasure run again, which is safe).
 */
function erasureCompletedOf(value: Record<string, unknown>): LedgerRecord | undefined {
  const { tenantId, commandId, subjectId, epoch, recordedAt } = value;
  if (!(isText(tenantId) && isText(commandId) && isText(subjectId))) return undefined;
  if (!isInstant(recordedAt)) return undefined;
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return undefined;
  return { type: 'erasureCompleted', tenantId, commandId, subjectId, epoch, recordedAt };
}

/** A key tombstone with every member of F-20 in place (S-176). */
function keyTombstoneOf(value: Record<string, unknown>): LedgerRecord | undefined {
  const { scopeId, keyId, recordedAt, reason } = value;
  if (!(isText(scopeId) && isText(keyId) && isInstant(recordedAt))) return undefined;
  if (!(isText(reason) && tombstoneReasons.has(reason))) return undefined;
  return {
    type: 'keyTombstone',
    scopeId,
    keyId,
    recordedAt,
    reason: reason as 'erasure' | 'rotation' | 'tenantDeleted',
  };
}

/**
 * One line of the ledger as a record this release knows. `undefined` for a line that is not JSON
 * (the torn tail a crash leaves, which the next append ends with a line feed), for a type this
 * release does not know and for a known type with a member missing: readers skip what they cannot
 * use, so a new record type needs no format change (S-34).
 */
export function parseLedgerLine(line: string): LedgerRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  if (value.type === 'anchor') return anchorOf(value);
  if (value.type === 'erasure') return erasureOf(value);
  if (value.type === 'erasureCompleted') return erasureCompletedOf(value);
  if (value.type === 'keyTombstone') return keyTombstoneOf(value);
  return undefined;
}
