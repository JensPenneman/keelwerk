import type { AnswerContext } from '../kernel/answer-context.ts';
import type { SecretRequest } from '../protocol/secret-request.ts';
import { refuseRequest } from './refuse-request.ts';
import { requestName } from './request-name.ts';

/** Secret requests are not answered until the credential work package (WP-48) replaces this answerer. */
export async function answerSecret(
  request: SecretRequest,
  _context: AnswerContext,
): Promise<never> {
  throw refuseRequest(requestName(request), 'this release does not answer secret requests yet');
}
