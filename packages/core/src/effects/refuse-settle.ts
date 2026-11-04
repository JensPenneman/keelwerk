import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { SettleEffect } from '../protocol/settle-effect.ts';

/**
 * `settle(effect, outcome)` writes the `settled` record of an effect an outside performer holds
 * (section 7.9.5). The performers and the live subscription they settle through arrive with the
 * workers (S-24), so this release refuses it: `core.request_not_allowed`, naming the effect.
 */
export function refuseSettle(effect: SettleEffect): never {
  throw refuseRequest(
    `settle of effect ${effect.effect}`,
    'effects are settled by workers and outside performers, which this release does not run',
  );
}
