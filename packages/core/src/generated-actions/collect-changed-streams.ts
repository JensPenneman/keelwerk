import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Position } from '../storage/position.ts';
import type { Unit } from '../storage/unit.ts';

const batch = 500;

/** What step 1 of the changes algorithm (section 15.2.6) found. */
export interface ChangedStreams {
  readonly streams: ReadonlyMap<string, { readonly createdAfter: boolean }>;
  /** The position the answer is complete up to: the head, or the last event read when `maxChanges` cut it short. */
  readonly through: Position;
  readonly hasMore: boolean;
}

/**
 * Step 1 of section 15.2.6: the streams of the entity type (and partition) that have events after
 * `since`, up to the head, at most `maxStreams` of them. Transient change records count: a
 * `history: 'state'` entity is reported through them.
 */
export async function collectChangedStreams(input: {
  readonly unit: Unit;
  readonly entry: EntityEntry;
  readonly since: Position;
  readonly head: Position;
  readonly partition: string | undefined;
  readonly maxStreams: number;
}): Promise<ChangedStreams> {
  const streams = new Map<string, { createdAfter: boolean }>();
  const created = `${input.entry.ref}.created`;
  let through = input.since;
  let after: Position | null = input.since === 0n ? null : input.since;
  for (;;) {
    const read = await input.unit.events.readAll(after, {
      limit: batch,
      selector: {
        streamTypes: [input.entry.ref],
        ...(input.partition === undefined ? {} : { partition: input.partition }),
      },
      includeTransient: true,
    });
    for (const event of read.events) {
      if (event.position > input.head) return { streams, through: input.head, hasMore: false };
      const known = streams.get(event.stream.id);
      if (known === undefined) {
        if (streams.size >= input.maxStreams) return { streams, through, hasMore: true };
        streams.set(event.stream.id, { createdAfter: event.type === created });
      } else if (event.type === created) {
        known.createdAfter = true;
      }
      through = event.position;
    }
    if (read.next === null || read.events.length === 0) {
      return { streams, through: input.head, hasMore: false };
    }
    after = read.next;
  }
}
