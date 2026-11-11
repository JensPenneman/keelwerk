import type { RuntimeModule } from './runtime-module.ts';
import type { StreamEntry } from './stream-entry.ts';

/** The streams the bases list, by reference. */
export function buildStreamEntries(
  ordered: readonly RuntimeModule[],
): ReadonlyMap<string, StreamEntry> {
  const streams = new Map<string, StreamEntry>();
  for (const module of ordered) {
    for (const [name, stream] of Object.entries(module.base.streams ?? {})) {
      const ref = `${module.id}.${name}`;
      streams.set(ref, {
        ref,
        module: module.id,
        name,
        key: stream.key,
        record: stream.record,
        readAs: `${module.id}.${stream.readAs}`,
        ...(stream.offload === undefined ? {} : { offload: stream.offload }),
        ...(stream.retention === undefined ? {} : { retention: stream.retention }),
      });
    }
  }
  return streams;
}
