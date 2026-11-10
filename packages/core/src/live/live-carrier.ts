import type { LiveFrame } from '../invoker/live-frame.ts';
import type { CarrierConnection } from './carrier-connection.ts';
import type { CarrierOptions } from './carrier-options.ts';

/**
 * Fills the core's `liveCarriers` point: frames one stream on one connection and owns heartbeats,
 * backpressure and close semantics (15.4.11).
 */
export interface LiveCarrier {
  readonly name: 'sse' | 'websocket' | (string & {});
  serve(
    stream: AsyncIterable<LiveFrame<unknown>>,
    connection: CarrierConnection,
    options: CarrierOptions,
  ): Promise<void>;
}
