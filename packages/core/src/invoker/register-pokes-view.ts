import type { LivePokesView } from '../live/live-pokes-view.ts';
import { livePokesViews } from '../live/live-pokes-views.ts';
import type { Span } from '../observability/span.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { createLivePokesView } from './create-live-pokes-view.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import type { SessionDetails } from './session-details.ts';

/**
 * Makes the pokes views of `bound` available to the hub: the first view is built now, so a refusal
 * is a refusal of the setup, and answered once for `bound` itself; every other session (a renewal)
 * gets a view built anew.
 */
export async function registerPokesView(
  env: InvokerEnv,
  bound: InvocationSession,
  details: SessionDetails,
  action: ActionEntry,
  span: Pick<Span, 'setAttribute'>,
): Promise<void> {
  let first: LivePokesView | undefined = await createLivePokesView(
    env,
    bound,
    details,
    action,
    bound,
    span,
  );
  livePokesViews.set(bound, (other) => {
    if (first !== undefined && other === bound) {
      const kept = first;
      first = undefined;
      return Promise.resolve(kept);
    }
    return createLivePokesView(env, bound, details, action, other, span);
  });
}
