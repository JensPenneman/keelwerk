import type { HubMember } from './hub-member.ts';
import type { LiveSubscription } from './live-subscription.ts';
import type { ResolvedHubLimits } from './resolve-hub-limits.ts';

/** What a source of `LiveSources` shares with the hub: its limits, membership (close ends it) and revalidation. */
export interface LiveSourceHub {
  readonly limits: ResolvedHubLimits;
  /** Lists the member with the hub, the moment the subscription starts; answers how to remove it. */
  readonly register: (member: HubMember) => () => void;
  /** Revalidates the subscription's session now (16.3.4): resolves once it is renewed or the stream is ended. */
  readonly revalidate: (subscription: LiveSubscription) => Promise<void>;
}
