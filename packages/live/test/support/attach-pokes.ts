import type { LiveFrame } from '@keelwerk/core';
import type { CollectedFrames } from './collect-frames.ts';

/** One poke as a pokes stream yields it. */
export type PokeItem = { readonly upto: string; readonly changed: Record<string, string> };

/** The pokes among the frames of a stream. */
export const pokes = (frames: readonly LiveFrame<unknown>[]): PokeItem[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event as PokeItem] : []));

/** The pokes that name the entity type. */
export const pokesNaming = (frames: readonly LiveFrame<unknown>[], type: string): PokeItem[] =>
  pokes(frames).filter((poke) => type in poke.changed);

/**
 * A pokes stream sends no head, so nothing says when its reader has joined: a write before that is
 * not poked. A probe is written until the stream gives a poke that names `type`; the stream is
 * attached from then on, and everything written afterwards is poked. Under load a probe poke can
 * arrive after an attempt gave up, so more than one probe may be poked: the count of pokes naming
 * `type` seen is returned, and a test waits for and indexes from that baseline.
 */
export async function attachPokes(
  stream: Pick<CollectedFrames, 'until' | 'ended' | 'frames'>,
  type: string,
  probe: () => Promise<unknown>,
): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await probe();
    try {
      await stream.until((frames) => pokesNaming(frames, type).length > 0, 2000);
      return pokesNaming(stream.frames, type).length;
    } catch (error) {
      if (stream.ended()) throw error;
    }
  }
  throw new Error('the pokes stream did not attach');
}
