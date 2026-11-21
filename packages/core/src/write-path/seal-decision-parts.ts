import type { RecordedAnswer } from '../events/recorded-answer.ts';
import { sealDecisionInput } from '../events/seal-decision-input.ts';
import type { Unit } from '../storage/unit.ts';
import { mergedRequestReads } from './merged-request-reads.ts';
import type { OpenedDecision } from './open-decision.ts';
import type { PreparedRun } from './prepared-run.ts';
import { recordRequestInfo } from './record-request-info.ts';
import type { RunCommandInput } from './run-command-input.ts';
import { sealedAnswers } from './sealed-answers.ts';

/** The members of the decision record that the unit keeps sealed. */
export interface SealedDecisionParts {
  readonly answers: readonly RecordedAnswer[];
  readonly sealedRequest: Awaited<ReturnType<typeof recordRequestInfo>> | undefined;
  readonly sealedInput: Awaited<ReturnType<typeof sealDecisionInput>> | undefined;
}

/**
 * Seals what the decision record of a command keeps of the request, the input and the issued
 * verifiers (7.9.3, 14.7.4): the answers with their verifiers sealed, the request members that
 * `prepare` and `decide` read, and the input when the action traces it sealed.
 */
export async function sealDecisionParts(input: {
  readonly unit: Unit;
  readonly run: RunCommandInput;
  readonly commandId: string;
  readonly decision: OpenedDecision;
  readonly preparedRun: PreparedRun | undefined;
  readonly sealedVerifiers: ReadonlyMap<string, string>;
}): Promise<SealedDecisionParts> {
  const { unit, run, commandId, decision } = input;
  const answers = await sealedAnswers(unit, commandId, decision.answers, input.sealedVerifiers);
  const requestRead = mergedRequestReads(input.preparedRun?.request, decision.request());
  const sealedRequest =
    requestRead === undefined
      ? undefined
      : await recordRequestInfo(unit, commandId, run.principal, requestRead);
  const sealedInput =
    run.action.trace?.input === 'sealed'
      ? await sealDecisionInput(unit, commandId, run.action.input, run.input)
      : undefined;
  return { answers, sealedRequest, sealedInput };
}
