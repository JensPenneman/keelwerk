import type { LiveFrame } from '@keelwerk/core';
import { testPrincipal } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import { fullLive } from '../support/full-live.ts';
import type { LiveAppKit } from '../support/live-app-kit.ts';
import { adaPrincipal as ada, startLiveApp } from '../support/live-app-kit.ts';

vi.setConfig({ testTimeout: 60_000 });

const writer = testPrincipal('w', { claims: { seed: true } });
const cardIds = (frames: readonly LiveFrame<unknown>[]): string[] =>
  frames.flatMap((frame) =>
    'event' in frame ? [String((frame.event as { cardId: string }).cardId)] : [],
  );

async function withPass(kit: LiveAppKit) {
  const pass = await kit.call<{ id: string; token: string }>(kit.acme, ada, 'passes.issue', {
    holder: 'ada',
  });
  const followed = kit.follow(kit.bearer(kit.acme, pass.token));
  await followed.until((frames) => frames.some((frame) => 'control' in frame));
  return { pass, followed };
}

const card = (kit: LiveAppKit, title: string) =>
  kit.call<{ id: string }>(kit.acme, writer, 'board.card.create', { owner: 'ada', title });

describe.each(['memory', 'pglite'] as const)('the hub revalidates on a change on %s', (adapter) => {
  test('revoking the pass ends the stream unauthenticated within one second', async () => {
    const hubs = fullLive();
    const kit = await startLiveApp(adapter, hubs.module);
    try {
      const { pass, followed } = await withPass(kit);
      const revokedAt = Date.now();
      await kit.call(kit.acme, ada, 'passes.revoke', { id: pass.id });
      await followed.until(() => followed.ended(), 1000);
      expect(Date.now() - revokedAt).toBeLessThan(1000);
      expect(followed.failure()).toMatchObject({ kind: 'unauthenticated' });
    } finally {
      await kit.stop();
    }
  });

  test('no item committed after the revocation reaches the stream', async () => {
    const hubs = fullLive();
    const kit = await startLiveApp(adapter, hubs.module);
    try {
      const { pass, followed } = await withPass(kit);
      const before = await card(kit, 'before');
      await followed.until((frames) => cardIds(frames).includes(before.id));
      await kit.call(kit.acme, ada, 'passes.revoke', { id: pass.id });
      const after = await card(kit, 'after');
      await followed.until(() => followed.ended(), 5000);
      expect(cardIds(followed.frames)).toEqual([before.id]);
      expect(cardIds(followed.frames)).not.toContain(after.id);
      expect(followed.failure()).toMatchObject({ kind: 'unauthenticated' });
    } finally {
      await kit.stop();
    }
  });

  test('a change of the pass that keeps it valid releases the held items in order', async () => {
    const hubs = fullLive();
    const kit = await startLiveApp(adapter, hubs.module);
    try {
      const { pass, followed } = await withPass(kit);
      const [hub] = hubs.opened;
      const first = await card(kit, 'one');
      await kit.call(kit.acme, ada, 'passes.label', { id: pass.id, label: 'renamed' });
      const second = await card(kit, 'two');
      await followed.until((frames) => cardIds(frames).includes(second.id));
      expect(cardIds(followed.frames)).toEqual([first.id, second.id]);
      expect(followed.ended()).toBe(false);
      expect(hub?.subscriptions()).toHaveLength(1);
      await followed.stop();
    } finally {
      await kit.stop();
    }
  });

  test('a stream without dependsOn reads only its entity’s stream types', async () => {
    const hubs = fullLive();
    const kit = await startLiveApp(adapter, hubs.module);
    try {
      const followed = kit.follow({
        transport: 'test',
        headers: { 'x-tenant': kit.acme.id, 'x-test-principal': JSON.stringify(ada) },
      });
      await followed.until((frames) => frames.some((frame) => 'control' in frame));
      const [hub] = hubs.opened;
      const [subscription] = hub?.subscriptions() ?? [];
      expect(subscription?.session.dependsOn).toBeUndefined();
      await followed.stop();
    } finally {
      await kit.stop();
    }
  });
});
