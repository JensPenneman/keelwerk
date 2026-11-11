import type { Unit } from '@keelwerk/core';

/** The seqs of the records of one key, ascending (the stream record cases). */
export function seqsOf(unit: Unit, key: string, streamName = 'conf.log'): Promise<bigint[]> {
  return unit.streams
    .read(streamName, key, null, 1000)
    .then((records) => records.map((r) => r.seq));
}
