import type { AnyRequest } from '../protocol/any-request.ts';
import { isRequest } from './is-request.ts';
import { refuseRequest } from './refuse-request.ts';

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function isGenerator(value: unknown): value is Generator<unknown, unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'next' in value &&
    typeof value.next === 'function' &&
    'return' in value &&
    typeof value.return === 'function' &&
    Symbol.iterator in value
  );
}

function close(generator: Generator<unknown, unknown, unknown>): void {
  try {
    generator.return(undefined);
  } catch {
    // The invocation is already failing; the original error is the one that matters.
  }
}

/** Answers one request; the interpreter's seam for a handler's yields. */
export type Answerer = (request: AnyRequest) => Promise<unknown>;

/**
 * Drives what a pure handler returned (section 7.9.2): a value is the result, a request is
 * answered and its answer is the result, a generator is stepped until it returns, answering each
 * yielded request in order. A promise, an async generator and a bare `yield` are refused with
 * `core.request_not_allowed`. Requests never throw into the generator: a failed answer closes it
 * and aborts the invocation.
 */
export async function driveHandler(result: unknown, answer: Answerer): Promise<unknown> {
  if (isThenable(result)) {
    result.then(undefined, () => undefined);
    throw refuseRequest('a promise', 'handlers are pure and never async');
  }
  if (typeof result === 'object' && result !== null && Symbol.asyncIterator in result) {
    throw refuseRequest('an async generator', 'handlers are pure and never async');
  }
  if (isRequest(result)) return answer(result);
  if (!isGenerator(result)) return result;
  let step = result.next();
  while (step.done !== true) {
    const yielded: unknown = step.value;
    if (!isRequest(yielded)) {
      close(result);
      throw refuseRequest('a yield', 'only a request may be yielded, with `yield*`');
    }
    let response: unknown;
    try {
      response = await answer(yielded);
    } catch (error) {
      close(result);
      throw error;
    }
    step = result.next(response);
  }
  return step.value;
}
