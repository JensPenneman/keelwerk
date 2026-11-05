import { isForkable } from '../keys/is-forkable.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from './run-command-input.ts';

/**
 * The run with a key service that reaches the scope keys through the unit when it is a
 * deployment-scope unit: a command that issues a secret or seals a value inside such a unit must
 * not open a second one (an adapter that runs one unit at a time would wait for it forever). The
 * nested runs of the command inherit it.
 */
export function runInUnitKeys(run: RunCommandInput, unit: Unit): RunCommandInput {
  if (unit.scopeKeys === undefined || !isForkable(run.keys)) return run;
  return { ...run, keys: run.keys.within(unit.scopeKeys) };
}
