import type { RecordedRead } from '../events/recorded-read.ts';
import type { Position } from '../storage/position.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import { replayMismatch } from './replay-mismatch.ts';

/** The recorded reads of a decision, handed out in the order the loads are answered (S-19). */
export interface AsOfReads {
  /** The recorded read the next positioned read of a unit at `level` sees. */
  take(level: StorageScope['level']): RecordedRead;
  /** The highest position any read of the record names. */
  ceiling(): Position;
}

/**
 * The cursor over a decision record's reads. A tenant invocation's read of a backend entity is
 * marked `scope: 'backend'`; a read whose mark disagrees with the unit it lands in, or that the
 * record does not hold, means the handler no longer loads what it loaded.
 */
export function createAsOfReads(
  recorded: readonly RecordedRead[],
  invocation: StorageScope['level'],
): AsOfReads {
  let next = 0;
  return {
    take(level) {
      const read = recorded[next];
      if (read === undefined) {
        throw replayMismatch(
          `the handler loads more than the ${recorded.length} reads the record holds`,
        );
      }
      const crossed = invocation === 'tenant' && level === 'backend';
      if ((read.scope === 'backend') !== crossed) {
        throw replayMismatch(`read ${next + 1} was recorded in another scope than it now runs in`);
      }
      next += 1;
      return read;
    },
    ceiling() {
      let high = 0n;
      for (const read of recorded) {
        if (read.at > high) high = read.at;
      }
      return high;
    },
  };
}
