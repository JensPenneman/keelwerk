import type { FlagRead } from '../events/flag-read.ts';
import type { PreparedRun } from './prepared-run.ts';

/**
 * The flags of `prepare` and of `decide` are one snapshot of the invocation (`meta.flags`): the
 * reads of both, and decide's read of a key wins.
 */
export function mergedFlagReads(
  prepared: Pick<PreparedRun, 'flags'> | undefined,
  decided: ReadonlyMap<string, FlagRead>,
): readonly FlagRead[] {
  const reads = new Map(prepared?.flags.map((flag) => [flag.key, flag]));
  for (const flag of decided.values()) reads.set(flag.key, flag);
  return [...reads.values()];
}
