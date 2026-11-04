import type { AnswerContext } from '../kernel/answer-context.ts';
import type { AllRequest } from '../protocol/all-request.ts';
import { isRequest } from './is-request.ts';
import { refuseRequest } from './refuse-request.ts';

/**
 * Answers `ctx.all` with one answer per member, in the members' order. The members run one after
 * the other on the unit's single session, so their positions are recorded in member order too.
 */
export async function answerAll(
  request: AllRequest,
  context: AnswerContext,
): Promise<readonly unknown[]> {
  const answers: unknown[] = [];
  for (const member of request.requests) {
    if (!isRequest(member)) throw refuseRequest('all', 'every member must be a request');
    answers.push(await context.answer(member));
  }
  return answers;
}
