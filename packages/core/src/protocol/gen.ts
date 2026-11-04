import type { Pending } from './pending.ts';

/** A pure generator handler or helper answering `T` (section 7.9.2). */
export type Gen<T> = Generator<Pending, T, unknown>;
