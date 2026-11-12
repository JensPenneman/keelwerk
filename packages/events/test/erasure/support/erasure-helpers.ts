import type { StoredEvent } from '@keelwerk/core';
import type { Probe } from './erasure-kit.ts';

/** The values the erasure tests plant, each findable by its text. */
export const markers = {
  adaEmail: 'ada.marker@example.test',
  adaNotes: 'ada private note marker',
  beaEmail: 'bea.marker@example.test',
  beaReply: 'bea reply to ada marker',
  adaReply: 'ada reply to bea marker',
};

export async function seed(p: Probe) {
  const ada = await p.invokeAs.invoke('probe.enrol', {
    name: 'Ada',
    email: markers.adaEmail,
    notes: markers.adaNotes,
  });
  const bea = await p.invokeAs.invoke('probe.enrol', { name: 'Bea', email: markers.beaEmail });
  const adaId = String((ada as { personId: string }).personId);
  const beaId = String((bea as { personId: string }).personId);
  const adaThread = await p.invokeAs.invoke('probe.open', {
    ownerId: adaId as never,
    title: 'a',
    topic: 'ada topic marker',
  });
  const beaThread = await p.invokeAs.invoke('probe.open', {
    ownerId: beaId as never,
    title: 'b',
    topic: 'bea topic marker',
  });
  const adaThreadId = String((adaThread as { threadId: string }).threadId);
  const beaThreadId = String((beaThread as { threadId: string }).threadId);
  // Bea replies on Ada's thread; Ada replies on Bea's.
  await p.invokeAs.invoke('probe.answer', {
    threadId: adaThreadId as never,
    replierId: beaId as never,
    reply: markers.beaReply,
  });
  await p.invokeAs.invoke('probe.answer', {
    threadId: beaThreadId as never,
    replierId: adaId as never,
    reply: markers.adaReply,
  });
  return { adaId, beaId, adaThreadId, beaThreadId };
}

/** `core.flag.set` over the in-process operator carrier, with a rule that names `principals`. */
export async function targetFlag(
  p: Probe,
  principals: readonly string[],
  reason: string,
): Promise<string> {
  const outcome = await p.runtime.invoker.invoke<unknown, { id: string }>({
    action: 'core.flag.set',
    input: {
      key: 'probe.beta',
      backendId: p.runtime.backendId,
      targeting: {
        enabled: true,
        rules: [{ id: 'people', principals, serve: { value: true } }],
        fallthrough: { value: false },
      },
      reason,
    },
    carrier: { transport: 'test', local: { inProcess: true } },
    requestId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.value.id;
}

export async function flagRow(p: Probe, id: string) {
  const descriptor = p.runtime.app.registry.entities.get('core.flag')?.descriptor;
  if (descriptor === undefined) throw new Error('core.flag is not registered');
  return p.runtime.control.adapter.unit(
    p.runtime.control.namespace,
    { level: 'deployment' },
    async (unit) =>
      (await unit.rows.find(descriptor, { where: { op: 'eq', field: 'id', value: id } })).rows[0],
    { readOnly: true },
  );
}

export async function finish(p: Probe): Promise<void> {
  await p.runtime.drainJobs();
  await p.worker.pass();
}

export async function erasedEvents(p: Probe): Promise<readonly StoredEvent[]> {
  return p.inTenant(async (unit) =>
    (await unit.events.readAll(null, { limit: 1000 })).events.filter((event) =>
      event.type.endsWith('.erased'),
    ),
  );
}
