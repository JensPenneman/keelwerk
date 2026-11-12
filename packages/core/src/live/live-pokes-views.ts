import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { LivePokesView } from './live-pokes-view.ts';

/** The views `setUpSubscription` made available per bound session; `livePokesViewOf` is the only reader. */
export const livePokesViews: WeakMap<
  InvocationSession,
  (session: InvocationSession) => Promise<LivePokesView>
> = new WeakMap();
