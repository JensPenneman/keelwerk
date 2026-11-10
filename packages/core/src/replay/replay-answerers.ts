import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RecordedAnswer } from '../events/recorded-answer.ts';
import { answerAll } from '../interpreter/answer-all.ts';
import { answerCompute } from '../interpreter/answer-compute.ts';
import { answerSecret } from '../interpreter/answer-secret.ts';
import { requestName } from '../interpreter/request-name.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { replayKeyDestroyed } from './replay-key-destroyed.ts';
import { replayMismatch } from './replay-mismatch.ts';

/** Refuses a sealed verifier whose value key is gone: the live answer would be `false`, which is not what was decided. */
async function assertKeyKept(
  name: string,
  verifier: unknown,
  context: AnswerContext,
): Promise<void> {
  if (typeof verifier !== 'string') return;
  const sealed = parseSealedValueText(verifier);
  if (sealed === undefined) return;
  const opened = await context.unit.keys.openValue(sealed);
  if (opened === undefined) throw replayKeyDestroyed(name);
}

/** Whether a failure is a scope key that is gone: the key service's `core.not_found`, or a key that no longer opens (`OperationError`). */
function isLostKey(failure: unknown): boolean {
  if (failure instanceof KeelwerkError) return failure.code === 'core.not_found';
  return failure instanceof Error && failure.name === 'OperationError';
}

/** Runs an answer that reads a scope key, and answers `core.replay_key_destroyed` when the key is gone. */
async function keyKept<T>(name: string, answer: () => Promise<T>): Promise<T> {
  try {
    return await answer();
  } catch (failure) {
    if (isLostKey(failure)) throw replayKeyDestroyed(name);
    throw failure;
  }
}

/**
 * The answerers of a re-decide: ids, random values and issued secrets answer from the record, in
 * the order recorded, and record the answer again so the new decision record can be compared with
 * the old one. Verifications, reveals and computations run for real, on the runtime's key service
 * and a compute pool (they are reproducible while their keys exist), and refuse with
 * `core.replay_key_destroyed` when a key is gone. They are handed to the interpreter through its
 * `replace` seam. `ctx.all` is answered member by member, because the as-of unit hands out one
 * recorded read per positioned find.
 */
export function replayAnswerers(
  recorded: readonly RecordedAnswer[],
): Pick<RequestAnswerer, 'id' | 'random' | 'secret' | 'compute' | 'all'> {
  const ids = recorded.filter((answer) => answer.kind === 'id');
  const randoms = recorded.filter((answer) => answer.kind === 'random');
  const secrets = recorded.filter((answer) => answer.kind === 'secret');
  return {
    all: answerAll,
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
      if (request.op === 'verify') {
        await assertKeyKept(requestName(request), request.args[1], context);
      } else if (request.op === 'reveal') {
        const target: unknown = request.args[0];
        const ref: unknown =
          typeof target === 'object' && target !== null ? Reflect.get(target, 'ref') : undefined;
        await assertKeyKept(requestName(request), ref, context);
      }
      // Reveals and verifications record nothing and run as they did, on the real key service.
      if (request.op !== 'issue') {
        return keyKept(requestName(request), () => answerSecret(request, context));
      }
      const next = secrets.shift();
      if (next === undefined) throw replayMismatch('the handler issues a secret the record lacks');
      context.record.answer(next);
      // The verifier stays in its sealed form; the plaintext token is not kept and is not replayed.
      return { publicId: next.publicId, plain: '', verifier: next.verifier };
    },
    async compute(request, context) {
      if (request.op !== 'argon2idHash') {
        await assertKeyKept(requestName(request), request.args[0], context);
      }
      return keyKept(requestName(request), () => answerCompute(request, context));
    },
  };
}
