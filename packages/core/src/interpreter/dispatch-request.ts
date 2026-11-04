import type { AnswerContext } from '../kernel/answer-context.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { AnyRequest } from '../protocol/any-request.ts';

/** Sends a request to the answerer of its kind. */
export function dispatchRequest(
  answerer: RequestAnswerer,
  request: AnyRequest,
  context: AnswerContext,
): Promise<unknown> {
  switch (request.kind) {
    case 'load':
      return answerer.load(request, context);
    case 'maybe':
      return answerer.maybe(request, context);
    case 'ask':
      return answerer.ask(request, context);
    case 'all':
      return answerer.all(request, context);
    case 'flag':
      return answerer.flag(request, context);
    case 'id':
      return answerer.id(request, context);
    case 'random':
      return answerer.random(request, context);
    case 'secret':
      return answerer.secret(request, context);
    case 'compute':
      return answerer.compute(request, context);
    case 'perform':
      return answerer.perform(request, context);
  }
}
