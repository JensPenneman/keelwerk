import type { AnswerContext } from '../kernel/answer-context.ts';
import type { MaybeRequest } from '../protocol/maybe-request.ts';
import { driveHandler } from './drive-handler.ts';
import type { MaybeBody } from './maybe-body.ts';

/**
 * Answers the Maybe accessor of an optional module (decision 32b): `undefined` without touching
 * the unit when the module is not selected, else the answer of the inner request or generator.
 */
export async function answerMaybe(request: MaybeRequest, context: AnswerContext): Promise<unknown> {
  if (!request.present) return undefined;
  if (request.inner !== null) return context.answer(request.inner);
  const { body } = request as MaybeBody;
  return body === undefined ? undefined : driveHandler(body, (inner) => context.answer(inner));
}
