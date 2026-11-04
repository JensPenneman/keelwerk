import type { AnswerContext } from '../kernel/answer-context.ts';
import type { PerformRequest } from '../protocol/perform-request.ts';
import { refuseRequest } from './refuse-request.ts';

/** `perform` belongs to inline effects, which ship in M2; M1 refuses it (S-05). */
export async function answerPerform(
  _request: PerformRequest,
  _context: AnswerContext,
): Promise<never> {
  throw refuseRequest('perform', 'inline effects are not part of this release');
}
