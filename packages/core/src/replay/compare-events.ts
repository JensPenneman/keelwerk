import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { ComparableEvent } from './comparable-event.ts';

function same(a: unknown, b: unknown): boolean {
  return canonicalizeJson(a ?? null) === canonicalizeJson(b ?? null);
}

/** One line for every way the re-decided events differ from the recorded ones, in event order. */
export function compareEvents(
  recorded: readonly ComparableEvent[],
  redecided: readonly ComparableEvent[],
): readonly string[] {
  const differences: string[] = [];
  if (recorded.length !== redecided.length) {
    differences.push(
      `${recorded.length} events were recorded and ${redecided.length} were re-decided`,
    );
  }
  const members = [
    'stream',
    'version',
    'type',
    'schemaVersion',
    'shape',
    'data',
    'before',
  ] as const;
  for (let index = 0; index < Math.min(recorded.length, redecided.length); index += 1) {
    const was = recorded[index];
    const now = redecided[index];
    if (was === undefined || now === undefined) continue;
    for (const member of members) {
      if (!same(was[member], now[member])) {
        differences.push(`event ${index + 1} (${was.type} of ${was.stream}): ${member} differs`);
      }
    }
  }
  return differences;
}
