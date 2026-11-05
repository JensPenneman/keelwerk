import type { DataAdapter, NamespaceRef, Scope, StoredEvent } from '@keelwerk/core';
import { chainHash } from '@keelwerk/core';

/**
 * Appends a second event to the stream of `first`, linked to it by the chain hash, so a chain of
 * two links exists for `verifyChain` to walk. The event repeats the decision of the first.
 */
export async function appendFollowUp(
  adapter: DataAdapter,
  namespace: NamespaceRef,
  scope: Scope,
  first: StoredEvent,
): Promise<void> {
  const eventId = crypto.randomUUID();
  const name = 'changed';
  const hash = chainHash(first.hash, {
    eventId,
    streamId: first.stream.id,
    version: 2,
    name,
    schemaVersion: first.schemaVersion,
    data: first.data,
    before: null,
    hlc: first.hlc,
    recordedAt: first.recordedAt,
    actor: first.actor,
    writer: first.writer,
    flags: first.flags,
    decision: first.decision,
    commandId: first.commandId,
    client: first.client,
  });
  await adapter.unit(namespace, scope, async (unit) => {
    await unit.events.append([
      {
        stream: first.stream,
        expectedVersion: 1,
        partition: first.partition,
        events: [
          {
            eventId,
            name,
            schemaVersion: first.schemaVersion,
            shape: first.shape,
            data: first.data,
            before: null,
            hlc: first.hlc,
            recordedAt: first.recordedAt,
            meta: {
              actor: first.actor,
              commandId: first.commandId,
              action: first.action,
              causationId: first.causationId,
              correlationId: first.correlationId,
              client: first.client,
              merge: first.merge,
              traceparent: first.traceparent,
              writer: first.writer,
              flags: first.flags,
              decision: first.decision,
            },
            transient: false,
            prevHash: first.hash,
            hash,
          },
        ],
      },
    ]);
  });
}
