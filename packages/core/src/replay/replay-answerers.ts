import type { RecordedAnswer } from '../events/recorded-answer.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import { replayMismatch } from './replay-mismatch.ts';

/**
 * The answerers of ids and random values for a re-decide: each answers from the record, in the
 * order recorded, and records the answer again so the new decision record can be compared with
 * the old one. They are handed to the interpreter through its `replace` seam.
 */
export function replayAnswerers(
  recorded: readonly RecordedAnswer[],
): Pick<RequestAnswerer, 'id' | 'random'> {
  const ids = recorded.filter((answer) => answer.kind === 'id');
  const randoms = recorded.filter((answer) => answer.kind === 'random');
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
  };
}
