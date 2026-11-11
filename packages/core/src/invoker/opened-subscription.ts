import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { LiveFrame } from './live-frame.ts';

/** What a successful setup hands the iterator. */
export interface OpenedSubscription {
  readonly frames: AsyncIterable<LiveFrame<unknown>>;
  /** The item for the API version of the request that opened the stream, translated once; control frames pass. */
  itemOf(frame: LiveFrame<unknown>): Promise<LiveFrame<unknown>>;
  /** What the caller sees of an error raised while the stream runs. */
  failure(error: unknown): KeelwerkError;
}
