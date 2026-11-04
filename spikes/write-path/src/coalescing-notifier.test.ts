import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoalescingNotifier } from './coalescing-notifier.ts';

describe('CoalescingNotifier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends at most one wake-up per namespace per interval, naming each scope once', async () => {
    const sent: string[] = [];
    const notifier = new CoalescingNotifier(
      async (payload) => {
        sent.push(payload);
      },
      { intervalMs: 50, maxPayloadBytes: 7999 },
    );
    notifier.start();
    notifier.committed('app', 's1');
    notifier.committed('app', 's2');
    notifier.committed('app', 's1');
    notifier.committed('other', 's3');
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(sent).toEqual(['app:s1,s2', 'other:s3']);
    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toHaveLength(2);
    notifier.committed('app', 's4');
    await notifier.stop();
    expect(sent).toEqual(['app:s1,s2', 'other:s3', 'app:s4']);
    expect(notifier.stats).toEqual({ notifications: 3, scopes: 4 });
  });

  it('falls back to a namespace-wide wake-up when the scope list exceeds the payload limit', async () => {
    const sent: string[] = [];
    const notifier = new CoalescingNotifier(
      async (payload) => {
        sent.push(payload);
      },
      { intervalMs: 50, maxPayloadBytes: 20 },
    );
    for (let index = 0; index < 5; index += 1) notifier.committed('app', `scope-${index}`);
    await notifier.flush();
    expect(sent).toEqual(['app:*']);
  });

  it('skips a tick while the previous flush is still sending', async () => {
    let release: () => void = () => undefined;
    const sent: string[] = [];
    const notifier = new CoalescingNotifier(
      async (payload) => {
        sent.push(payload);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      { intervalMs: 50, maxPayloadBytes: 7999 },
    );
    notifier.start();
    notifier.committed('app', 's1');
    await vi.advanceTimersByTimeAsync(50);
    notifier.committed('app', 's2');
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual(['app:s1']);
    release();
    await vi.advanceTimersByTimeAsync(50);
    expect(sent).toEqual(['app:s1', 'app:s2']);
    release();
    await notifier.stop();
  });
});
