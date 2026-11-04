import type { AnswerContext } from '../kernel/answer-context.ts';
import type { ComputeRequest } from '../protocol/compute-request.ts';
import { refuseRequest } from './refuse-request.ts';
import { requestName } from './request-name.ts';

/** Answers `ctx.compute` in the kernel's worker pool, off the event loop; reproducible, so nothing is recorded. */
export async function answerCompute(
  request: ComputeRequest,
  context: AnswerContext,
): Promise<string | boolean> {
  const [first, second] = request.args;
  if (request.op === 'argon2idHash') {
    if (typeof first !== 'string' || !(second instanceof Uint8Array)) {
      throw refuseRequest(requestName(request), 'it takes a password and a salt');
    }
    return context.compute.argon2idHash(first, second);
  }
  if (typeof first !== 'string' || typeof second !== 'string') {
    throw refuseRequest(requestName(request), 'it takes a verifier and a password');
  }
  return context.compute.argon2idVerify(first, second);
}
