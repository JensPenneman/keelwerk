import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { issueStateToken } from '../tokens/issue-state-token.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';

/**
 * The result of a generated `set` with its `newState` (section 6.7). The positions of the unit's
 * events exist only after the commit, so `newState` starts as the `oldState` (a token that is
 * never too new: a client that syncs from it sees its own writes again, never misses one) and is
 * moved to the last position the unit committed once the commit has happened. A replay of the
 * receipt answers the first.
 */
export function setResultWithState(
  run: RunCommandInput,
  unit: Unit,
  entry: EntityEntry,
  result: unknown,
): unknown {
  const output = {
    ...(result as { oldState: string }),
    newState: (result as { oldState: string }).oldState,
  };
  unit.afterCommit(() => {
    const last = unit.events
      .committed()
      .reduce<bigint | undefined>(
        (highest, position) => (highest === undefined || position > highest ? position : highest),
        undefined,
      );
    if (last !== undefined) {
      output.newState = issueStateToken(
        {
          registry: run.registry,
          rules: run.rules,
          principal: run.principal,
          epoch: run.epoch ?? 0,
          flags: run.flags,
        },
        entry.ref,
        run.scope,
        last,
      );
    }
  });
  return output;
}
