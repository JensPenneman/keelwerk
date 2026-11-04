import type { StateToken } from '../events/state-token.ts';

/** One emitted item and, when the source is resumable, the state after it. */
export interface Emitted<E> {
  readonly event: E;
  readonly state?: StateToken;
}

export type StreamControl =
  | { readonly control: 'head'; readonly state: StateToken }
  | {
      readonly control: 'reset';
      readonly reason: 'overflow' | 'expired' | 'resync';
      readonly state?: StateToken;
    }
  | { readonly control: 'gap'; readonly missed?: number };

/** What a subscription yields: items and control frames. Only the type exists until M2. */
export type LiveFrame<E> = Emitted<E> | StreamControl;
