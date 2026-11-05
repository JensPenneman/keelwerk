import type { EffectDraft, Gen } from '@keelwerk/core';
import { extensionPoint } from '@keelwerk/core';

/** What a delivery filler is handed for one reset request. */
interface ResetMessage {
  /** The identifier the reset was requested for. */
  readonly identifier: string;
  /**
   * The one-time token, shown to the delivery only. It is a secret (S-43, S-112): a filler that
   * puts it into an effect needs sealed effect inputs, which arrive with M2, so M1 ships no filler.
   */
  readonly token: string;
  readonly expiresAt: Temporal.Instant;
}

/** The contract of the extension point auth declares for the platform that delivers reset links (S-43). */
export interface ResetDelivery {
  readonly id: string;
  /** A pure generator bound to its contributor's context; the effects it returns join the request's decision. */
  deliver(message: ResetMessage): Gen<readonly EffectDraft[]>;
}

export const resetDelivery = extensionPoint.set<ResetDelivery>();
