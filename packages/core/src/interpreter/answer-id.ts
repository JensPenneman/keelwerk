import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { IdRequest } from '../protocol/id-request.ts';
import { refuseRequest } from './refuse-request.ts';

/** Answers `ctx.newId(entity)` with a UUIDv7 and records it; a query may not ask (S-06). */
export async function answerId(request: IdRequest, context: AnswerContext): Promise<string> {
  if (context.form === 'read' || context.form === 'source') {
    throw refuseRequest('id', `a ${context.form} may not request ids`);
  }
  const value = newUuidV7();
  context.record.answer({ kind: 'id', entity: request.entity, value });
  return value;
}
