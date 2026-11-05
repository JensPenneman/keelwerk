import type { SyncResult } from './sync-result.ts';

/** Shows what one synchronisation applied and the warnings it raised. */
export function reportSync(
  sync: SyncResult,
  print: (line: string) => void,
  note: (line: string) => void,
): void {
  for (const applied of sync.applied) print(`applied ${applied}`);
  for (const warning of sync.warnings) note(`warning: ${warning}`);
}
