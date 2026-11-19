import type { ApiSurface, EffectStatus, LiveFrame, StateToken } from '@keelwerk/core';
import type { DeclaredErrorOf } from './declared-error-of.ts';
import type { EffectReferences } from './effect-references.ts';
import type { EventOf } from './event-of.ts';
import type { InputOf } from './input-of.ts';
import type { InvokableRef } from './invokable-ref.ts';
import type { InvokeOptions } from './invoke-options.ts';
import type { Prefer } from './prefer.ts';
import type { ResultOf } from './result-of.ts';
import type { SubscriptionRef } from './subscription-ref.ts';
import type { TaxonomyError } from './taxonomy-error.ts';

/** The client of an app, inferred from its action tree; there is no generated client code (section 16.8.4). */
export interface AppClient<App> {
  /** Runs a query or a command; rejects with a KeelwerkError. */
  invoke<R extends InvokableRef<App>, const P extends Prefer = 'sync'>(
    ref: R,
    input: InputOf<App, R>,
    options?: InvokeOptions<P>,
  ): Promise<ResultOf<App, R, P>>;
  /** Like invoke, but returns the outcome; declared errors are typed per action. */
  attempt<R extends InvokableRef<App>, const P extends Prefer = 'sync'>(
    ref: R,
    input: InputOf<App, R>,
    options?: InvokeOptions<P>,
  ): Promise<
    | {
        readonly ok: true;
        readonly value: ResultOf<App, R, P>;
        readonly commandId?: string;
        readonly effects?: EffectReferences;
      }
    | { readonly ok: false; readonly error: DeclaredErrorOf<App, R> | TaxonomyError }
  >;
  /**
   * Subscribes; yields items and control frames, in their in-process form. It resumes from the last token
   * by itself when the connection drops, on the carrier the client was created with (server-sent events by
   * default). A server without the live module rejects with `unavailable`, `core.live_unavailable`; a ref
   * the surface does not have as a subscription rejects with `core.not_found`.
   */
  subscribe<R extends SubscriptionRef<App>>(
    ref: R,
    input: InputOf<App, R>,
    options?: { readonly after?: StateToken; readonly signal?: AbortSignal },
  ): AsyncIterable<LiveFrame<EventOf<App, R>>>;
  /**
   * Waits until the deferred effects an outcome listed have settled, watching `core.effectStatusWatch`, and
   * answers their statuses in the order given. An id the caller never requested rejects with `core.not_found`;
   * the timeout resolves the statuses as they stand (some may still be `requested`); without a live module it
   * rejects with `unavailable`, `core.live_unavailable`.
   */
  waitForEffects(
    effectIds: EffectReferences,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): Promise<readonly EffectStatus[]>;
  /** A client bound to another backend, tenant or credential. */
  as(selector: {
    readonly backend?: string;
    readonly tenant?: string;
    readonly token?: string;
  }): AppClient<App>;
  /** The API surface at the client's API version, fetched once. */
  surface(): Promise<ApiSurface>;
}
