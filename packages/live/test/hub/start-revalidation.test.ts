import type { LiveFrame } from '@keelwerk/core';
import { testCarrier, testPrincipal } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import { adaPrincipal as ada, startLiveApp } from '../support/live-app-kit.ts';
import { recordingLive } from './support/recording-live.ts';

vi.setConfig({ testTimeout: 60_000 });

const writer = testPrincipal('w', { claims: { seed: true } });
const cardIds = (frames: readonly LiveFrame<unknown>[]): string[] =>
  frames.flatMap((frame) =>
    'event' in frame ? [String((frame.event as { cardId: string }).cardId)] : [],
  );

describe('a start that revalidates a pass while more batches arrive', () => {
  test('a card written after the revocation does not reach the stream', async () => {
    const slow = recordingLive({ maxBufferedItems: 150 });
    const kit = await startLiveApp('memory', slow.module);
    const card = (title: string) =>
      kit.call<{ id: string }>(kit.acme, writer, 'board.card.create', { owner: 'ada', title });
    try {
      const pass = await kit.call<{ id: string; token: string }>(kit.acme, ada, 'passes.issue', {
        holder: 'ada',
      });
      // 120 rows are two pages: the second waits for the client to read the first.
      for (let at = 0; at < 120; at += 1) await card(`old ${at}`);
      const watcher = kit.follow(testCarrier(kit.acme, ada));
      await watcher.until((frames) => frames.some((frame) => 'control' in frame));

      // The first revalidation reads the pass at once and hands its answer over when the test lets it.
      const carrier = kit.bearer(kit.acme, pass.token);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reading: () => void = () => undefined;
      const readStarted = new Promise<void>((resolve) => {
        reading = resolve;
      });
      let armed = false;
      const adapter = kit.runtime.adapter;
      const readOnly = adapter.unit.bind(adapter);
      vi.spyOn(adapter, 'unit').mockImplementation(((namespace, scope, run, options) => {
        let readPass = false;
        const wrapped = (unit: Parameters<typeof run>[0]) => {
          const rows = new Proxy(unit.rows, {
            get: (target, name) => {
              const member = Reflect.get(target, name, target);
              if (typeof member !== 'function') return member;
              return (...args: unknown[]) => {
                if ((args[0] as { ref?: string } | undefined)?.ref === 'passes.pass') {
                  readPass = true;
                }
                return member.apply(target, args);
              };
            },
          });
          return run(
            new Proxy(unit, {
              get: (target, name) => (name === 'rows' ? rows : Reflect.get(target, name, target)),
            }),
          );
        };
        return readOnly(namespace, scope, wrapped, options).then(async (result) => {
          if (armed && readPass) {
            armed = false;
            reading();
            await gate;
          }
          return result;
        });
      }) as typeof adapter.unit);
      const iterator = kit.runtime.invoker
        .subscribe<unknown, unknown>({
          action: 'board.cards',
          input: { from: 'beginning' },
          carrier,
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        })
        [Symbol.asyncIterator]();
      const frames: LiveFrame<unknown>[] = [];
      const first = await iterator.next();
      if (first.done === true) throw new Error('the stream ended at once');
      frames.push(first.value);

      // The pass changes and stays valid while the snapshot pages.
      await kit.call(kit.acme, ada, 'passes.label', { id: pass.id, label: 'renamed' });
      const bridge = await card('bridge');
      await watcher.until((got) => cardIds(got).includes(bridge.id));

      // From here the next read of the pass waits: the revalidation at the end of the snapshot.
      armed = true;
      let failure: unknown;
      const drained = (async () => {
        try {
          for (;;) {
            const step = await iterator.next();
            if (step.done === true) return;
            frames.push(step.value);
          }
        } catch (error) {
          failure = error;
        }
      })();
      await readStarted;

      // Revoked and then a card, while that revalidation waits.
      await kit.call(kit.acme, ada, 'passes.revoke', { id: pass.id });
      const late = await card('late');
      await watcher.until((got) => cardIds(got).includes(late.id));
      await new Promise((resolve) => setTimeout(resolve, 100));
      release();
      await drained;

      expect(failure).toMatchObject({ kind: 'unauthenticated' });
      expect(cardIds(frames)).toContain(bridge.id);
      expect(cardIds(frames)).not.toContain(late.id);
      await watcher.stop();
    } finally {
      await kit.stop();
    }
  });
});
