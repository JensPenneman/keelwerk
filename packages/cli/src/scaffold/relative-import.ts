import { posix } from 'node:path';

/** The import specifier from one file to another, both relative to the same root (`../base.ts`). */
export function relativeImport(from: string, to: string): string {
  const relative = posix.relative(posix.dirname(from), to);
  return relative.startsWith('.') ? relative : `./${relative}`;
}
