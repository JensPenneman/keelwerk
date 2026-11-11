import type { LiveSubscription } from './live-subscription.ts';

/** What a hub keeps of one running subscription: the part the revalidation sees, and how the hub ends it. */
export interface HubMember {
  readonly subscription: LiveSubscription;
  /**
   * Ends the stream without a frame or an error and releases what it holds (its reader, its
   * start units). Resolves when the subscriber's unit in flight has settled. Never rejects.
   */
  close(): Promise<void>;
}
