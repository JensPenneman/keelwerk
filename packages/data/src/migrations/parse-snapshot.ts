import type { TrackSnapshot } from '@keelwerk/core';
import { snapshotFormat } from './snapshot-format.ts';

function fromJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromJsonValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === '$bigint' && typeof record.$bigint === 'string') {
      return BigInt(record.$bigint);
    }
    return Object.fromEntries(keys.map((key) => [key, fromJsonValue(record[key])]));
  }
  return value;
}

/** Reads the text of a snapshot file; another format, or text that is no snapshot, throws a `TypeError`. */
export function parseSnapshot(text: string): TrackSnapshot {
  const document = fromJsonValue(JSON.parse(text)) as Record<string, unknown> | null;
  if (document === null || typeof document !== 'object' || document.format !== snapshotFormat) {
    throw new TypeError(`a snapshot file must be in the format ${snapshotFormat}`);
  }
  const { format: _format, ...snapshot } = document;
  return snapshot as unknown as TrackSnapshot;
}
