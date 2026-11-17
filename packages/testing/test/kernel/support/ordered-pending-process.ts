import type { ReactionEntry } from '@keelwerk/core';

/**
 * `base` with a state that holds its entries in the order they came, and not in the order a `jsonb`
 * column keeps (shorter names first): the entries `ord-10` and `ord-9` come first and in that order, then one
 * per event. A process that ships its oldest entry (`oldestPending`) decides on that order.
 */
export function orderedPendingOf(base: ReactionEntry): ReactionEntry {
  return {
    ...base,
    initial: { pending: {} },
    evolve: (state: { pending: Record<string, number> }, event: { version: number }) => ({
      pending: {
        ...state.pending,
        [event.version === 1 ? 'ord-10' : event.version === 2 ? 'ord-9' : `ord-x${event.version}`]:
          event.version,
      },
    }),
  } as unknown as ReactionEntry;
}

/** The name of the first entry of a state `orderedPendingOf` folded. */
export function oldestPending(state: unknown): string | undefined {
  return Object.keys((state as { pending: object }).pending)[0];
}
