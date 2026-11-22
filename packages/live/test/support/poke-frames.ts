import type { LiveFrame } from '@keelwerk/core';

/** One poke as a pokes stream yields it. */
export type PokeItem = { readonly upto: string; readonly changed: Record<string, string> };

/** The pokes among the frames of a stream. */
export const pokes = (frames: readonly LiveFrame<unknown>[]): PokeItem[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event as PokeItem] : []));

/** The pokes that name the entity type. */
export const pokesNaming = (frames: readonly LiveFrame<unknown>[], type: string): PokeItem[] =>
  pokes(frames).filter((poke) => type in poke.changed);
