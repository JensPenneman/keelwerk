import type { TrackSnapshot } from '@keelwerk/core';
import { snapshotFormat } from './snapshot-format.ts';

const lineWidth = 100;

/** A number or bigint bound in a descriptor: JSON has no bigint, so it is written as `{"$bigint": "123"}`. */
function toJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member !== undefined) sorted[key] = toJsonValue(member);
    }
    return sorted;
  }
  return value;
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

/**
 * JSON in the layout Biome's formatter keeps: two-space indentation, objects always expanded,
 * arrays of primitives on one line while the line (indentation, the key in front, the comma
 * behind) fits in 100 columns, every other array one item per line. `lead` is the width of what
 * precedes the value on its line.
 */
function renderJson(value: unknown, indent: number, lead: number): string {
  const pad = '  '.repeat(indent + 1);
  const close = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPrimitive)) {
      const line = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      if (close.length + lead + line.length + 1 <= lineWidth) return line;
    }
    const items = value.map((item) => `${pad}${renderJson(item, indent + 1, pad.length)}`);
    return `[\n${items.join(',\n')}\n${close}]`;
  }
  if (value !== null && typeof value === 'object') {
    const members = Object.entries(value);
    if (members.length === 0) return '{}';
    const lines = members.map(([key, member]) => {
      const head = `${JSON.stringify(key)}: `;
      return `${pad}${head}${renderJson(member, indent + 1, head.length)}`;
    });
    return `{\n${lines.join(',\n')}\n${close}}`;
  }
  return JSON.stringify(value);
}

/**
 * The text of a snapshot file (format `keelwerk.snapshot/1`, section 13.7): sorted keys, two-space
 * indentation, LF line endings, a trailing newline, no timestamps, laid out as Biome formats JSON
 * so a committed `snapshot.json` is stable under `biome ci`. The same snapshot always renders to
 * the same bytes.
 */
export function renderSnapshot(snapshot: TrackSnapshot): string {
  const document = toJsonValue({ format: snapshotFormat, ...snapshot });
  return `${renderJson(document, 0, 0)}\n`;
}
