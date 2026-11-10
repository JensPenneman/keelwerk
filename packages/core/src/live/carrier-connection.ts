import type { WireError } from '../errors/wire-error.ts';

/** Why a connection ends (15.4.6). */
export type CarrierEndReason = 'complete' | 'going_away' | 'max_duration' | 'version_retired';

/**
 * The connection a carrier serves, implemented by the HTTP host for server-sent event responses
 * and WebSocket upgrades (S-155).
 */
export type CarrierConnection =
  | {
      readonly kind: 'sse';
      write(chunk: string): Promise<void>;
      /** The `Last-Event-ID` header. */
      readonly lastEventId: string | null;
      /** Aborted when the client goes away. */
      readonly signal: AbortSignal;
      /** Writes the `end` event and closes. */
      end(reason: CarrierEndReason): Promise<void>;
      /** Writes the `error` event and closes. */
      fail(error: WireError): Promise<void>;
    }
  | {
      readonly kind: 'websocket';
      send(text: string): Promise<void>;
      receive(): AsyncIterable<string>;
      /** False when no pong came within the heartbeat. */
      ping(): Promise<boolean>;
      bufferedBytes(): number;
      readonly signal: AbortSignal;
      close(code: 1000 | 1001 | 1008 | 1011, reason: CarrierEndReason | 'error'): Promise<void>;
    };
