import { openDecision } from './open-decision.ts';
import type { RunCommandInput } from './run-command-input.ts';

/**
 * Phase 2 of section 7.9.4 (S-05): `prepare` runs once, outside the command's unit, in a
 * read-only unit of the scope. In M1 it can load, read flags and ask; a `perform` request fails
 * with `core.request_not_allowed` (inline effects ship in M2). What it returns reaches `decide`
 * as `ctx.prepared`. The retries of the command do not repeat it.
 */
export async function runPrepare(run: RunCommandInput, input: unknown): Promise<unknown> {
  const { action } = run;
  const { prepare } = action;
  if (prepare === undefined) return undefined;
  const now = run.clock.now();
  return run.adapter.unit(
    run.namespace,
    run.scope,
    async (unit) => {
      const decision = openDecision({
        run,
        unit,
        form: 'prepare',
        clock: { now: () => now },
      });
      return decision.drive(prepare(input, decision.ctx));
    },
    { readOnly: true, ...(run.signal === undefined ? {} : { signal: run.signal }) },
  );
}
