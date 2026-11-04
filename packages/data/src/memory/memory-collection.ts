/** One named table of the in-memory store: values are immutable, a write replaces the entry. */
export type MemoryCollection = ReadonlyMap<string, unknown>;
