import type { DataAdapter, StoredEvent } from '@keelwerk/core';

/**
 * An adapter whose events read with the decision digest of `digest`, as a record of 0.1.0 would
 * hold it.
 */
export function withDigest(adapter: DataAdapter, digest: string): DataAdapter {
  const rewritten = (event: StoredEvent): StoredEvent =>
    event.decision === null
      ? event
      : { ...event, decision: { ...event.decision, inputDigest: digest } };
  return {
    ...adapter,
    unit: (namespace, scope, fn, options) =>
      adapter.unit(
        namespace,
        scope,
        (unit) =>
          fn({
            ...unit,
            events: {
              ...unit.events,
              readAll: async (after, readOptions) => {
                const page = await unit.events.readAll(after, readOptions);
                return { ...page, events: page.events.map(rewritten) };
              },
              find: async (match, page) => {
                const found = await unit.events.find(match, page);
                return { ...found, events: found.events.map(rewritten) };
              },
              readStream: async (stream, range) =>
                (await unit.events.readStream(stream, range)).map(rewritten),
            },
          }),
        options,
      ),
  };
}
