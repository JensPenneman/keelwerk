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
    | {
        readonly ok: false;
        readonly error: DeclaredErrorOf<App, R> | TaxonomyError;
        /** Only when the command committed and the wait for its effects failed (see `InvokeOptions.waitEffects`): reuse it, never send a new one. */
        readonly commandId?: string;
        readonly effects?: EffectReferences;
      }
  >;
  /**
   * Subscribes; yields items and control frames, in their in-process form. It resumes from the last token
   * by itself when the connection drops, on the carrier the client was created with (server-sent events by
   * default). A resume starts after the last token the client saw, so an item with a token is not sent
   * again; the items a source sends without one (the catch-up before `head`, for some sources) may be sent
   * again when the connection drops before `head`, and a caller that must not see one twice drops it by
   * its own key (15.4.5). Once a frame has arrived, a restart is outlasted: a dropped connection, a request
   * that fails and a 408, 502, 503 or 504 without an error envelope are reopened without end, and so is a
   * refusal that carries `rate_limited`. A reset other than `overflow` reopens without a token, so the
   * source sends everything again. Before the first frame, `retry.retries` failed reopenings end it with
   * the last failure. After a frame, any other refusal ends it: an `error` event, `version_retired`, an
   * error the server names (a `forbidden` for one), a malformed event (`core.internal`), and an answer without an error envelope that is not
   * one of those four statuses (a 401, 403, 404, 429, 500 or 501, or a 200 that is not an event stream),
   * which is `core.internal`. On the WebSocket carrier a deployment that answers plain requests but
   * whose socket closes before it is ready, `retry.retries` times in a row and once more (a gate whose
   * session has expired refuses the upgrade so; a host at its stream bound or at `core.liveConnections`
   * is counted the same way today, where the server-sent events carrier keeps reopening), ends it with
   * `unavailable`, `core.live_unavailable`. A server without the live module rejects with `unavailable`,
   * `core.live_unavailable`; a ref the surface does not have as a subscription rejects with `core.not_found`.
   */
  subscribe<R extends SubscriptionRef<App>>(
    ref: R,
    input: InputOf<App, R>,
    options?: { readonly after?: StateToken; readonly signal?: AbortSignal },
  ): AsyncIterable<LiveFrame<EventOf<App, R>>>;
  /**
   * Waits until the deferred effects an outcome listed have settled (section 16.8.4), watching
   * `core.effectStatusWatch`, and answers their statuses in the order given. Ids that no watch has a
   * status for (not requested by the caller, or unknown) reject with `core.not_found`, naming how many;
   * the timeout resolves the statuses as they stand (some may still be `requested`), and an id whose status
   * has not arrived by then is left out of the result; match the results by their `id`, not by position;
   * without a live module it
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
