import { translateError } from '../api-versions/translate-error.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StateToken } from '../events/state-token.ts';
import type { Invocation } from './invocation.ts';
import type { InvokerEnv } from './invoker-env.ts';
import type { LiveFrame } from './live-frame.ts';
import type { OpenedSubscription } from './opened-subscription.ts';
import { setUpSubscription } from './set-up-subscription.ts';
import type { SubscriptionSetupState } from './subscription-setup-state.ts';

/**
 * `invoker.subscribe` (9.2, 15.4.3 step 1): iteration starts the setup (open, locate, admit,
 * validate, translate, authorize, execute: the source plan is made and the kernel builds the view
 * and checks the resume token), reports one decision, and only then runs the subscription through
 * the hub of the app. Every item is translated once for the API version of the request that opened
 * the stream; control frames pass unchanged. A failure of the setup carries its stage; a failure
 * later belongs to the stream and is never a second decision. Either is a `KeelwerkError` thrown
 * from `next()` as the version shows it. An aborted `inv.signal` returns the hub's iterator.
 */
export function routeSubscribe<E>(
  env: InvokerEnv,
  inv: Invocation<unknown>,
  resume: { readonly after: StateToken } | undefined,
): AsyncIterable<LiveFrame<E>> {
  return {
    [Symbol.asyncIterator]: () => {
      let inner: AsyncIterator<LiveFrame<unknown>> | undefined;
      let opening: Promise<OpenedSubscription> | undefined;
      let ended = false;
      const state: SubscriptionSetupState = {
        stage: 'open',
        log: env.options.log.child({ requestId: inv.requestId, action: inv.action }),
      };
      const stop = (): void => {
        ended = true;
        void inner?.return?.().catch(() => undefined);
      };
      const aborted = (): void => stop();
      inv.signal.addEventListener('abort', aborted, { once: true });
      const finish = (): void => {
        ended = true;
        inv.signal.removeEventListener('abort', aborted);
      };
      const fail = async (
        error: unknown,
        opened: OpenedSubscription | undefined,
      ): Promise<never> => {
        finish();
        await inner?.return?.().catch(() => undefined);
        if (opened === undefined) {
          if (error instanceof KeelwerkError && state.translation !== undefined) {
            throw translateError(state.translation, error, state.action);
          }
          throw error;
        }
        throw opened.failure(error);
      };
      return {
        next: async (): Promise<IteratorResult<LiveFrame<E>>> => {
          if (ended || inv.signal.aborted) {
            finish();
            return { done: true, value: undefined };
          }
          let opened: OpenedSubscription | undefined;
          try {
            opening ??= setUpSubscription(env, inv, resume, state);
            opened = await opening;
          } catch (error) {
            return fail(error, undefined);
          }
          try {
            if (inner === undefined) {
              inner = opened.frames[Symbol.asyncIterator]();
              if (ended || inv.signal.aborted) {
                stop();
                finish();
                return { done: true, value: undefined };
              }
            }
            const step = await inner.next();
            if (step.done === true) {
              finish();
              return { done: true, value: undefined };
            }
            return { done: false, value: (await opened.itemOf(step.value)) as LiveFrame<E> };
          } catch (error) {
            if (ended || inv.signal.aborted) {
              finish();
              return { done: true, value: undefined };
            }
            return fail(error, opened);
          }
        },
        return: async (value?: unknown): Promise<IteratorResult<LiveFrame<E>>> => {
          finish();
          await inner?.return?.(value).catch(() => undefined);
          return { done: true, value: undefined };
        },
      };
    },
  };
}
