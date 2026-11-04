import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { EntityBehaviour } from './entity-behaviour.ts';
import type { EvolvingEvent } from './evolving-event.ts';

/**
 * The author's `evolve` for a domain event (section 15.1.5): a pure function of the row and the
 * payload. The kernel keeps the identity, the version, `updatedAt` and the framework columns of the
 * row, whatever the function returns for them.
 */
export function applyDomainEvolve(
  entry: EntityEntry,
  behaviour: EntityBehaviour | undefined,
  state: StorageRow,
  event: EvolvingEvent,
  payload: unknown,
): StorageRow {
  const evolve = behaviour?.evolve[event.name];
  if (evolve === undefined) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `${entry.ref} has no evolve for the event "${event.name}".`,
    });
  }
  const next = evolve(state as never, payload as never) as StorageRow;
  const row: Record<string, unknown> = { ...next };
  row.id = state.id;
  row.createdAt = state.createdAt;
  row.version = Number(state.version) + 1;
  row.updatedAt = event.recordedAt;
  row.kwLastHlc = event.hlc;
  if (event.hash === null) delete row.kwLastHash;
  else row.kwLastHash = event.hash;
  return row;
}
