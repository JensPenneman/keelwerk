import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { driveHandler } from './drive-handler.ts';
import { refuseRequest } from './refuse-request.ts';
import type { RunReadInput } from './run-read-input.ts';
import type { RunReadResult } from './run-read-result.ts';
import { runReadUnit } from './run-read-unit.ts';

/**
 * Runs a query below the pipeline (section 7.9.4): a read-only unit of the scope, the head
 * position read first, then the handler driven, each request answered in the unit in yield order
 * and every load tagged with its position (S-19). `read` may return a value, a request or a
 * generator. Nothing is written and nothing is recorded in a decision record; the positions come
 * back for the response.
 */
export async function runRead(input: RunReadInput): Promise<RunReadResult> {
  const action = input.registry.actions.get(input.action);
  if (action === undefined) {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${input.action}" is not an action of this app.`,
    });
  }
  if (action.kind !== 'query' || action.generated !== undefined) {
    throw refuseRequest(
      action.ref,
      'runRead runs the `read` of a module query, not a command or a generated action',
    );
  }
  return runReadUnit({ ...input, action }, (handler, answer) =>
    driveHandler(action.handler(input.input, handler), answer),
  );
}
