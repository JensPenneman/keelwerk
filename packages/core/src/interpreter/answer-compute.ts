import type { AnswerContext } from '../kernel/answer-context.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import type { ComputeRequest } from '../protocol/compute-request.ts';
import { refuseRequest } from './refuse-request.ts';
import { requestName } from './request-name.ts';

/** Answers `ctx.compute` in the kernel's worker pool, off the event loop; reproducible, so nothing is recorded. A sealed verifier (`kwv1` text) is opened before it is checked. */
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
  // A verifier read from a row is its sealed text; the check needs the encoded hash itself.
  const sealed = parseSealedValueText(first);
  if (sealed === undefined) return context.compute.argon2idVerify(first, second);
  const opened = await context.unit.keys.openValue(sealed);
  if (opened === undefined) return false;
  return context.compute.argon2idVerify(new TextDecoder().decode(opened), second);
}
