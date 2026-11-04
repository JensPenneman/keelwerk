import type { AnswerContext } from '../kernel/answer-context.ts';
import type { RandomRequest } from '../protocol/random-request.ts';
import { refuseRequest } from './refuse-request.ts';

/** The most bytes one request may ask for. */
const maxBytes = 1024;

/** Answers `ctx.random(bytes)` from the CSPRNG and records the bytes as base64url; a query may not ask (S-06). */
export async function answerRandom(
  request: RandomRequest,
  context: AnswerContext,
): Promise<Uint8Array> {
  if (context.form === 'read' || context.form === 'source') {
    throw refuseRequest('random', `a ${context.form} may not request random values`);
  }
  if (!Number.isInteger(request.bytes) || request.bytes < 1 || request.bytes > maxBytes) {
    throw refuseRequest('random', `the byte count must be an integer from 1 to ${maxBytes}`);
  }
  const value = crypto.getRandomValues(new Uint8Array(request.bytes));
  context.record.answer({
    kind: 'random',
    bytes: request.bytes,
    value: Buffer.from(value).toString('base64url'),
  });
  return value;
}
