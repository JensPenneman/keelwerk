import { utcDayOf } from '../api-versions/utc-day-of.ts';
import type { ControlStore } from '../control/control-store.ts';
import type { CommandRun, CommandRunner } from '../invoker/command-runner.ts';
import type { Clock } from '../kernel/clock.ts';
import { answerRetireApiVersion } from './answer-retire-api-version.ts';
import type { ServedApp } from './served-app.ts';

/** What the first pass's handler throws: the first pass found no receipt for the command id (its unit is rolled back). */
const claimed = new Error('no receipt answers the command id');

function withHandler(run: CommandRun, handler: CommandRun['action']['handler']): CommandRun {
  return { ...run, action: { ...run.action, handler } };
}

/**
 * The command runner with `core.retireApiVersion` answered by the runtime (18.5). The pipeline has
 * already authorised the call. A handler is pure and cannot await, so the retirement runs between
 * two passes of the runner. The first pass only looks for a receipt and is rolled back: a replay
 * with the same input answers the first answer, another input is `core.idempotency_mismatch`, and
 * in both nothing has changed. Only when no receipt answers, the first pass's handler stops and
 * rolls the unit back, the real retirement runs (its re-pin events naming the operator, the request and the command
 * id of this call: `ControlProvenance`; an abort of the call's signal stops it between rows), and
 * the second pass keeps the real outcome in the receipt with a handler that emits no events. Two
 * overlapping calls with one command id, with the same or different inputs, both find no receipt
 * and both retire; with different inputs the second answers core.idempotency_mismatch although its
 * retirement took effect. Without a command id there is no receipt and the retirement runs once.
 */
export function answerRetireCommand(
  runner: CommandRunner,
  store: ControlStore,
  served: ReadonlyMap<string, ServedApp>,
  clock: Clock,
): CommandRunner {
  return async (run) => {
    if (run.action.ref !== 'core.retireApiVersion') return runner(run);
    const { commandId, requestId } = run.invocation;
    const retire = () =>
      answerRetireApiVersion(store, served, run.input, utcDayOf(clock.now()), {
        provenance: {
          actor: run.session.principal,
          requestId,
          ...(commandId === undefined ? {} : { causationId: commandId }),
        },
        signal: run.signal,
      });
    if (commandId === undefined) return { output: await retire() };
    try {
      return await runner(
        withHandler(run, () => {
          throw claimed;
        }),
      );
    } catch (error) {
      if (error !== claimed) throw error;
    }
    const output = await retire();
    return runner(withHandler(run, () => ({ events: [], result: output })));
  };
}
