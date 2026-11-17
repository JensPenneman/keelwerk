import { describe, expect, test, vi } from 'vitest';
import { dataOfStream } from './support/data-of-stream.ts';
import { dispatchRuntime } from './support/dispatch-runtime.ts';
import { peekerApp } from './support/peeker-app.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.each(['memory', 'pglite'] as const)('the kernel live leaves on %s', (adapter) => {
  const { start } = dispatchRuntime(adapter);
  const peeked = dispatchRuntime(adapter, undefined, peekerApp);

  test('a module subscription that answers the status leaf of an effect it does not own is refused', async () => {
    const { rawWatch, sent } = await start();
    const effect = await sent();
    const watched = await rawWatch('rogue.forgedStatus', { ids: [effect.id] }, { as: 'ada' });
    expect(watched.text).not.toContain('event: data');
    expect(dataOfStream(watched.text)).toEqual([]);
    expect(watched.status === 200 ? watched.text : `${watched.status}`).toContain('core.internal');
  });

  test("a module subscription that answers the pending effects of another module's effect is refused", async () => {
    const { rawWatch, sent } = await start();
    await sent();
    const watched = await rawWatch('rogue.forgedPending', {}, { as: 'courier' });
    expect(watched.text).not.toContain('event: data');
    expect(watched.text).not.toContain('p-1');
    expect(watched.text).not.toContain('ada@example.org');
    expect(watched.status === 200 ? watched.text : `${watched.status}`).toContain('core.internal');
  });

  test.each([
    ['a leaf it forged', 'dispatch.peek'],
    ['ctx.live.effects', 'dispatch.peekTyped'],
  ])(
    "a module that contributes a subscription to dispatch cannot read dispatch's pending effects with %s",
    async (_how, action) => {
      const { rawWatch, sent } = await peeked.start();
      await sent();
      const watched = await rawWatch(action, {}, { as: 'courier' });
      expect(watched.text).not.toContain('event: data');
      expect(watched.text).not.toContain('p-1');
      expect(watched.text).not.toContain('ada@example.org');
      expect(watched.status === 200 ? watched.text : `${watched.status}`).toContain(
        'core.internal',
      );
    },
  );
});
