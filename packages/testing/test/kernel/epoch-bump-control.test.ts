import { describe, expect, test } from 'vitest';
import { useEpochKit } from './support/epoch-kit.ts';

const { boot, stop, addBook, bumpedMarks, bumps } = useEpochKit();

describe('restore detection of the control namespace at connect (14.7.6), PGlite on directories', () => {
  test('a deployment mark above its counters bumps before the boot registers its process', {
    timeout: 120_000,
  }, async () => {
    const first = await boot();
    await addBook(first.runtime, '1');
    const { ids } = first;
    const { adapter, namespace } = first.runtime.control;
    const marks = await adapter.unit(
      namespace,
      { level: 'deployment' },
      async (unit) => unit.marks?.list(namespace.id, { limit: 10 }) ?? [],
      { readOnly: true },
    );
    const deployment = marks[0];
    expect(marks).toHaveLength(1);
    if (deployment === undefined) throw new Error('the control namespace has no mark');
    // A control store restored to a backup a few positions short: its mark lies above its counters.
    const planted = deployment.position + 1000n;
    await adapter.unit(namespace, { level: 'deployment' }, async (unit) =>
      unit.marks?.raise([
        { ...deployment, position: planted, updatedAt: first.runtime.clock.now() },
      ]),
    );
    await stop(first);

    const second = await boot(ids);
    const found = bumps(second).filter((entry) => entry.fields.scope === deployment.scopeId);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toMatchObject({ reason: 'counter', from: 0, to: 2 });
    const mark = (await bumpedMarks(second.runtime)).find(
      (entry) => entry.scopeId === deployment.scopeId,
    );
    expect(mark?.epoch).toBe(2);
    // The process row of this boot was written after the bump: its events are the first ones above
    // the planted mark. Written before it, they would lie below the mark, and the bump would have
    // raised the counters to the mark and no further.
    const events = await second.runtime.control.adapter.unit(
      second.runtime.control.namespace,
      { level: 'deployment' },
      async (unit) =>
        (await unit.events.readAll(planted, { limit: 1000, includeTransient: true })).events,
      { readOnly: true },
    );
    expect(events.some((event) => event.type === 'core.process.created')).toBe(true);
  });
});
