import type { StateToken } from '../events/state-token.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { EntityChange } from '../model/entity-change.ts';
import type { Poke } from './poke.ts';
import type { WatchInput } from './watch-input.ts';

/**
 * Fills the core's `liveHub` point; implements 9.6 and 15.4.11. One member per kind of live
 * source: the changes of an entity, the pokes of a principal's readable entity types, a stream
 * of a module and a topic.
 */
export interface LiveHub {
  entity<Row>(
    session: InvocationSession,
    entity: string,
    input: WatchInput<unknown>,
    resume?: StateToken,
  ): AsyncIterable<LiveFrame<EntityChange<Row>>>;
  pokes(session: InvocationSession, resume?: StateToken): AsyncIterable<LiveFrame<Poke>>;
  stream<R>(
    session: InvocationSession,
    stream: string,
    key: unknown,
    options: { readonly from: 'start' | 'now' },
    resume?: string,
  ): AsyncIterable<LiveFrame<R>>;
  topic<R>(session: InvocationSession, topic: string, key: unknown): AsyncIterable<LiveFrame<R>>;
}
