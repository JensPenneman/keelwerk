import type { QueueSource } from './queue-source.ts';

/** The framework migration track and the step that adds the M2 tables (S-117). */
const frameworkTrack = 'keelwerk.framework';
const framework0002 = '0002';

/**
 * Whether the source's namespace has the M2 framework tables (D8, 19.3): true when the adapter says
 * it keeps no framework track (its SQL capability is false, as the in-memory one's) or its history
 * records step 0002 of `keelwerk.framework`. A handle that says nothing about its capabilities is
 * read like a SQL one, so the check fails closed. A worker takes no job from a namespace where it is false.
 */
export async function frameworkReady(source: QueueSource): Promise<boolean> {
  const { adapter, capabilities } = source.handle;
  if (capabilities?.sql === false) return true;
  const history = await adapter.schema.history(source.namespace);
  return history.some(
    (applied) => applied.track === frameworkTrack && applied.id === framework0002,
  );
}
