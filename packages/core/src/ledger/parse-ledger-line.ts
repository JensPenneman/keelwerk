import type { LedgerRecord } from '../kernel/ledger-record.ts';

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
  return value.type === 'anchor' ? anchorOf(value) : undefined;
}
