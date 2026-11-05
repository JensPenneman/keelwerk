import type { StreamRef } from '../events/stream-ref.ts';
import type { Unit } from '../storage/unit.ts';
import type { ControlStore } from './control-store.ts';

/** How many of the newest events of the tenant stream are looked through, in pages of `tailPage`. */
const tailPage = 50;
const tailPages = 4;

/** The version of the stream's newest event (0 for an empty stream), found by doubling and bisecting. */
async function lastVersion(unit: Unit, stream: StreamRef): Promise<number> {
  const exists = async (version: number): Promise<boolean> =>
    (await unit.events.readStream(stream, { fromVersion: version, limit: 1 })).length > 0;
  let known = 0;
  let beyond = 1;
  while (await exists(beyond)) {
    known = beyond;
    beyond *= 2;
  }
  while (beyond - known > 1) {
    const middle = Math.floor((known + beyond) / 2);
    if (await exists(middle)) known = middle;
    else beyond = middle;
  }
  return known;
}

/**
 * When the operator `actor` last entered the tenant (section 8.8): the `recordedAt` of the latest
 * `core.tenant.entered` event on the tenant's stream whose actor is an operator with the actor's
 * via and id; another operator's entry, or an entry by any other kind of actor, does not count.
 * Only the newest events are read (the newest 200, newest page first): an entry buried under more
 * events than that is not found and is entered again. Undefined if there is none.
 */
export async function latestTenantEntry(
  store: ControlStore,
  tenantId: string,
  actor: { readonly via: string; readonly id: string },
): Promise<Temporal.Instant | undefined> {
  const stream: StreamRef = { type: 'core.tenant', id: tenantId };
  return store.read(async (unit) => {
    let upTo = await lastVersion(unit, stream);
    for (let page = 0; page < tailPages && upTo > 0; page += 1) {
      const fromVersion = Math.max(1, upTo - tailPage + 1);
      const events = await unit.events.readStream(stream, {
        fromVersion,
        toVersion: upTo,
        limit: tailPage,
      });
      let latest: Temporal.Instant | undefined;
      for (const event of events) {
        if (event.type !== 'core.tenant.entered' || event.actor.kind !== 'operator') continue;
        if (event.actor.via !== actor.via || event.actor.id !== actor.id) continue;
        if (latest === undefined || Temporal.Instant.compare(event.recordedAt, latest) > 0) {
          latest = event.recordedAt;
        }
      }
      if (latest !== undefined) return latest;
      upTo = fromVersion - 1;
    }
    return undefined;
  });
}
