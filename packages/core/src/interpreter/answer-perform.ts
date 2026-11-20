import type { AnswerContext } from '../kernel/answer-context.ts';
import type { PerformRequest } from '../protocol/perform-request.ts';
import { refuseRequest } from './refuse-request.ts';

/** `perform` is answered by `runPrepare` (7.9.4); every other form that reaches this answerer is refused. */
export async function answerPerform(
  _request: PerformRequest,
  _context: AnswerContext,
): Promise<never> {
  throw refuseRequest('perform', 'an inline effect runs only in prepare');
}
