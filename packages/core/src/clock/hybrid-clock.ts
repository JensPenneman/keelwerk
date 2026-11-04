import type { Hlc } from '../events/hlc.ts';

const maxMilliseconds = 2 ** 48 - 1;
const maxCounter = 0xffff;
const hlcPattern = /^([0-9a-f]{12})([0-9a-f]{4})-(.+)$/;

/** A process clock: one node id and the highest reading it has produced or seen. */
export interface HybridClock {
  readonly nodeId: string;
  /**
   * The next reading for the given wall-clock milliseconds, greater than every reading this clock
   * produced or received. A counter overflow within one millisecond moves to the next millisecond.
   */
  tick(wallMilliseconds: number): Hlc;
  /** The receive rule: advances the clock past a clock value read from a stream or a field. */
  receive(remote: Hlc): void;
}

/** A hybrid logical clock (Kulkarni and others, 2014) in the string form of section 14.5.3. */
export function hybridClock(nodeId: string): HybridClock {
  if (nodeId === '') {
    throw new RangeError('A clock needs a node id.');
  }
  let milliseconds = 0;
  let counter = -1;
  return {
    nodeId,
    tick(wallMilliseconds) {
      if (
        !Number.isSafeInteger(wallMilliseconds) ||
        wallMilliseconds < 0 ||
        wallMilliseconds > maxMilliseconds
      ) {
        throw new RangeError('Wall-clock milliseconds must be an integer below 2^48.');
      }
      if (wallMilliseconds > milliseconds) {
        milliseconds = wallMilliseconds;
        counter = 0;
      } else if (counter < maxCounter) {
        counter += 1;
      } else {
        milliseconds += 1;
        counter = 0;
      }
      return `${milliseconds.toString(16).padStart(12, '0')}${counter.toString(16).padStart(4, '0')}-${nodeId}` as Hlc;
    },
    receive(remote) {
      const match = hlcPattern.exec(remote);
      if (match === null) {
        throw new RangeError(`"${remote}" is not a hybrid logical clock value.`);
      }
      const remoteMilliseconds = Number.parseInt(match[1] ?? '', 16);
      const remoteCounter = Number.parseInt(match[2] ?? '', 16);
      if (
        remoteMilliseconds > milliseconds ||
        (remoteMilliseconds === milliseconds && remoteCounter > counter)
      ) {
        milliseconds = remoteMilliseconds;
        counter = remoteCounter;
      }
    },
  };
}
