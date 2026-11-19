import {
  deprecationsOf,
  type LiveFrame,
  type StateToken,
  type SurfaceAction,
  utcDayOf,
} from '@keelwerk/core';
import { asKeelwerkError, decodeActionInput, encodeFrames } from '@keelwerk/core/http';
import { type GraphQLError, type GraphQLFieldResolver, isObjectType } from 'graphql';
import { graphqlErrorOf } from '../errors/graphql-error-of.ts';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { plainOf } from '../resolve/plain-of.ts';
import { eventMemberOf } from './event-member-of.ts';

type Members = Readonly<Record<string, unknown>>;

/** The wire input of a subscription: its arguments without the resume argument `after`. */
function wireOf(action: SurfaceAction, args: Members): unknown {
  if (action.input.kind === 'foreign') return plainOf(args.input);
  if (action.input.kind === 'void') return undefined;
  const { after: _after, ...rest } = args;
  return plainOf(rest);
}

/**
 * The source of a subscription field (section 16.6.5): the arguments become the wire input, the
 * invoker subscribes under the connection's session and its frames are wire encoded. It awaits the
 * first frame before it returns, so a refusal (a malformed `after`, a forbidden subscription) is
 * thrown as a GraphQL error and answers as the operation's error. Each frame is a member of the event
 * union (`eventMemberOf`). A failure of a later frame ends the stream with a GraphQL error as its last item; one of kind
 * unauthenticated also asks the socket's session check to run now. The returned iterator's `return`
 * aborts the invocation first, so the hub's iterator is free to return (a carrier that awaits `return`
 * with a `next` pending would otherwise wait for an event).
 */
export function subscribeResolver(
  action: SurfaceAction,
  itemType: string,
): GraphQLFieldResolver<unknown, GraphqlContext> {
  return async (_source, args: Members, context, info) => {
    const failed = (thrown: unknown): GraphQLError => {
      const error = asKeelwerkError(thrown);
      if (error.kind === 'unauthenticated') void context.socket?.check();
      return graphqlErrorOf(error, context);
    };
    const inner = new AbortController();
    const abort = (): void => inner.abort();
    if (context.signal.aborted) abort();
    else context.signal.addEventListener('abort', abort, { once: true });
    let iterator: AsyncIterator<LiveFrame<unknown>>;
    let first: IteratorResult<LiveFrame<unknown>>;
    try {
      const wire = wireOf(action, args);
      const input = decodeActionInput(context.surface, action, wire);
      context.notices.push(
        ...deprecationsOf(undefined, action, utcDayOf(context.now ?? Temporal.Now.instant())),
      );
      const after = args.after;
      const frames = encodeFrames(
        context.invoker.subscribe<unknown, unknown>(
          {
            action: action.ref,
            input,
            carrier: { ...context.carrier, transport: 'graphql' },
            session: context.session,
            requestId: context.requestId,
            ...(context.traceparent === undefined ? {} : { traceparent: context.traceparent }),
            signal: inner.signal,
          },
          typeof after === 'string' ? { after: after as StateToken } : undefined,
        ),
        action,
      );
      iterator = frames[Symbol.asyncIterator]();
      first = await iterator.next();
    } catch (thrown) {
      abort();
      context.signal.removeEventListener('abort', abort);
      throw failed(thrown);
    }
    const type = info.schema.getType(itemType);
    const members = isObjectType(type) ? Object.keys(type.getFields()) : [];
    let waiting: IteratorResult<LiveFrame<unknown>> | undefined = first;
    let finished = false;
    const stop = async (): Promise<IteratorResult<unknown>> => {
      finished = true;
      abort();
      context.signal.removeEventListener('abort', abort);
      await iterator.return?.(undefined);
      return { done: true, value: undefined };
    };
    const source: AsyncGenerator<unknown> = {
      async next() {
        if (finished) return { done: true, value: undefined };
        try {
          const step = waiting ?? (await iterator.next());
          waiting = undefined;
          if (step.done === true) return await stop();
          return { done: false, value: eventMemberOf(step.value, { typeName: itemType, members }) };
        } catch (thrown) {
          const error = failed(thrown);
          await stop();
          // The failure is the stream's last item; the field's `resolve` throws it, so it answers as an error result.
          return { done: false, value: error };
        }
      },
      return: stop,
      async throw(failure: unknown) {
        await stop();
        throw failure;
      },
      [Symbol.asyncIterator]() {
        return source;
      },
      async [Symbol.asyncDispose]() {
        await stop();
      },
    };
    return source;
  };
}
