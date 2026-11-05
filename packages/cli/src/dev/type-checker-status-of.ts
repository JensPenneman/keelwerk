import type { TypeCheckerStatus } from './type-checker-status.ts';

/** The status a line of `tsc --watch` output tells, if it tells one. */
export function typeCheckerStatusOf(line: string): TypeCheckerStatus | undefined {
  const found = /Found (\d+) errors?\./.exec(line);
  if (found?.[1] !== undefined) return { kind: 'done', errors: Number(found[1]) };
  if (/File change detected|Starting compilation/.test(line)) return { kind: 'checking' };
  return undefined;
}
