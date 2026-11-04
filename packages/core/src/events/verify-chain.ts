import { chainHash } from './chain-hash.ts';
import type { ChainVerdict } from './chain-verdict.ts';
import type { StoredEvent } from './stored-event.ts';

function localName(event: StoredEvent): string {
  return event.type.slice(event.stream.type.length + 1);
}

/** Where the chain of the events starts. */
export interface VerifyChainOptions {
  /** The hash the first event must link to: null for a stream's first event, an anchor after compaction. Default: null, so a stream whose first events were removed does not verify; only an explicit anchor skips the check. */
  readonly start?: string | null;
}

/**
 * Recomputes the chain of one stream's events, in version order (section 15.1.8): each chain event
 * must link to the hash before it and hash to what it stores. A list of only transient records
 * (an entity without a chain) has nothing to verify; a transient record among chain events is
 * `missing`, since its flag is not part of the chain content. The first mismatch is reported, with the event it was found at.
 */
export function verifyChain(
  events: readonly StoredEvent[],
  options: VerifyChainOptions = {},
): ChainVerdict {
  let previous: string | null = options.start ?? null;
  let checked = 0;
  const chained = events.some((event) => !event.transient);
  for (const event of events) {
    if (event.transient && !chained) continue;
    const found = { eventId: event.eventId, version: event.version, checked } as const;
    if (event.transient || event.hash === null) return { ok: false, ...found, reason: 'missing' };
    if (event.prevHash !== previous) return { ok: false, ...found, reason: 'prev_hash' };
    const expected = chainHash(event.prevHash, {
      eventId: event.eventId,
      streamId: event.stream.id,
      version: event.version,
      name: localName(event),
      schemaVersion: event.schemaVersion,
      data: event.data,
      before: event.before,
      hlc: event.hlc,
      recordedAt: event.recordedAt,
      actor: event.actor,
      writer: event.writer,
      flags: event.flags,
      decision: event.decision,
      commandId: event.commandId,
      client: event.client,
    });
    if (expected !== event.hash) return { ok: false, ...found, reason: 'hash' };
    previous = event.hash;
    checked += 1;
  }
  return { ok: true, checked };
}
