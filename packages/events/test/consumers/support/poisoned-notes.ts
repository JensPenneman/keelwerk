import type { StoredEvent, StreamRef } from '@keelwerk/core';
import type { ConsumerKit, Tenant } from './consumer-kit.ts';

/** A stream the poisoning tests poison at its second event. */
export const poisonedStream: StreamRef = {
  type: 'library.book',
  id: '00000000-0000-7000-8000-000000000a01',
};

/** A second stream that is never poisoned. */
export const cleanStream: StreamRef = {
  type: 'library.book',
  id: '00000000-0000-7000-8000-000000000a02',
};

/** The events of a tenant keyed `<stream id>/<version>`. */
export async function byVersion(
  kit: ConsumerKit,
  tenant: Tenant,
): Promise<ReadonlyMap<string, StoredEvent>> {
  return new Map(
    (await kit.eventsOf(tenant)).map((event) => [`${event.stream.id}/${event.version}`, event]),
  );
}

/** Acme: two streams written alternately; the second event of `poisonedStream` is the one to poison. */
export async function poisonedNotes(kit: ConsumerKit): Promise<ReadonlyMap<string, StoredEvent>> {
  await kit.appendNotes('acme', poisonedStream, 0, 2);
  await kit.appendNotes('acme', cleanStream, 0, 1);
  await kit.appendNotes('acme', poisonedStream, 2, 2);
  await kit.appendNotes('acme', cleanStream, 1, 1);
  return byVersion(kit, 'acme');
}

/** True for the second event of `poisonedStream`. */
export function isPoison(event: StoredEvent): boolean {
  return event.stream.id === poisonedStream.id && event.version === 2;
}
