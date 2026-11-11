import type { Position, StoredEvent, Unit } from '@keelwerk/core';

/** How many reads of `batchSize` events one pass makes at most; what is left is read by the pass that follows at once. */
const readsPerPass = 4;

/** What a pass reads of the log. */
export interface PassEventsInput {
  readonly unit: Unit;
  /** Throws when the pass is past its deadline. */
  readonly expired: () => void;
  readonly from: Position;
  readonly head: Position;
  readonly batchSize: number;
  /** The stream types to read; every type when absent. */
  readonly streamTypes: readonly string[] | undefined;
}

/** The events after `from` up to `head`, at most `readsPerPass` pages; `to` is the position the batch is complete up to. */
export async function readPassEvents(
  input: PassEventsInput,
): Promise<{ readonly events: StoredEvent[]; readonly to: Position }> {
  const { unit, from, head } = input;
  const events: StoredEvent[] = [];
  let to = head;
  if (head <= from) return { events, to };
  let after: Position | null = from === 0n ? null : from;
  for (let reads = 0; reads < readsPerPass; reads += 1) {
    const page = await unit.events.readAll(after, {
      limit: input.batchSize,
      includeTransient: true,
      ...(input.streamTypes === undefined
        ? {}
        : { selector: { streamTypes: [...input.streamTypes] } }),
    });
    input.expired();
    let beyond = false;
    for (const event of page.events) {
      if (event.position > head) {
        beyond = true;
        break;
      }
      events.push(event);
    }
    if (beyond || page.next === null || page.events.length === 0) break;
    after = page.next;
    if (reads === readsPerPass - 1) to = events.at(-1)?.position ?? head;
  }
  return { events, to };
}
