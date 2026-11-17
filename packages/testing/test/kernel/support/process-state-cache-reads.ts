import type { DataAdapterFactory, Unit } from '@keelwerk/core';

/** What a unit read of the cache and of the process streams: `cache`, or `stream:<process>@<from version>`. */
function counted(unit: Unit, log: string[], cacheStream: string): Unit {
  return {
    ...unit,
    events: {
      ...unit.events,
      readStream: (ref, range) => {
        if (ref.type === 'loop.cycle' || ref.type === 'relay.tally') {
          log.push(`stream:${ref.type}@${String(range?.fromVersion ?? 1)}`);
        }
        return unit.events.readStream(ref, range);
      },
    },
    streams: {
      ...unit.streams,
      read: (stream, key, after, limit) => {
        if (stream === cacheStream) log.push('cache');
        return unit.streams.read(stream, key, after, limit);
      },
    },
  };
}

/** A factory whose units log the reads that decide how long a fold takes. */
export function countingReads(
  base: DataAdapterFactory,
  log: string[],
  cacheStream: string,
): DataAdapterFactory {
  return {
    ...base,
    create: (placement, env) => {
      const adapter = base.create(placement, env);
      return {
        ...adapter,
        unit: (namespace, scope, fn, options) =>
          adapter.unit(namespace, scope, (unit) => fn(counted(unit, log, cacheStream)), options),
      };
    },
  };
}
