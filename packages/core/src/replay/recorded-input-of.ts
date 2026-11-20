import { errors } from '../errors/errors.ts';
import type { DecisionRecord } from '../events/decision-record.ts';
import type { Unit } from '../storage/unit.ts';
import { openRecordedSealed } from './open-recorded-sealed.ts';

/**
 * The input a re-decide runs with: `given` when defined; else the record's sealed input opened (JSON);
 * opened against this command's binding (a gone key is `replayKeyDestroyed('the recorded input')`, a value sealed for another command is `internal`); else `validation`: the decision kept no
 * input and the caller passes it (7.9.6).
 */
export async function recordedInputOf(
  unit: Unit,
  record: DecisionRecord,
  commandId: string,
  given: unknown,
): Promise<unknown> {
  if (given !== undefined) return given;
  if (record.input === undefined) {
    throw errors.validation('The decision did not keep its input: pass it (--input).');
  }
  const opened = await openRecordedSealed(
    unit,
    record.input,
    { commandId, field: 'input' },
    'the recorded input',
  );
  return JSON.parse(new TextDecoder().decode(opened)) as unknown;
}
