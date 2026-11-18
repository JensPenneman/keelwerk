import { chainHash } from '../events/chain-hash.ts';
import { currentEventSchemaVersion } from '../events/current-event-schema-version.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { NewEvent } from '../events/new-event.ts';
import type { StagedEvent } from './staged-event.ts';

/**
 * Chains and hashes the staged events in order and appends each, with `meta`, to the events of its
 * row (`work.events`). The chain of each row starts at the head the command loaded and advances
 * with every event that is chain-hashed; a transient record has no hash and leaves the head where
 * it is. The row image each event produced gets the head as its last hash.
 */
export function chainStagedEvents(staged: readonly StagedEvent[], meta: EventMeta): void {
  const heads = new Map<string, string | null>();
  for (const item of staged) {
    const { work, key } = item;
    if (!heads.has(key)) {
      heads.set(
        key,
        work.created ? null : ((work.loaded?.kwLastHash as string | undefined) ?? null),
      );
    }
    const head = heads.get(key) ?? null;
    const prevHash = item.transient ? null : head;
    const hash = item.transient
      ? null
      : chainHash(prevHash, {
          eventId: item.eventId,
          streamId: item.draftId,
          version: item.version,
          name: item.name,
          schemaVersion: currentEventSchemaVersion,
          data: item.data,
          before: item.before,
          hlc: item.hlc,
          recordedAt: item.recordedAt,
          actor: meta.actor,
          writer: meta.writer,
          flags: meta.flags,
          decision: meta.decision,
          commandId: meta.commandId,
          client: meta.client,
        });
    const headNow = hash ?? head;
    heads.set(key, headNow);
    const image = work.images[item.imageAt];
    if (image !== undefined && headNow !== null && image.kwLastHash !== headNow) {
      work.images[item.imageAt] = { ...image, kwLastHash: headNow };
    }
    const event: NewEvent = {
      eventId: item.eventId,
      name: item.name,
      schemaVersion: currentEventSchemaVersion,
      shape: item.entry.descriptor.shape.id,
      data: item.data,
      before: item.before,
      hlc: item.hlc,
      recordedAt: item.recordedAt,
      meta,
      transient: item.transient,
      prevHash,
      hash,
    };
    work.events.push(event);
  }
}
