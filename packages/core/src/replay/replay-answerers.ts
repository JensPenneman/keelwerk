import type { RecordedAnswer } from '../events/recorded-answer.ts';
import { answerSecret } from '../interpreter/answer-secret.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import { replayMismatch } from './replay-mismatch.ts';

/**
 * The answerers of ids and random values for a re-decide: each answers from the record, in the
 * order recorded, and records the answer again so the new decision record can be compared with
 * the old one. They are handed to the interpreter through its `replace` seam.
 */
export function replayAnswerers(
  recorded: readonly RecordedAnswer[],
): Pick<RequestAnswerer, 'id' | 'random' | 'secret'> {
  const ids = recorded.filter((answer) => answer.kind === 'id');
  const randoms = recorded.filter((answer) => answer.kind === 'random');
  const secrets = recorded.filter((answer) => answer.kind === 'secret');
  return {
    async id(request, context) {
      const next = ids.shift();
      if (next === undefined || next.entity !== request.entity) {
        throw replayMismatch(`the handler asks for an id of ${request.entity} the record lacks`);
      }
      context.record.answer(next);
      return next.value;
    },
    async random(request, context) {
      const next = randoms.shift();
      if (next === undefined || next.bytes !== request.bytes) {
        throw replayMismatch(`the handler asks for ${request.bytes} random bytes the record lacks`);
      }
      context.record.answer(next);
      return new Uint8Array(Buffer.from(next.value, 'base64url'));
    },
    async secret(request, context) {
      // Reveals and verifications record nothing and run as they did.
      if (request.op !== 'issue') return answerSecret(request, context);
      const next = secrets.shift();
      if (next === undefined) throw replayMismatch('the handler issues a secret the record lacks');
      context.record.answer(next);
      // The verifier stays in its sealed form; the plaintext token is not kept and is not replayed.
      return { publicId: next.publicId, plain: '', verifier: next.verifier };
    },
  };
}
